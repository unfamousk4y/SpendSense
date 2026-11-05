-- Migration 7: dated bills, and paying them.
--
-- B = unpaid bills due on or before the plan end. C = opening cash + income -
-- purchases - bill payments. Payment details sit on the bill's own row, so one
-- row update changes C and B together, with nothing that could half succeed.
--
-- accounts.commitments_cents is no longer read by anything here. It is still
-- written at setup until the app has moved over; a later migration removes it.
create table public.bills (
  -- Made by the browser once per form opening, so a repeated save is the same row.
  id uuid primary key,
  user_id uuid not null default auth.uid(),
  account_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  due_on date not null,
  -- Matches the app: more than 0, at most 100,000.00.
  cents bigint not null check (cents > 0 and cents <= 10000000),
  paid_on date,
  -- What it actually cost, which can differ from the amount expected.
  paid_cents bigint check (paid_cents > 0 and paid_cents <= 10000000),
  created_at timestamptz not null default now(),
  -- Paid has both a date and an amount; unpaid has neither.
  constraint paid_has_date_and_amount check ((paid_on is null) = (paid_cents is null)),
  foreign key (account_id, user_id) references public.accounts (id, user_id) on delete cascade
);

create index bills_user_account_due on public.bills (user_id, account_id, due_on);

-- New tables start with no browser access, so this lists exactly what is allowed.
grant select, insert, update, delete on public.bills to authenticated;

alter table public.bills enable row level security;

create policy "own bills" on public.bills for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- A payment is history once its week closes, and cannot be dated ahead. An
-- unpaid bill moves no cash, so it can change at any time: closed weeks stored
-- their own amounts and are not rewritten.
-- SS001 the payment's week is closed, or it is before the account opened
-- SS005 the payment date is still to come
-- This one is security invoker, like the purchase and income guards.
-- ---------------------------------------------------------------------------
create function private.guard_bill_payments() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- Deleting a whole account cascades to its bills; a student's right to
  -- delete their own data must not be blocked by their own closed weeks.
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;

  if tg_op in ('UPDATE', 'DELETE') and old.paid_on is not null and exists (
    select 1 from public.week_closures c
    where c.account_id = old.account_id
      and c.week_start = (date_trunc('week', old.paid_on::timestamp))::date
  ) then
    raise exception 'That week is closed' using errcode = 'SS001';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  if new.paid_on is null then
    return new;
  end if;

  -- At most one day ahead of UTC, the furthest ahead any time zone reaches.
  if new.paid_on > (now() at time zone 'utc')::date + 1 then
    raise exception 'That date is still to come' using errcode = 'SS005';
  end if;

  if exists (
    select 1 from public.week_closures c
    where c.account_id = new.account_id
      and c.week_start = (date_trunc('week', new.paid_on::timestamp))::date
  ) or exists (
    select 1 from public.accounts a
    where a.id = new.account_id and new.paid_on < a.opening_date
  ) then
    raise exception 'That date cannot be changed' using errcode = 'SS001';
  end if;

  return new;
end;
$$;

create trigger guard_bill_payments
before insert or update or delete on public.bills
for each row execute function private.guard_bill_payments();

-- ---------------------------------------------------------------------------
-- F = C - P - B, as of p_before when closing a past week: a payment dated on or
-- after that day has not left cash yet, so its bill still counts as unpaid.
-- ---------------------------------------------------------------------------
create or replace function private.free_cents(p_account_id uuid, p_before date default null) returns bigint
language sql stable set search_path = '' as $$
  select a.opening_cash_cents
    + coalesce((select sum(i.cents) from public.income_receipts i
                where i.account_id = a.id and (p_before is null or i.received_on < p_before)), 0)::bigint
    - coalesce((select sum(p.cents) from public.purchases p
                where p.account_id = a.id and (p_before is null or p.date < p_before)), 0)::bigint
    - coalesce((select sum(b.paid_cents) from public.bills b
                where b.account_id = a.id and b.paid_on is not null
                  and (p_before is null or b.paid_on < p_before)), 0)::bigint
    - private.protected_cents(a.id)
    - coalesce((select sum(b.cents) from public.bills b
                where b.account_id = a.id and b.due_on <= a.plan_end_date
                  and (b.paid_on is null or (p_before is not null and b.paid_on >= p_before))), 0)::bigint
  from public.accounts a
  where a.id = p_account_id
$$;

-- ---------------------------------------------------------------------------
-- Setup still asks for one total. It becomes one bill the student can edit or
-- split. Same signature, so the existing grants stay as they are. Still one
-- transaction: all three rows exist afterwards, or none do.
-- ---------------------------------------------------------------------------
create or replace function public.create_account_with_plan(
  p_currency text,
  p_opening_date date,
  p_opening_cash_cents bigint,
  p_opening_protected_cents bigint,
  p_commitments_cents bigint,
  p_plan_end_date date,
  p_recommended_cents bigint,
  p_starting_allowance_cents bigint
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
    currency, opening_date, opening_cash_cents, opening_protected_cents, commitments_cents, plan_end_date
  ) values (
    p_currency, p_opening_date, p_opening_cash_cents, p_opening_protected_cents, p_commitments_cents, p_plan_end_date
  ) returning id into new_account_id;

  insert into public.week_plans (account_id, week_start, recommended_cents, starting_allowance_cents)
  values (
    new_account_id,
    -- The Monday of the week containing the opening date.
    (date_trunc('week', p_opening_date::timestamp))::date,
    p_recommended_cents,
    p_starting_allowance_cents
  );

  if p_commitments_cents > 0 then
    insert into public.bills (id, account_id, name, due_on, cents)
    values (gen_random_uuid(), new_account_id, 'Bills from setup', p_plan_end_date, p_commitments_cents);
  end if;

  return new_account_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Any total already saved becomes a bill the same way.
-- ---------------------------------------------------------------------------
insert into public.bills (id, user_id, account_id, name, due_on, cents)
select gen_random_uuid(), a.user_id, a.id, 'Bills from setup', a.plan_end_date, a.commitments_cents
from public.accounts a
where a.commitments_cents > 0;
