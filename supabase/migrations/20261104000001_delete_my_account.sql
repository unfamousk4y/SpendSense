-- Migration 5: a student can delete their whole account.
--
-- security definer, reviewed: students have no rights on auth.users, so this
-- runs with the owner's rights. It takes no parameters and only ever deletes the
-- row for auth.uid(), so it cannot be aimed at anyone else. search_path is empty
-- so every name is written out in full.
--
-- Deleting the user removes their accounts through the foreign key, and that
-- removes everything linked to those accounts, all in this one transaction.
-- Calling it again after success has nothing left to do.
create function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  delete from auth.users where id = (select auth.uid());
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
