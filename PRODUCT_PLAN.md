# SpendSense product and engineering plan

## Product contract

Help students with irregular income, aid, or family support record everyday spending and see how much remains in their weekly plan. First users: the builder and two or three students in guided tests. Phone entry has priority; desktop must work well. The builder is learning fundamentals and has roughly one hour per day. Services must remain free during beta.

Confirmed choices:
- Support a chosen planning end date or an expected next-payment date. Expected income is not spendable until recorded as received.
- Calculate a suggested allowance; let the student adjust it with explicit consequences.
- Protect positive weekly leftovers as a savings allocation until explicitly released. This never moves real bank funds.
- Support USD and BSD accounts separately, with no currency conversion or combined total.
- Start with manual entry; add CSV import after the core works. Bank syncing is deferred.
- Visual identity: a precise financial instrument with useful interactive spending visuals.

## Smallest coherent beta

1. Setup: currency/account, opening balance with effective date, protected amount, dated upcoming commitments, planning mode and end date.
2. Week view: selected currency, allowance, spent, remaining, protected savings, upcoming commitments and last recorded activity. Explain that amounts depend on entered data.
3. Quick entry: amount first, account/currency, date, optional merchant/category. Fast defaults, editable history, clear save status, retry without duplicate creation.
4. Allowance adjustment: show both the recommendation and chosen amount; explain effect on future weeks. Never release savings automatically.
5. Weekly closure: reserve positive unused allowance exactly once. Surface overspending and ask for a revised plan when necessary.
6. Hosted beta gate: account isolation, persistence across refresh, tested authentication, export/delete of the user's own data, and a clear manual-data limitation.

One account per currency per user is the proposed beta limit. No credit cards, debt modeling, recurring-rule engine, shared budgets, bank syncing, currency transfers, payment processing, AI recommendations or investment advice. Upcoming commitments are individual dated entries; recurring generation and CSV are subsequent increments. These limits should be visible rather than silently misrepresenting unsupported accounts.

## Stack recommendation and alternatives

| Layer | Proposed choice | Reason and tradeoff |
|---|---|---|
| App | React + TypeScript + Vite | Fits an interactive app with little search-engine rendering need; keeps the initial execution model small. Routing/data fetching must be chosen explicitly if the app grows. |
| Styling | CSS Modules + shared CSS custom properties | Direct control of layout, type and color without a large UI template. More styling is authored intentionally. Tailwind is a reasonable alternative if preferred; it does not determine design quality. |
| Data/auth | Supabase Postgres + Auth | Relational constraints and SQL learning, managed sign-in and data API. Requires deliberate row-level security and migration discipline. |
| Hosting | Cloudflare Pages static build | Free static hosting for this architecture. No server functions are needed initially; provider limits and terms must be checked again before release. |
| Verification | Vitest; React Testing Library where useful; Playwright for critical browser paths | Domain tests first, then a few behavior and browser checks. Introduce each tool only when its tests are needed and approved. |
| History | Git, private GitHub repository | Reviewable changes and remote backup, with user approval for commits/pushes. |

Alternative: Next.js + TypeScript + Supabase. Prefer it if server-side workflows, SEO-heavy pages, or a server-mediated architecture become central. It adds server/client rendering decisions that are unnecessary for the first tracker. This proposal does not imply Next.js is poor engineering. Re-evaluate when requirements change, not because one framework is fashionable.

Use one application, not microservices. Keep the domain calculation independent of React and the database. Suggested areas: src/domain for pure money/date/allowance rules; src/features for onboarding, week and transactions; src/data for Supabase access; src/ui for reusable visual components; supabase/migrations for SQL; tests for browser and integration checks. Add folders as needed, not empty abstractions. Keep transaction data in a single source of truth; do not add Redux or an ORM without an actual need.

## Money and time: proposed rules for review

Store money as integer cents with an explicit currency. Parse decimal input carefully; reject unsupported precision, invalid numbers and out-of-range values. Treat a calendar purchase date separately from its UTC creation timestamp. Use the user's chosen timezone for week boundaries. Proposed default: Monday through Sunday. Prorate the first and last partial weeks by days.

Definitions, separately for each currency:
- C: current cash derived from the opening balance and subsequent recorded cash movements.
- P: protected savings allocation, part of C rather than additional cash.
- B: unpaid commitments due on or before the planning end date, reserved from C.
- F = C - P - B: unallocated cash available across the remaining plan.
- D: calendar days from the current date through the end date, inclusive.
- d: days remaining in this week and before the end date, inclusive.
- Suggested allowance for those d days = floor(max(0,F) * d / D), in cents. Preserve rounding remainder in unallocated cash.

If F is negative, display the actual shortfall as well as zero suggested spending; never hide the deficit. If the end date has passed, request a new plan instead of dividing by zero. Expected payment dates provide a horizon, not guaranteed money; if payment is late, show that the plan has expired.

