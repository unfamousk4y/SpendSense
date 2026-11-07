-- Migration 14: the money split, from the amendment in PRODUCT_PLAN.md.
--
-- The student divides money coming in between needs, wants and savings.
-- 1. Each account keeps its default split and its opening wants share.
-- 2. Each income row keeps the amounts the student confirmed for it.
-- 3. Each week plan keeps its wants guide, so it does not shift during the week.
-- 4. A payment's savings count toward protected savings.
-- 5. Income changes cannot take savings below zero or deepen a shortfall.
--
-- Needs are never stored: they are whatever remains. The wants still available
-- is worked out from these rows, the same way cash is.
--
-- New custom error codes the app turns into messages:
--   SS009 that would take protected savings below zero
--   SS010 setting this aside would deepen a shortfall

-- ---------------------------------------------------------------------------
-- 1. The split on each account. USD and BSD accounts have their own.
-- ---------------------------------------------------------------------------
alter table public.accounts
  add column needs_percent integer not null default 50 check (needs_percent between 0 and 100),
  add column wants_percent integer not null default 30 check (wants_percent between 0 and 100),
  add column savings_percent integer not null default 20 check (savings_percent between 0 and 100),
  add column opening_wants_cents bigint not null default 0 check (opening_wants_cents >= 0),
  add constraint split_totals_100 check (needs_percent + wants_percent + savings_percent = 100),
  add constraint opening_shares_within_cash check (opening_protected_cents + opening_wants_cents <= opening_cash_cents);

-- The student can change their default at any time. It only applies from the
-- next payment, because earlier ones keep their own amounts. Opening balances
-- and every other account column stay closed to direct changes.
grant update (needs_percent, wants_percent, savings_percent) on public.accounts to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The confirmed amounts on each payment. They live on the payment's own
-- row, so saving it is one write: a retry cannot save a payment without its
-- split, and deleting a payment takes its shares with it.
-- ---------------------------------------------------------------------------
alter table public.income_receipts
  add column income_kind text not null default 'oneOff' check (income_kind in ('regular', 'oneOff')),
  add column savings_cents bigint not null default 0 check (savings_cents >= 0),
  add column wants_cents bigint not null default 0 check (wants_cents >= 0),
  add constraint income_shares_within_amount check (savings_cents + wants_cents <= cents);

revoke update on public.income_receipts from authenticated;
grant update (received_on, source, cents, income_kind, savings_cents, wants_cents) on public.income_receipts to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The wants guide on each week plan. The screen never shows it above the
-- allowance in force, which can change midweek, so that is not a constraint.
-- ---------------------------------------------------------------------------
alter table public.week_plans
  add column wants_guide_cents bigint not null default 0 check (wants_guide_cents >= 0);

-- ---------------------------------------------------------------------------
-- 4. P = opening + closures + income savings - releases.
-- ---------------------------------------------------------------------------
create or replace function private.protected_cents(p_account_id uuid) returns bigint
language sql stable set search_path = '' as $$
  select a.opening_protected_cents
    + coalesce((select sum(c.protected_cents) from public.week_closures c where c.account_id = a.id), 0)::bigint
    + coalesce((select sum(i.savings_cents) from public.income_receipts i where i.account_id = a.id), 0)::bigint
    - coalesce((select sum(r.cents) from public.savings_releases r where r.account_id = a.id), 0)::bigint
  from public.accounts a
  where a.id = p_account_id
$$;

-- When closing an earlier week, cash leaves out income dated after it. The
-- savings from that same income must be left out too, or free cash would be
-- too low and the closure would protect less than it should.
create or replace function private.free_cents(p_account_id uuid, p_before date default null) returns bigint
language sql stable set search_path = '' as $$
  select private.cash_cents(a.id, p_before)
    - private.protected_cents(a.id)
    + coalesce((select sum(i.savings_cents) from public.income_receipts i
                where i.account_id = a.id and p_before is not null and i.received_on >= p_before), 0)::bigint
    - coalesce((select sum(b.cents) from public.bills b
                where b.account_id = a.id and b.due_on <= a.plan_end_date
                  and (b.paid_on is null or (p_before is not null and b.paid_on >= p_before))), 0)::bigint
  from public.accounts a
  where a.id = p_account_id
