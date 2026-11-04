-- Migration 3: closing weeks, releasing savings and changing the allowance as
-- checked database operations. Paste the whole file into the Supabase SQL
-- editor and run it once, after migration 2.
--
-- The browser previews these rules; these functions enforce them. Each call is
-- one transaction, and each locks the account row, so two tabs or a retry run
-- one after another and cannot apply the same change twice.
--
-- security definer, reviewed: these three functions run with the table owner's
-- rights, because week_closures and savings_releases must stay unwritable from
-- the browser. That also bypasses row-level security, so EVERY function below
-- checks ownership against auth.uid() first and takes no owner parameter.
-- search_path is empty so every name is written out in full and cannot be
-- redirected to a look-alike table. Signed-out visitors cannot call them.
--
-- Custom error codes the app turns into messages:
--   SS001 the week is closed, or the date is before the account opened
--   SS002 more than is protected
--   SS003 the allowance does not fit inside free cash

-- Helpers live outside the public schema, so they cannot be called from the browser.
create schema private;
revoke all on schema private from public, anon, authenticated;

-- P = opening + closures - releases.
create function private.protected_cents(p_account_id uuid) returns bigint
language sql stable set search_path = '' as $$
  select a.opening_protected_cents
    + coalesce((select sum(c.protected_cents) from public.week_closures c where c.account_id = a.id), 0)::bigint
    - coalesce((select sum(r.cents) from public.savings_releases r where r.account_id = a.id), 0)::bigint
  from public.accounts a
  where a.id = p_account_id
$$;

-- F = C - P - B, counting purchases dated before p_before (all of them if null).
create function private.free_cents(p_account_id uuid, p_before date default null) returns bigint
language sql stable set search_path = '' as $$
  select a.opening_cash_cents
    - coalesce((select sum(p.cents) from public.purchases p
                where p.account_id = a.id and (p_before is null or p.date < p_before)), 0)::bigint
    - private.protected_cents(a.id)
    - a.commitments_cents
  from public.accounts a
  where a.id = p_account_id
$$;

-- The allowance in force: the latest change, or the start-of-week snapshot.
create function private.allowance_in_force(p_week_plan_id uuid) returns bigint
language sql stable set search_path = '' as $$
  select coalesce(
    (select c.to_cents from public.allowance_changes c
     where c.week_plan_id = w.id order by c.created_at desc limit 1),
    w.starting_allowance_cents
  )
  from public.week_plans w
  where w.id = p_week_plan_id
$$;

-- S: purchases dated inside the week.
create function private.spent_in_week(p_account_id uuid, p_week_start date) returns bigint
language sql stable set search_path = '' as $$
  select coalesce(sum(p.cents), 0)::bigint from public.purchases p
  where p.account_id = p_account_id and p.date >= p_week_start and p.date < p_week_start + 7
$$;

-- ---------------------------------------------------------------------------
-- Closing ended weeks, oldest first. Protects min(max(0, A - S), max(0, F)).
-- Only weeks with a plan are closed: nothing is invented for other weeks.
-- p_today is the student's local date, which the database cannot know. It may
-- be at most one day ahead of UTC, the furthest ahead any time zone reaches.
-- ---------------------------------------------------------------------------
create function public.close_ended_weeks(p_account_id uuid, p_today date) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid;
  plan public.week_plans%rowtype;
  allowance bigint;
  spent bigint;
  free bigint;
  closed_count integer := 0;
begin
  select a.user_id into owner_id from public.accounts a
  where a.id = p_account_id and a.user_id = (select auth.uid())
  for update;
  if not found then
    raise exception 'Account not found' using errcode = '42501';
  end if;

  if p_today > (now() at time zone 'utc')::date + 1 then
    raise exception 'That date is in the future' using errcode = '22023';
  end if;

  for plan in
    select w.* from public.week_plans w
    where w.account_id = p_account_id
      and w.week_start + 7 <= p_today
      and not exists (
        select 1 from public.week_closures c
        where c.account_id = w.account_id and c.week_start = w.week_start
      )
    order by w.week_start
  loop
    allowance := private.allowance_in_force(plan.id);
    spent := private.spent_in_week(p_account_id, plan.week_start);
    free := private.free_cents(p_account_id, plan.week_start + 7);

    insert into public.week_closures (
      user_id, account_id, week_start, allowance_cents, spent_cents, leftover_cents, protected_cents
    ) values (
      owner_id, p_account_id, plan.week_start, allowance, spent, allowance - spent,
      least(greatest(allowance - spent, 0), greatest(free, 0))
    );
    closed_count := closed_count + 1;
  end loop;

  return closed_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Releasing protected savings. Lowers P; cash never changes.
