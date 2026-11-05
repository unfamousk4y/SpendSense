-- Migration 9: paying part of a bill and still owing the rest.
--
-- The bill becomes the part that was paid, and a new unpaid bill with the same
-- name and due date holds the rest. Both changes are one transaction, so the
-- money owed can never vanish or be counted twice.
--
-- security invoker: it runs as the signed-in student, so row-level security and
-- the bill payment guard both still apply. There is no owner parameter.
-- p_rest_id is made by the browser once per form opening, so a repeated save is
-- recognised rather than splitting the bill a second time.
create function public.pay_bill_keep_rest(
  p_bill_id uuid,
  p_rest_id uuid,
  p_paid_on date,
  p_paid_cents bigint
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  bill public.bills;
begin
  select * into bill from public.bills b where b.id = p_bill_id for update;
  if not found then
    raise exception 'Bill not found' using errcode = '42501';
  end if;

  -- Already saved, and the reply was lost: nothing is left to do. The same id
  -- with different details is not a retry.
  if exists (select 1 from public.bills b where b.id = p_rest_id) then
    if bill.paid_on = p_paid_on and bill.paid_cents = p_paid_cents then
      return;
    end if;
    raise exception 'That split was already saved differently' using errcode = '23505';
  end if;

  if p_paid_cents >= bill.cents then
    raise exception 'A payment that leaves nothing owed is not a split' using errcode = '23514';
  end if;

  update public.bills
  set cents = p_paid_cents, paid_on = p_paid_on, paid_cents = p_paid_cents
  where id = p_bill_id;

  insert into public.bills (id, account_id, name, due_on, cents)
  values (p_rest_id, bill.account_id, bill.name, bill.due_on, bill.cents - p_paid_cents);
end;
$$;

-- New functions start with no browser access, so this lists exactly what is allowed.
revoke all on function public.pay_bill_keep_rest(uuid, uuid, date, bigint) from public, anon;
grant execute on function public.pay_bill_keep_rest(uuid, uuid, date, bigint) to authenticated;
