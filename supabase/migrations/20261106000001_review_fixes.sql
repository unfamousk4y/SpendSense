-- Migration 12: fixes from the quality review.
--
-- 1. A save can no longer land in a week while it closes.
-- 2. Entries must be dated in a week that has a plan.
-- 3. An entry can no longer be moved to another account, or another currency.
-- 4. Opening amounts must make sense, even when inserted directly.
-- 5. A balance correction is refused if cash changed after the form worked it out.

-- ---------------------------------------------------------------------------
-- 4. Setup already checks these. Now the database does for every insert.
-- ---------------------------------------------------------------------------
alter table public.accounts
  add constraint opening_cash_not_negative check (opening_cash_cents >= 0),
  add constraint opening_protected_within_cash check (opening_protected_cents <= opening_cash_cents);

-- ---------------------------------------------------------------------------
-- 3. Each table keeps the same update rights, minus the columns that say whose
-- it is and which account it belongs to.
-- ---------------------------------------------------------------------------
revoke update on public.purchases from authenticated;
grant update (date, merchant, note, category, need_or_want, cents) on public.purchases to authenticated;

revoke update on public.income_receipts from authenticated;
grant update (received_on, source, cents) on public.income_receipts to authenticated;

revoke update on public.bills from authenticated;
grant update (name, due_on, cents, paid_on, paid_cents) on public.bills to authenticated;

-- ---------------------------------------------------------------------------
-- 1 and 2. Helpers for the guards.
--
-- Closing a week locks the account row until it commits. A guard that takes a
-- shared lock on that row waits for the closure to finish and then sees it, and
-- a closure that starts later waits for the save and then counts it. Without
-- this, a save could check for a closure just before one committed.
--
-- These need to read and lock the account row, which browsers have no right to
-- do, so the guards below are now security definer. They live in the private
-- schema, are never callable from the browser, and only act on the signed-in
-- student's own account.
-- ---------------------------------------------------------------------------

-- false if it is not this student's account: the policy or foreign key refuses
-- the row afterwards, and a guard says nothing about someone else's weeks.
create function private.hold_own_account(p_account_id uuid) returns boolean
language plpgsql set search_path = '' as $$
begin
  perform 1 from public.accounts a
  where a.id = p_account_id and a.user_id = (select auth.uid())
  for share;
  return found;
end;
$$;

create function private.week_is_closed(p_account_id uuid, p_date date) returns boolean
language sql stable set search_path = '' as $$
  select exists (
    select 1 from public.week_closures c
    where c.account_id = p_account_id
      and c.week_start = (date_trunc('week', p_date::timestamp))::date
  )
$$;

-- SS001: the week is closed, has no plan, or is before the account opened.
create function private.require_open_date(p_account_id uuid, p_date date) returns void
language plpgsql set search_path = '' as $$
begin
  if private.week_is_closed(p_account_id, p_date)
    or exists (
      select 1 from public.accounts a
      where a.id = p_account_id and p_date < a.opening_date
    )
    or not exists (
      select 1 from public.week_plans w
      where w.account_id = p_account_id
        and w.week_start = (date_trunc('week', p_date::timestamp))::date
    )
  then
    raise exception 'That date cannot be changed' using errcode = 'SS001';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- The guards. In each, deleting a whole account cascades past the checks: a
-- student's right to delete their own data must not be blocked by closed weeks.
-- ---------------------------------------------------------------------------
create or replace function private.guard_purchase_dates() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 or not private.hold_own_account(old.account_id) then
      return old;
    end if;
    if private.week_is_closed(old.account_id, old.date) then
      raise exception 'That week is closed' using errcode = 'SS001';
    end if;
    return old;
  end if;

  if not private.hold_own_account(new.account_id) then
    return new;
  end if;
  if tg_op = 'UPDATE' and private.week_is_closed(old.account_id, old.date) then
    raise exception 'That week is closed' using errcode = 'SS001';
  end if;
  perform private.require_open_date(new.account_id, new.date);
  return new;
end;
$$;

-- SS004: the date is still to come. At most one day ahead of UTC, the furthest
-- ahead any time zone reaches.
create or replace function private.guard_income_dates() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 or not private.hold_own_account(old.account_id) then
      return old;
    end if;
    if private.week_is_closed(old.account_id, old.received_on) then
      raise exception 'That week is closed' using errcode = 'SS001';
    end if;
    return old;
  end if;

  if not private.hold_own_account(new.account_id) then
    return new;
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

