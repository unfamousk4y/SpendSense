-- Migration 4: new tables and functions start closed.
--
-- Supabase's default settings give anon (signed-out visitors) and authenticated
-- full access to every new table and function in the public schema. Until now
-- only each migration's own revoke undid that, so one forgotten line would
-- leave a new table protected by row-level security alone, or by nothing.
--
-- These settings only affect objects created later, by the postgres role.
-- Existing grants do not change. From now on a migration must grant explicitly
-- whatever the browser needs, which every migration here already does.

alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on functions from anon, authenticated;

-- Postgres also lets everyone (PUBLIC) run any new function. That setting cannot
-- be removed for one schema, so this applies to every schema postgres creates
-- functions in. The private helpers are unaffected: they are called by the
-- checked functions, or fired by a trigger, and new ones work the same way.
alter default privileges for role postgres
  revoke execute on functions from public;