-- ---------------------------------------------------------------------------
create function public.release_savings(p_id uuid, p_account_id uuid, p_made_on date, p_cents bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid;
  existing_owner uuid;
begin
  select a.user_id into owner_id from public.accounts a
  where a.id = p_account_id and a.user_id = (select auth.uid())
  for update;
  if not found then
    raise exception 'Account not found' using errcode = '42501';
  end if;

  -- A retry of a release already saved has nothing left to do. An id someone
  -- else used is an ordinary failure that reveals nothing about their row.
  select r.user_id into existing_owner from public.savings_releases r where r.id = p_id;
  if found then
    if existing_owner = owner_id then
      return;
    end if;
    raise exception 'That id cannot be used' using errcode = '23505';
  end if;

  if p_cents > private.protected_cents(p_account_id) then
    raise exception 'More than is protected' using errcode = 'SS002';
  end if;

  insert into public.savings_releases (id, user_id, account_id, made_on, cents)
  values (p_id, owner_id, p_account_id, p_made_on, p_cents);
end;
$$;

-- ---------------------------------------------------------------------------
-- Changing this week's allowance. Compares what is still left to spend (A - S)
-- with free cash, never A itself. Reductions are always allowed. The "from"
-- amount is read here, so the before/after record cannot be misstated.
-- ---------------------------------------------------------------------------
create function public.change_allowance(
  p_id uuid, p_week_plan_id uuid, p_made_on date, p_to_cents bigint, p_suggested_cents bigint
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  plan public.week_plans%rowtype;
  existing_owner uuid;
  current_cents bigint;
begin
  select w.* into plan from public.week_plans w
  where w.id = p_week_plan_id and w.user_id = (select auth.uid());
  if not found then
    raise exception 'Week plan not found' using errcode = '42501';
  end if;

  perform 1 from public.accounts a where a.id = plan.account_id for update;

  select c.user_id into existing_owner from public.allowance_changes c where c.id = p_id;
  if found then
    if existing_owner = plan.user_id then
      return;
    end if;
    raise exception 'That id cannot be used' using errcode = '23505';
  end if;

  if exists (
    select 1 from public.week_closures c
    where c.account_id = plan.account_id and c.week_start = plan.week_start
  ) then
    raise exception 'That week is closed' using errcode = 'SS001';
  end if;

  current_cents := private.allowance_in_force(plan.id);

  if p_to_cents > current_cents
    and greatest(p_to_cents - private.spent_in_week(plan.account_id, plan.week_start), 0)
        > greatest(private.free_cents(plan.account_id), 0) then
    raise exception 'The allowance does not fit inside free cash' using errcode = 'SS003';
  end if;

  insert into public.allowance_changes (id, user_id, week_plan_id, made_on, from_cents, to_cents, suggested_cents)
  values (p_id, plan.user_id, plan.id, p_made_on, current_cents, p_to_cents, p_suggested_cents);
end;
$$;

-- ---------------------------------------------------------------------------
-- Closed history stays as it is: purchases in a closed week cannot be added,
-- changed, moved or deleted, and none can be dated before the account opened.
-- This one is security invoker: row-level security hides other students'
-- accounts from it, so a forged link still fails on the foreign key.
-- ---------------------------------------------------------------------------
create function private.guard_purchase_dates() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- Deleting a whole account cascades to its purchases; a student's right to
  -- delete their own data must not be blocked by their own closed weeks.
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;

  if tg_op in ('UPDATE', 'DELETE') and exists (
    select 1 from public.week_closures c
    where c.account_id = old.account_id
      and c.week_start = (date_trunc('week', old.date::timestamp))::date
  ) then
    raise exception 'That week is closed' using errcode = 'SS001';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  if exists (
    select 1 from public.week_closures c
    where c.account_id = new.account_id
      and c.week_start = (date_trunc('week', new.date::timestamp))::date
  ) or exists (
    select 1 from public.accounts a
    where a.id = new.account_id and new.date < a.opening_date
  ) then
    raise exception 'That date cannot be changed' using errcode = 'SS001';
  end if;

  return new;
end;
$$;

create trigger guard_purchase_dates
before insert or update or delete on public.purchases
for each row execute function private.guard_purchase_dates();

-- ---------------------------------------------------------------------------
-- Access. These changes now only happen through the functions above.
-- Opening balances, plan snapshots and allowance history cannot be edited
-- directly. New week plans may still be inserted, and a student may still
-- delete their own account.
-- ---------------------------------------------------------------------------
revoke update on public.accounts from authenticated;
revoke update, delete on public.week_plans from authenticated;
revoke insert, update, delete on public.allowance_changes from authenticated;

revoke all on function public.close_ended_weeks(uuid, date) from public, anon;
revoke all on function public.release_savings(uuid, uuid, date, bigint) from public, anon;
revoke all on function public.change_allowance(uuid, uuid, date, bigint, bigint) from public, anon;
grant execute on function public.close_ended_weeks(uuid, date) to authenticated;
grant execute on function public.release_savings(uuid, uuid, date, bigint) to authenticated;
grant execute on function public.change_allowance(uuid, uuid, date, bigint, bigint) to authenticated;