At setup or the start of a week, save a snapshot of the chosen allowance and the recommendation. Remaining weekly allowance = chosen allowance minus recorded discretionary spending in that period. Do not automatically recalculate the allowance after every purchase: doing so could obscure overspending. New income, balance corrections, or changed commitments should prompt an explicit plan update with before/after amounts. Actual remaining cash remains visible independently.

Allowance override: label the input as the total allowance for this week's active period. Let S be discretionary spending already recorded in that period and A the proposed total allowance. The proposed remaining amount is A - S. Compare max(0, A - S), not A, against max(0, F), because C already reflects recorded spending. Reject a proposed remaining amount above available unallocated cash unless the student explicitly releases savings or changes commitments first. A lower allowance is allowed even below S; show the resulting overspend rather than clamping it away. A midweek recalculation recommends additional remaining spending using the day-prorated formula above; display a proposed total allowance of S plus that remaining recommendation. Saving a change replaces the allowance snapshot with an auditable before/after record and leaves transactions unchanged. Show the future-plan impact before saving. Never describe an override as guaranteed safe. Use 'Available in your plan' or 'Weekly remaining' with an inspectable calculation.

Commitment payments: a payment reduces C and marks the corresponding B entry paid atomically. It must not also count as discretionary spending. Example: paying a reserved $100 bill decreases both C and B by $100, leaving F unchanged. Transfers within the allocation (protect/release) change P, not C. Received income changes C exactly once.

At weekly closure: reserve max(0, unused allowance), capped by actual unallocated cash after commitments, into P. Do not subtract this amount from C or record it as a purchase. Negative remainder creates no savings; reduced cash affects the next recommendation. Persist an identifiable closure with a uniqueness constraint per user/currency/week, using a database transaction so two tabs or retries cannot apply it twice. Process elapsed weeks chronologically; do not invent allocations for weeks the user never planned.

For the initial beta, prevent edits to closed periods unless an explicit correction/reopen flow is implemented and tested. Do not silently leave historical savings inconsistent after a backdated edit. Show users how to correct the current balance with a labeled adjustment that does not masquerade as spending.

Worked example: with USD 1,000 current cash, USD 200 protected, USD 200 unpaid commitments and exactly 28 days left starting Monday, F is USD 600 and the seven-day suggestion is USD 150. Choosing USD 150 then spending USD 40 leaves USD 110 for the week and USD 960 cash. If nothing else changes, closing the week protects USD 110: P becomes USD 310, C remains USD 960, B remains USD 200, and USD 450 is available across the remaining 21 days. Re-running closure changes nothing. A separate BSD account is unaffected throughout.

## Data integrity and access

Proposed tables: profiles (timezone); accounts (owner, currency, opening balance/date); transactions (owner, account, amount, type, local date, idempotency key); commitments (owner, account, due date, amount, linked payment); plans (mode, horizon); weekly_allocations (period, recommended and chosen amount); savings_events (protect/release, source closure). Refine before creating migrations. Derived balances should not also be editable cached numbers without a consistency strategy.

Use database constraints for valid currencies/amounts, owner-consistent relationships and unique operations. Every exposed table needs appropriate grants and row-level ownership policies for select/insert/update/delete. Test forged owner IDs and cross-user account references. A client-side filter is not authorization. Never put a service-role key or secret key in browser code or VITE_ variables. Publishable configuration is different from a secret.

Use database transactions/RPC for multi-row payments, closure and release operations. Prefer security-invoker functions; explicitly review any security-definer function and its search path/authorization. Browser calculations can provide a preview, but the database must validate persisted operations. Test parity where a rule exists in both environments. Do not build a generic accounting platform.

Proposed beta authentication: Supabase Google sign-in if testers can use it, after approving the choice and configuring allowed redirects. Otherwise assess email auth with a suitable free SMTP service. Default Supabase email is restricted and must not be assumed to work for testers. Never bypass ownership checks to get a demo working. Use fictional data until the access tests pass, avoid financial values in logs/analytics, and keep raw bank CSV uploads out of the initial system.

## Visual direction: a weekly spending instrument

Proposed palette: warm off-white canvas, graphite text, cobalt for available allocation, muted teal for protected savings, amber/red plus text for warnings. Use tabular numerals for exact values, restrained borders and a typographic hierarchy. Prefer a system font initially; a font purchase is unnecessary.

The main screen starts with the currency selector and week dates, then a large remaining amount and the primary Add spending action within easy phone reach. Below, a seven-day spending trace compares actual cumulative spending with a clearly labeled even-paced reference. Tapping a day opens its transactions; provide keyboard controls and an equivalent text list. This is actual activity, not a predicted financial outcome.

A tap on 'How calculated' opens the money breakdown: current cash, protected funds, commitments and the selected allowance. A separate adjustment preview shows how a changed allowance affects future allocation before saving. Protected savings has its own explicit release action. Desktop uses the extra width for activity and calculation details; do not simply stretch the phone layout.

