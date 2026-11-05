-- Migration 8: bills are now the only record of what is owed, so the old single
-- total goes. Every total saved before migration 7 was converted into a bill
-- there, and nothing calculates from this column any more.
--
-- Setup still asks for one total. It only becomes the first bill now, so the
-- function keeps its signature and its existing grants.
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
    currency, opening_date, opening_cash_cents, opening_protected_cents, plan_end_date
  ) values (
    p_currency, p_opening_date, p_opening_cash_cents, p_opening_protected_cents, p_plan_end_date
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

alter table public.accounts drop column commitments_cents;
