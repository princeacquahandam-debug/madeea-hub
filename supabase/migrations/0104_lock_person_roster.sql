-- 0104_lock_person_roster.sql. Close the two name tables to the public API.
--
-- Run once in the Supabase SQL editor (madeea-hub project). Safe to run again.
--
-- Found in the 19 Nov 2026 security pre-check for Google's CASA assessment:
-- person_roster and person_name_overrides (0061) were created without row
-- level security or any grants removed. Supabase grants every role access to
-- new tables in public, so anybody holding the public website key, signed in
-- or not, could read the team's names and the email addresses in the
-- overrides table, and could add or change rows, which would rename the next
-- person invited.
--
-- Nothing in the app or the Edge Functions reads them directly. They are read
-- only by handle_new_user (0061) and eod_canonical_person (0062), both
-- security definer, which run as the table owner and are not affected by RLS
-- or by these revokes. So: RLS on with no policies (absent means denied), and
-- the API roles' grants removed. Names are still corrected by an admin in the
-- SQL editor, as 0061 describes.

alter table public.person_roster enable row level security;
alter table public.person_name_overrides enable row level security;

revoke all on public.person_roster from anon, authenticated;
revoke all on public.person_name_overrides from anon, authenticated;

-- canonical_person_name reads both tables. It is only meant to be called by
-- the two definer functions above; do not expose it through the API either.
revoke execute on function public.canonical_person_name(text) from public, anon, authenticated;
