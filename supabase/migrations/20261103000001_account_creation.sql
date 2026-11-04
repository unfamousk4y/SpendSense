-- Migration 2: setting up an account. Paste the whole file into the Supabase
-- SQL editor and run it once, after the core schema.

-- The opening amounts are true on the day the student sets up, which can be
-- any day of the week. Week plans still have to start on a Monday.
alter table public.accounts drop constraint accounts_opening_date_check;

-- Creates an account and its first week plan together: a function call is one
-- transaction, so either both rows exist afterwards or neither does.
--
-- security invoker: it runs as the signed-in student, so row-level security
-- still applies. There is no owner parameter: user_id comes from auth.uid().
-- search_path is empty so every name below is written out in full and cannot
-- be redirected to a look-alike table.
--
-- The browser previews these rules; this function is what enforces them.
-- 23514 is the same error code a check constraint gives.
create function public.create_account_with_plan(
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

  return new_account_id;
end;
$$;

-- Functions can be called by everyone unless this is taken away.
revoke all on function public.create_account_with_plan(text, date, bigint, bigint, bigint, date, bigint, bigint)
  from public, anon;
grant execute on function public.create_account_with_plan(text, date, bigint, bigint, bigint, date, bigint, bigint)
  to authenticated;
