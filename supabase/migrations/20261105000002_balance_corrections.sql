-- Migration 11: labelled balance corrections.
--
-- A correction is the signed difference between the app's cash and the balance
-- the student can see. It is not spending or income. Cash is derived, never
-- stored: C = opening cash + income - purchases - bill payments + corrections.
--
-- Written directly under row-level security with no elevated function, like
-- income. The trigger holds the rules the browser cannot be trusted with.
create table public.balance_corrections (
  -- Made by the browser once per form opening, so a repeated save is the same row.
  id uuid primary key,
  user_id uuid not null default auth.uid(),
  account_id uuid not null,
  corrected_on date not null,
  -- Signed, never zero, at most 100,000.00 either way.
  difference_cents bigint not null check (difference_cents <> 0 and abs(difference_cents) <= 10000000),
  note text check (char_length(note) <= 120),
  created_at timestamptz not null default now(),
  foreign key (account_id, user_id) references public.accounts (id, user_id) on delete cascade
);

create index balance_corrections_user_account_date on public.balance_corrections (user_id, account_id, corrected_on);

-- New tables start with no browser access, so this lists exactly what is allowed.
-- No update: a wrong correction is undone and entered again.
grant select, insert, delete on public.balance_corrections to authenticated;

alter table public.balance_corrections enable row level security;

create policy "own balance corrections" on public.balance_corrections for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Closed history stays as it is, and a correction cannot be dated ahead.
-- SS001 the week is closed, or the date is before the account opened
-- SS007 the date is still to come
-- This one is security invoker, like the purchase and income guards.
-- ---------------------------------------------------------------------------
create function private.guard_correction_dates() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    -- Deleting a whole account cascades to its corrections; a student's right
    -- to delete their own data must not be blocked by their own closed weeks.
    if pg_trigger_depth() > 1 then
      return old;
    end if;

    if exists (
      select 1 from public.week_closures c
      where c.account_id = old.account_id
        and c.week_start = (date_trunc('week', old.corrected_on::timestamp))::date
    ) then
      raise exception 'That week is closed' using errcode = 'SS001';
    end if;

    return old;
  end if;

  -- At most one day ahead of UTC, the furthest ahead any time zone reaches.
  if new.corrected_on > (now() at time zone 'utc')::date + 1 then
    raise exception 'That date is still to come' using errcode = 'SS007';
  end if;

  if exists (
    select 1 from public.week_closures c
    where c.account_id = new.account_id
      and c.week_start = (date_trunc('week', new.corrected_on::timestamp))::date
  ) or exists (
    select 1 from public.accounts a
    where a.id = new.account_id and new.corrected_on < a.opening_date
  ) then
    raise exception 'That date cannot be changed' using errcode = 'SS001';
  end if;

  return new;
end;
$$;

create trigger guard_correction_dates
before insert or delete on public.balance_corrections
for each row execute function private.guard_correction_dates();

-- ---------------------------------------------------------------------------
-- F = C - P - B now counts corrections, so closing a week and changing the
-- allowance both see them. Those dated before p_before count, as with income.
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
    + coalesce((select sum(r.difference_cents) from public.balance_corrections r
                where r.account_id = a.id and (p_before is null or r.corrected_on < p_before)), 0)::bigint
    - private.protected_cents(a.id)
    - coalesce((select sum(b.cents) from public.bills b
                where b.account_id = a.id and b.due_on <= a.plan_end_date
                  and (b.paid_on is null or (p_before is not null and b.paid_on >= p_before))), 0)::bigint
  from public.accounts a
  where a.id = p_account_id
$$;
