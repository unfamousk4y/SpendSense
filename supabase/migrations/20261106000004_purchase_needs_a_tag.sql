-- Migration 15: every new or edited purchase says whether it was a need or a want.
--
-- An untagged want would quietly make the weekly wants guide too generous, so
-- the form asks and the database enforces it. "not valid" skips rows that already
-- exist until they are next edited, so older untagged purchases stay readable.
alter table public.purchases
  add constraint purchase_needs_a_tag check (need_or_want is not null) not valid;