-- An unpaid bill moves no cash, so it can change at any time. Only a payment
-- needs the checks. SS005: the payment date is still to come.
create or replace function private.guard_bill_payments() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 or old.paid_on is null or not private.hold_own_account(old.account_id) then
      return old;
    end if;
    if private.week_is_closed(old.account_id, old.paid_on) then
      raise exception 'That week is closed' using errcode = 'SS001';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and old.paid_on is not null then
    if not private.hold_own_account(old.account_id) then
      return new;
    end if;
    if private.week_is_closed(old.account_id, old.paid_on) then
      raise exception 'That week is closed' using errcode = 'SS001';
    end if;
  end if;

  if new.paid_on is null or not private.hold_own_account(new.account_id) then
    return new;
  end if;
  if new.paid_on > (now() at time zone 'utc')::date + 1 then
    raise exception 'That date is still to come' using errcode = 'SS005';
  end if;
  perform private.require_open_date(new.account_id, new.paid_on);
  return new;
end;
$$;

-- SS007: the date is still to come.
create or replace function private.guard_correction_dates() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 or not private.hold_own_account(old.account_id) then
      return old;
    end if;
    if private.week_is_closed(old.account_id, old.corrected_on) then
      raise exception 'That week is closed' using errcode = 'SS001';
    end if;
    return old;
  end if;

  if not private.hold_own_account(new.account_id) then
    return new;
  end if;
  if new.corrected_on > (now() at time zone 'utc')::date + 1 then
    raise exception 'That date is still to come' using errcode = 'SS007';
  end if;
  perform private.require_open_date(new.account_id, new.corrected_on);
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Cash on its own, so a correction can compare it. Free cash uses the same
-- calculation, so the two cannot drift apart.
-- ---------------------------------------------------------------------------
create function private.cash_cents(p_account_id uuid, p_before date default null) returns bigint
language sql stable set search_path = '' as $$
  select a.opening_cash_cents
    + coalesce((select sum(i.cents) from public.income_receipts i
                where i.account_id = a.id and (p_before is null or i.received_on < p_before)), 0)::bigint
    - coalesce((select sum(p.cents) from public.purchases p
                where p.account_id = a.id and (p_before is null or p.date < p_before)), 0)::bigint
    - coalesce((select sum(b.paid_cents) from public.bills b
                where b.account_id = a.id and b.paid_on is not null
                  and (p_before is null or b.paid_on < p_before)), 0)::bigint
    + coalesce((select sum(r.difference_cents) from public.balance_corrections r
                where r.account_id = a.id and (p_before is null or r.corrected_on < p_before)), 0)::bigint
  from public.accounts a
  where a.id = p_account_id
$$;

create or replace function private.free_cents(p_account_id uuid, p_before date default null) returns bigint
language sql stable set search_path = '' as $$
  select private.cash_cents(a.id, p_before)
    - private.protected_cents(a.id)
    - coalesce((select sum(b.cents) from public.bills b
                where b.account_id = a.id and b.due_on <= a.plan_end_date
                  and (b.paid_on is null or (p_before is not null and b.paid_on >= p_before))), 0)::bigint
  from public.accounts a
  where a.id = p_account_id
$$;

-- The form works out the difference from the cash on screen. If another tab or
-- device changed cash since, that difference is wrong, so it is refused. A
-- repeat of a saved id succeeds first: a retry after a lost reply must not fail
-- because its own first attempt changed the cash.
--
-- security definer: it reads cash across tables through a private helper.
-- There is no owner parameter: the account must belong to auth.uid().
-- SS008 cash changed since the form worked out the difference
create function public.save_balance_correction(
  p_id uuid,
  p_account_id uuid,
  p_corrected_on date,
  p_difference_cents bigint,
  p_note text,
  p_seen_cash_cents bigint
) returns void
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

  select c.user_id into existing_owner from public.balance_corrections c where c.id = p_id;
  if found then
    if existing_owner = owner_id then
      return;
    end if;
    raise exception 'That id cannot be used' using errcode = '23505';
  end if;

  if private.cash_cents(p_account_id) <> p_seen_cash_cents then
    raise exception 'Cash has changed' using errcode = 'SS008';
  end if;

  insert into public.balance_corrections (id, user_id, account_id, corrected_on, difference_cents, note)
  values (p_id, owner_id, p_account_id, p_corrected_on, p_difference_cents, p_note);
end;
$$;

-- New functions start with no browser access, so this lists exactly what is allowed.
revoke all on function public.save_balance_correction(uuid, uuid, date, bigint, text, bigint) from public, anon;
grant execute on function public.save_balance_correction(uuid, uuid, date, bigint, text, bigint) to authenticated;

-- The function is now the only way to add one. Undoing is still a direct delete.
revoke insert on public.balance_corrections from authenticated;
