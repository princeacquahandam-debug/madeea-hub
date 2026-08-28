-- The clock asks for something in return.
--
-- Two columns, both on time_entries, both nullable, no triggers.
--
-- ── WHAT THE APP NOW REQUIRES ────────────────────────────────────────────
--
-- Clocking IN asks what the day is for, and that answer lands in `focus`.
-- Clocking OUT asks for the EOD, which already has a home: eod_reports, since
-- 0021. Nothing new is needed for the report itself — the clock-out simply
-- refuses to fire until that day's row exists, and offers the draft composer
-- so it can be written on the spot instead of on another page.
--
-- ── WHY THERE IS NO TRIGGER HERE ─────────────────────────────────────────
--
-- The obvious version of this migration refuses the insert without a focus and
-- refuses to set ended_at without a report. It was not written, on purpose.
--
-- A shift that cannot be CLOSED is worse than a shift that was opened without
-- a stated focus. An open entry keeps counting, the one-open-timer rule then
-- blocks the next morning's clock-in, and the timesheet the whole feature
-- exists to protect is the thing that ends up wrong. Every route to that state
-- is something outside the EA's control: an RLS change, a storage outage at
-- 18:00, one bad deploy. The gate lives in the app, where it can offer a way
-- through; the database keeps accepting a correctly formed row.
--
-- So these columns record what happened. They do not enforce it. Anyone adding
-- enforcement later should add it to the INSERT side only, and leave the exit
-- alone.
alter table time_entries
  add column if not exists focus text,
  add column if not exists eod_skipped_reason text;

-- What the EA said the day was for, captured at clock-in and asked once per
-- work_date rather than once per session: a second entry after lunch carries
-- the same day's focus rather than asking again.
comment on column time_entries.focus is
  'What this working day is for, stated by the EA at clock-in. Asked once per work_date.';

-- Set only when somebody clocked out WITHOUT filing that day''s EOD, which the
-- app allows but never silently: it asks why, and the answer lands here where a
-- reviewer reads it beside the shift it belongs to. Null is the normal case and
-- means the report was filed.
comment on column time_entries.eod_skipped_reason is
  'Why this shift was closed without an EOD. Null means the report was filed. Never set silently: the EA types it.';