$$;

-- ---------------------------------------------------------------------------
-- 5. The guards.
--
-- A shared lock is not enough here. Two tabs could each delete a different
-- payment, each see savings still at or above zero without the other's
-- uncommitted delete, and together take it below zero. An income change that
-- touches savings takes the same exclusive lock as a release, so they run one
-- at a time. Other income saves keep the shared lock and do not queue.
-- ---------------------------------------------------------------------------
create or replace function private.guard_income_dates() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 or not private.hold_own_account(old.account_id) then
      return old;
    end if;
    if old.savings_cents > 0 then
      perform 1 from public.accounts a where a.id = old.account_id for update;
    end if;
    if private.week_is_closed(old.account_id, old.received_on) then
      raise exception 'That week is closed' using errcode = 'SS001';
    end if;
    return old;
  end if;

  if not private.hold_own_account(new.account_id) then
    return new;
  end if;
  if new.savings_cents <> (case when tg_op = 'UPDATE' then old.savings_cents else 0 end) then
    perform 1 from public.accounts a where a.id = new.account_id for update;
  end if;
  if tg_op = 'UPDATE' and private.week_is_closed(old.account_id, old.received_on) then
    raise exception 'That week is closed' using errcode = 'SS001';
  end if;
  if new.received_on > (now() at time zone 'utc')::date + 1 then
    raise exception 'That date is still to come' using errcode = 'SS004';
  end if;
  perform private.require_open_date(new.account_id, new.received_on);
  return new;
end;
$$;

-- Runs after the row changes, so it checks the totals as they now stand.
-- Raising an error undoes the change. Deleting a whole account cascades past
-- this, so a student can always delete their own data. Someone else's account
-- is left for the policy and foreign key to refuse, without revealing anything.
create function private.guard_income_savings() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  old_savings bigint := case when tg_op = 'INSERT' then 0 else old.savings_cents end;
  new_savings bigint := case when tg_op = 'DELETE' then 0 else new.savings_cents end;
  target_account uuid := case when tg_op = 'DELETE' then old.account_id else new.account_id end;
begin
  if pg_trigger_depth() > 1 or old_savings = new_savings then
    return null;
  end if;
  if not exists (
    select 1 from public.accounts a
    where a.id = target_account and a.user_id = (select auth.uid())
  ) then
    return null;
  end if;

  if private.protected_cents(target_account) < 0 then
    raise exception 'That savings has already been released' using errcode = 'SS009';
  end if;
  if new_savings > old_savings and private.free_cents(target_account) < 0 then
    raise exception 'Setting this aside would deepen a shortfall' using errcode = 'SS010';
  end if;
  return null;
end;
$$;

create trigger guard_income_savings
after insert or update or delete on public.income_receipts
for each row execute function private.guard_income_savings();

-- ---------------------------------------------------------------------------
-- Saving the new values. New parameters come last with defaults, so the app
-- keeps working until its forms are updated. Replacing a signature needs a drop.
-- ---------------------------------------------------------------------------
drop function public.create_account_with_plan(text, date, bigint, bigint, bigint, date, bigint, bigint);

