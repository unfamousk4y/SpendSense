-- SpendSense core schema, stage 1: tables for the current ledger, ownership
-- on every row, and row-level security. Paste the whole file into the Supabase
-- SQL editor and run it once.
--
-- Ownership model
-- * Every table has user_id, filled from auth.uid() (the signed-in user, taken
--   from the session token, so a browser cannot choose it).
-- * Row-level security policies only allow rows where user_id = auth.uid().
-- * Child rows reference their parent with (parent_id, user_id) together, so a
--   row can never point at a parent owned by someone else (a forged link).
-- * week_closures and savings_releases are read-only from the browser for now.
--   They will be written by checked database functions in a later migration.
--
-- Money is whole cents (bigint). Dates are calendar dates in the student's
-- local time zone (date, no time). Currencies are never mixed in one row.

-- ---------------------------------------------------------------------------
-- accounts: one per user and currency
-- ---------------------------------------------------------------------------
create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  currency text not null check (currency in ('USD', 'BSD')),
  -- C and P at the start of the first planned week (opening_date, a Monday).
  opening_date date not null check (extract(isodow from opening_date) = 1),
  opening_cash_cents bigint not null,
  opening_protected_cents bigint not null check (opening_protected_cents >= 0),
  -- B: unpaid bills due by the plan end. One amount for now; dated bills later.
  commitments_cents bigint not null check (commitments_cents >= 0),
  plan_end_date date not null check (plan_end_date >= opening_date),
  created_at timestamptz not null default now(),
  unique (user_id, currency),
  -- Lets child tables reference (id, user_id) together.
  unique (id, user_id)
);

-- ---------------------------------------------------------------------------
-- purchases: discretionary spending. id is made by the browser once per form
-- opening, so a repeated save is the same row (idempotency key).
-- ---------------------------------------------------------------------------
create table public.purchases (
  id uuid primary key,
  user_id uuid not null default auth.uid(),
  account_id uuid not null,
  date date not null,
  merchant text not null default '' check (char_length(merchant) <= 60),
  note text check (char_length(note) <= 120),
  category text check (category in ('food', 'transport', 'school', 'personalCare', 'phoneBills', 'fun')),
  need_or_want text check (need_or_want in ('need', 'want')),
  -- Matches the app: more than 0, at most 100,000.00.
  cents bigint not null check (cents > 0 and cents <= 10000000),
  created_at timestamptz not null default now(),
  foreign key (account_id, user_id) references public.accounts (id, user_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- week_plans: the allowance snapshot taken when a week starts
-- ---------------------------------------------------------------------------
create table public.week_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  account_id uuid not null,
  week_start date not null check (extract(isodow from week_start) = 1),
  recommended_cents bigint not null check (recommended_cents >= 0),
  starting_allowance_cents bigint not null check (starting_allowance_cents >= 0),
  created_at timestamptz not null default now(),
  unique (account_id, week_start),
  unique (id, user_id),
  foreign key (account_id, user_id) references public.accounts (id, user_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- allowance_changes: the before/after record of each midweek change
-- ---------------------------------------------------------------------------
create table public.allowance_changes (
  id uuid primary key,
  user_id uuid not null default auth.uid(),
  week_plan_id uuid not null,
  made_on date not null,
  from_cents bigint not null check (from_cents >= 0),
  to_cents bigint not null check (to_cents >= 0),
  suggested_cents bigint check (suggested_cents >= 0),
  created_at timestamptz not null default now(),
  foreign key (week_plan_id, user_id) references public.week_plans (id, user_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- week_closures: one per account and week, never two (exactly-once closure)
-- ---------------------------------------------------------------------------
create table public.week_closures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  account_id uuid not null,
  week_start date not null check (extract(isodow from week_start) = 1),
  allowance_cents bigint not null check (allowance_cents >= 0),
  spent_cents bigint not null check (spent_cents >= 0),
  leftover_cents bigint not null check (leftover_cents = allowance_cents - spent_cents),
  -- min(max(0, A - S), max(0, F)): never negative, never more than the leftover.
  protected_cents bigint not null check (protected_cents >= 0 and protected_cents <= greatest(leftover_cents, 0)),
  created_at timestamptz not null default now(),
  unique (account_id, week_start),
  foreign key (account_id, user_id) references public.accounts (id, user_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- savings_releases: explicit releases of protected savings
-- ---------------------------------------------------------------------------
create table public.savings_releases (
  id uuid primary key,
  user_id uuid not null default auth.uid(),
  account_id uuid not null,
  made_on date not null,
  cents bigint not null check (cents > 0),
  created_at timestamptz not null default now(),
  foreign key (account_id, user_id) references public.accounts (id, user_id) on delete cascade
);

-- Indexes for the columns every policy and lookup filters on.
create index purchases_user_account_date on public.purchases (user_id, account_id, date);
create index week_plans_user on public.week_plans (user_id);
create index allowance_changes_user on public.allowance_changes (user_id);
create index week_closures_user on public.week_closures (user_id);
create index savings_releases_user on public.savings_releases (user_id);

-- ---------------------------------------------------------------------------
-- Access: signed-out visitors get nothing; signed-in users get only the
-- operations listed, and row-level security limits them to their own rows.
-- Grants are written out instead of relying on project defaults.
-- ---------------------------------------------------------------------------
revoke all on public.accounts, public.purchases, public.week_plans, public.allowance_changes,
  public.week_closures, public.savings_releases from anon, authenticated;

grant select, insert, update, delete on public.accounts, public.purchases, public.week_plans,
  public.allowance_changes to authenticated;
-- Read-only until the checked closure and release functions exist.
grant select on public.week_closures, public.savings_releases to authenticated;

alter table public.accounts enable row level security;
alter table public.purchases enable row level security;
alter table public.week_plans enable row level security;
alter table public.allowance_changes enable row level security;
alter table public.week_closures enable row level security;
alter table public.savings_releases enable row level security;

-- (select auth.uid()) is evaluated once per query rather than once per row.
create policy "own accounts" on public.accounts for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own purchases" on public.purchases for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own week plans" on public.week_plans for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own allowance changes" on public.allowance_changes for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "read own closures" on public.week_closures for select to authenticated
  using (user_id = (select auth.uid()));
create policy "read own releases" on public.savings_releases for select to authenticated
  using (user_id = (select auth.uid()));
