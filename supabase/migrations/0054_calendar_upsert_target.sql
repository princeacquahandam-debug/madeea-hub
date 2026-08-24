-- The upsert target has to be an index Postgres can infer.
--
-- 0052 created the uniqueness as a PARTIAL index (WHERE gcal_event_id is not
-- null). Postgres will only use a partial index for ON CONFLICT if the
-- statement repeats the same WHERE clause, and PostgREST has no way to send
-- one. So every upsert in calendar-sync failed to match a constraint, and the
-- loop counted failures without reporting them: 16 events scanned from Google,
-- 0 written, and a calendar that stayed empty while the sync said it had run.
--
-- Unpartitioned is correct anyway. Postgres treats NULLs as distinct in a
-- unique index, so meetings created by hand (no Google id) are unaffected and
-- can still be created freely.
drop index if exists public.meetings_owner_gcal_uidx;

create unique index if not exists meetings_owner_gcal_uidx
  on public.meetings (owner_id, gcal_event_id);
