-- Migration 10: starting a new plan once the current one reaches its last day.
--
-- Cash, savings, bills and history all carry over. Only the end date moves, so
-- bills and free cash are worked out against the new date from then on. Closed
-- weeks stored their own amounts, so they are not rewritten.
--
-- security definer, like the other checked operations: browsers have no right
-- to change an account row, and this keeps it that way. There is no owner
-- parameter: the account must belong to auth.uid(). search_path is empty, so
-- every name is written out in full.
--
-- p_today is the student's local date, which the database cannot know. It may
-- be at most one day either side of UTC, the furthest any time zone reaches.
-- p_recommended_cents and p_starting_allowance_cents are used only when this
-- week has no plan yet. A week that has one keeps it: allowances never change
-- by themselves.
--
-- SS006 the plan has not reached its last day
create function public.start_new_plan(
  p_account_id uuid,
  p_today date,
  p_end_date date,
  p_recommended_cents bigint,
  p_starting_allowance_cents bigint
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

  insert into public.week_plans (user_id, account_id, week_start, recommended_cents, starting_allowance_cents)
  values (account.user_id, p_account_id, this_monday, p_recommended_cents, p_starting_allowance_cents);
end;
$$;

-- New functions start with no browser access, so this lists exactly what is allowed.
revoke all on function public.start_new_plan(uuid, date, date, bigint, bigint) from public, anon;
grant execute on function public.start_new_plan(uuid, date, date, bigint, bigint) to authenticated;
