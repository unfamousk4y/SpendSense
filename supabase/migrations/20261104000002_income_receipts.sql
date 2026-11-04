-- Migration 6: money the student has actually received.
--
-- Income is the student's own record, so it is written directly under row-level
-- security with no elevated function. The trigger below holds the rules the
-- browser cannot be trusted with. Cash is derived, never stored:
-- C = opening cash + income - purchases.
create table public.income_receipts (
  -- Made by the browser once per form opening, so a repeated save is the same row.
  id uuid primary key,
  user_id uuid not null default auth.uid(),
  account_id uuid not null,
  received_on date not null,
  source text check (char_length(source) <= 60),
  -- Matches the app: more than 0, at most 100,000.00.
  cents bigint not null check (cents > 0 and cents <= 10000000),
  created_at timestamptz not null default now(),
  foreign key (account_id, user_id) references public.accounts (id, user_id) on delete cascade
);

create index income_receipts_user_account_date on public.income_receipts (user_id, account_id, received_on);

-- New tables start with no browser access, so this lists exactly what is allowed.
grant select, insert, update, delete on public.income_receipts to authenticated;

alter table public.income_receipts enable row level security;

create policy "own income" on public.income_receipts for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Closed history stays as it is, and expected money cannot be recorded. Same
-- rules as purchases, plus the future date check: received_on may be at most
-- one day ahead of UTC, the furthest ahead any time zone reaches.
-- SS001 the week is closed, or the date is before the account opened
-- SS004 the date is still to come
-- This one is security invoker, like the purchase guard.
-- ---------------------------------------------------------------------------
create function private.guard_income_dates() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- Deleting a whole account cascades to its income; a student's right to
  -- delete their own data must not be blocked by their own closed weeks.
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;

  if tg_op in ('UPDATE', 'DELETE') and exists (
    select 1 from public.week_closures c
    where c.account_id = old.account_id
      and c.week_start = (date_trunc('week', old.received_on::timestamp))::date
  ) then
    raise exception 'That week is closed' using errcode = 'SS001';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  if new.received_on > (now() at time zone 'utc')::date + 1 then
    raise exception 'That date is still to come' using errcode = 'SS004';
  end if;

  if exists (
    select 1 from public.week_closures c
    where c.account_id = new.account_id
      and c.week_start = (date_trunc('week', new.received_on::timestamp))::date
  ) or exists (
    select 1 from public.accounts a
    where a.id = new.account_id and new.received_on < a.opening_date
  ) then
    raise exception 'That date cannot be changed' using errcode = 'SS001';
  end if;

  return new;
end;
$$;

create trigger guard_income_dates
before insert or update or delete on public.income_receipts
for each row execute function private.guard_income_dates();

-- ---------------------------------------------------------------------------
-- F = C - P - B now counts income, so closing a week and changing the allowance
-- both see it. Income dated before p_before counts, the same as purchases.
-- ---------------------------------------------------------------------------
create or replace function private.free_cents(p_account_id uuid, p_before date default null) returns bigint
language sql stable set search_path = '' as $$
  select a.opening_cash_cents
    + coalesce((select sum(i.cents) from public.income_receipts i
                where i.account_id = a.id and (p_before is null or i.received_on < p_before)), 0)::bigint
    - coalesce((select sum(p.cents) from public.purchases p
                where p.account_id = a.id and (p_before is null or p.date < p_before)), 0)::bigint
    - private.protected_cents(a.id)
    - a.commitments_cents
  from public.accounts a
  where a.id = p_account_id
$$;