Show a representative phone and desktop screen before styling every page. Use realistic fictional numbers and clearly label demo mode. Keep subtle transitions around 150–200 ms, respect reduced motion, and never animate a number in a way that hides save failure. No confetti for spending, decorative chart clutter, or color-only status. Aim for clear labels, visible focus, approximately 44px touch targets and readable contrast. Test narrow screens, long merchant names, zero balance, deficit, save failure and empty history.

The distinguishing experience is immediate, understandable feedback: entering a purchase changes the remaining amount and the week's activity, and the user can trace the arithmetic. Visual polish must preserve fast entry and accessibility.

## Verification and release gate

Domain cases: worked example above; zero/negative free cash; partial week; end date reached; leap/day/timezone boundaries; cents and rounding; bills not double-subtracted; refunds; currency isolation; allowance overrides; explicit savings release; rollover twice; no rollover from an unplanned week.

Integration: two accounts with different owners cannot read or mutate each other's records; multi-row payment failures roll back; duplicate saves and simultaneous closure are harmless; refresh restores the same numbers; edits/deletes update totals; expired sessions and failed saves preserve usable input.

Browser: onboarding to first purchase; edit/delete; switch USD/BSD; formula explanation; keyboard entry; mobile layout; authentication redirects. Run build, typecheck, lint and relevant tests. A second AI review can find issues but is not an independent human senior review. Provide a reviewer with schema, calculation tests, decisions and known limitations.

Before real beta use: verify authentication and ownership, explain manual-entry freshness, support data export/deletion, obtain deployment approval, and document what is not supported. If any gate fails, use a guided fictional-data prototype and extend the schedule.

## CSV follow-up

Select a real export format with sensitive fields removed; implement column mapping, date/decimal parsing, currency/account selection, preview and explicit confirmation. Detect repeated imports using file/batch identity and reviewed transaction matches; do not blindly deduplicate identical date/merchant/amount because two real purchases may match. Imports before the opening-balance effective date must not reduce that balance again. Retain import provenance and a reversible batch operation. Discard raw files after local parsing unless there is an approved need to retain them.

## Source checks and free-tier limits

Official documentation checked October 30, 2026; recheck at installation/deployment. Limits can change.
- Vite installation compatibility: https://vite.dev/guide/
- Supabase Free: 500 MB database per free project; inactive projects may pause after a week. https://supabase.com/pricing and https://supabase.com/kb/faqs/platform/free-project-pausing
- Cloudflare Pages static requests are free and unlimited; functions have separate limits, and build limits still apply. https://developers.cloudflare.com/pages/functions/pricing/ and https://developers.cloudflare.com/pages/platform/limits/
- Vercel Hobby is personal/noncommercial, so do not assume it is a long-term free hosting plan for this SaaS. https://vercel.com/docs/plans/hobby
- Supabase default email limitations: https://supabase.com/docs/guides/auth/auth-smtp
- Data access and secrets: https://supabase.com/docs/guides/database/secure-data and https://supabase.com/docs/guides/database/postgres/row-level-security
- Google authentication: https://supabase.com/docs/guides/auth/social-sign-in/auth-google

The free beta is feasible at this small scale within provider limits; this is not a promise of permanent free production operation. Do not enable paid upgrades without approval.

## Additional acceptance examples and review triggers

- Midweek adjustment: S = USD 40, current F = USD 560, new total allowance A = USD 180 implies USD 140 remaining. Compare USD 140 with F, not USD 180. Recommending USD 120 of additional remaining spending means proposing A = USD 160, not resetting A to USD 120. A reduction to USD 30 shows USD 10 overspent.
- Rollover with a shortfall: reserve min(max(0, A - S), max(0, C - P - B)). Never create a negative savings event when free cash is negative. This clarifies the cap in the earlier rule.
- Refund policy, still proposed: a refund linked to a purchase in the open week reduces that week's net discretionary spending and restores cash, capped by the unrefunded original purchase amount. Reject duplicate refund operations. A refund of a closed-period purchase restores cash as a labeled prior-period refund and prompts a current-plan review; it must not rewrite closed weekly savings silently. Confirm this rule before implementing refunds.
- Architect review must address where each invariant is enforced: pure calculation, UI validation, database constraint or transactional operation. An explanation alone does not enforce an invariant.
- Redesign triggers: bank synchronization, cross-currency transfers, multiple accounts per currency, offline multi-device writes or paid subscriptions require a new architecture decision before implementation. None belongs to the current milestone.
- Operational recovery: before beta, demonstrate export of fictional data and restoration into a clean test context. Explain which schema and records are preserved. Do not assume a free provider offers automatic backups sufficient for recovery. Use minimal error diagnostics with operation identifiers, never account balances or transaction descriptions in logs.

See QUALITY_REVIEW.md for the compact decision/review method and measurable targets. These are proposed acceptance criteria, not measurements already obtained.
