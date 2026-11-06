-- Migration 13: only invited email addresses can create an account.
--
-- Supabase Auth calls this function just before it creates a new user, once the
-- function is chosen as the "Before User Created" hook in the dashboard. Until
-- then it does nothing, which is why the development project, whose tests sign
-- up throwaway users, is unaffected by having it.
--
-- The hook only runs when an account is created. Taking an address off the list
-- stops a new sign-up, but someone who already has an account keeps it.

-- Lives in the private schema, which the browser's API cannot reach. The addresses
-- are added by hand in the beta project's SQL editor and never go in a migration:
--   insert into private.signup_allow_list (email) values ('someone@example.test');
create table private.signup_allow_list (
  email text primary key check (email = lower(btrim(email)) and email <> ''),
  added_at timestamptz not null default now()
);
alter table private.signup_allow_list enable row level security;
revoke all on private.signup_allow_list from public, anon, authenticated;

-- Refuses by default: an empty list, or a request with no email, lets nobody in.
-- Definer rights so that Auth's role needs no access to the private schema.
create function public.hook_signup_allow_list(event jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  candidate text := lower(btrim(event -> 'user' ->> 'email'));
begin
  if exists (select 1 from private.signup_allow_list where email = candidate) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', 'SpendSense is invite-only during the beta.'
  ));
end;
$$;

-- Only Auth may call it. The browser's roles must not be able to test addresses
-- to find out who was invited.
revoke all on function public.hook_signup_allow_list(jsonb) from public, anon, authenticated;
grant execute on function public.hook_signup_allow_list(jsonb) to supabase_auth_admin;