create function public.create_account_with_plan(
  p_currency text,
  p_opening_date date,
  p_opening_cash_cents bigint,
  p_opening_protected_cents bigint,
  p_commitments_cents bigint,
  p_plan_end_date date,
  p_recommended_cents bigint,
  p_starting_allowance_cents bigint,
  p_needs_percent integer default 50,
  p_wants_percent integer default 30,
  p_savings_percent integer default 20,
  p_opening_wants_cents bigint default 0,
  p_wants_guide_cents bigint default 0
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_account_id uuid;
begin
  if p_opening_protected_cents > p_opening_cash_cents then
    raise exception 'Protected savings cannot be more than cash' using errcode = '23514';
  end if;

  -- F = C - P - B. The first allowance cannot need more than the free cash.
  if p_starting_allowance_cents >
     greatest(p_opening_cash_cents - p_opening_protected_cents - p_commitments_cents, 0) then
    raise exception 'Allowance is more than the free cash' using errcode = '23514';
  end if;

  insert into public.accounts (
    currency, opening_date, opening_cash_cents, opening_protected_cents, plan_end_date,
    needs_percent, wants_percent, savings_percent, opening_wants_cents
  ) values (
    p_currency, p_opening_date, p_opening_cash_cents, p_opening_protected_cents, p_plan_end_date,
    p_needs_percent, p_wants_percent, p_savings_percent, p_opening_wants_cents
  ) returning id into new_account_id;

  insert into public.week_plans (account_id, week_start, recommended_cents, starting_allowance_cents, wants_guide_cents)
  values (
    new_account_id,
    -- The Monday of the week containing the opening date.
    (date_trunc('week', p_opening_date::timestamp))::date,
    p_recommended_cents,
    p_starting_allowance_cents,
    p_wants_guide_cents
  );

  if p_commitments_cents > 0 then
    insert into public.bills (id, account_id, name, due_on, cents)
    values (gen_random_uuid(), new_account_id, 'Bills from setup', p_plan_end_date, p_commitments_cents);
  end if;

  return new_account_id;
end;
$$;

revoke all on function public.create_account_with_plan(text, date, bigint, bigint, bigint, date, bigint, bigint, integer, integer, integer, bigint, bigint) from public, anon;
grant execute on function public.create_account_with_plan(text, date, bigint, bigint, bigint, date, bigint, bigint, integer, integer, integer, bigint, bigint) to authenticated;

drop function public.start_new_plan(uuid, date, date, bigint, bigint);

create function public.start_new_plan(
  p_account_id uuid,
  p_today date,
  p_end_date date,
  p_recommended_cents bigint,
  p_starting_allowance_cents bigint,
  p_wants_guide_cents bigint default 0
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  account public.accounts%rowtype;
  this_monday date := (date_trunc('week', p_today::timestamp))::date;
begin
  select a.* into account from public.accounts a
  where a.id = p_account_id and a.user_id = (select auth.uid())
  for update;
  if not found then
    raise exception 'Account not found' using errcode = '42501';
  end if;

  if p_today is null or p_end_date is null
     or p_today > (now() at time zone 'utc')::date + 1
     or p_today < (now() at time zone 'utc')::date - 1 then
    raise exception 'That date is not today' using errcode = '22023';
  end if;

  -- Already this end date means a repeated save: there is nothing to move.
  if account.plan_end_date <> p_end_date then
    if p_today < account.plan_end_date then
      raise exception 'That plan is still running' using errcode = 'SS006';
    end if;
    if p_end_date < p_today then
      raise exception 'A plan cannot end before today' using errcode = '23514';
    end if;

    update public.accounts set plan_end_date = p_end_date where id = p_account_id;
  end if;

  if exists (
    select 1 from public.week_plans w
    where w.account_id = p_account_id and w.week_start = this_monday
  ) then
    return;
  end if;

  if p_recommended_cents is null or p_starting_allowance_cents is null then
    raise exception 'This week needs an allowance' using errcode = '23514';
  end if;

  -- Worked out after the date has moved. The browser previews this rule; this
  -- is what enforces it. Nothing is spent yet in a week with no plan.
  if p_starting_allowance_cents > greatest(private.free_cents(p_account_id), 0) then
    raise exception 'Allowance is more than the free cash' using errcode = 'SS003';
  end if;

  insert into public.week_plans (user_id, account_id, week_start, recommended_cents, starting_allowance_cents, wants_guide_cents)
  values (account.user_id, p_account_id, this_monday, p_recommended_cents, p_starting_allowance_cents, p_wants_guide_cents);
end;
$$;

revoke all on function public.start_new_plan(uuid, date, date, bigint, bigint, bigint) from public, anon;
grant execute on function public.start_new_plan(uuid, date, date, bigint, bigint, bigint) to authenticated;
