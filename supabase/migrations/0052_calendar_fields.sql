-- A calendar needs to know when a thing ENDS.
--
-- `meetings` was built as a list of what is coming up, so it stored a start and
-- nothing else. That is enough for "next 10 meetings" on a dashboard and not
-- enough to draw a day: without an end time every event is the same size, and
-- a 15 minute check-in occupies the same space as a 3 hour workshop. It also
-- makes "how long is this meeting" unanswerable, which the meeting-prep action
-- asks for and currently makes the user type by hand.
--
-- All nullable. The ten rows already synced have starts only, and a calendar
-- that hides events with no end time would hide the entire existing history.

alter table public.meetings
  add column if not exists ends_at         timestamptz,
  add column if not exists all_day         boolean not null default false,
  add column if not exists location        text,
  add column if not exists html_link       text,
  add column if not exists organizer_email text,
  add column if not exists description     text,
  -- Which calendar it came from. Someone with a personal and a work calendar
  -- connected needs to see which is which before acting on an event.
  add column if not exists calendar_id     text,
  add column if not exists synced_at       timestamptz;

-- Drawing a month means asking for a window, every time the month changes.
-- Without this that is a scan of every meeting in the workspace.
create index if not exists meetings_owner_starts_idx
  on public.meetings (owner_id, starts_at);

-- Re-syncing must update an event rather than duplicate it. calendar-sync
-- upserts on the Google id, which only works if the database agrees that the
-- id is unique per person. It is per OWNER, not global: two people invited to
-- the same meeting each hold their own row, and a workspace-wide constraint
-- would let the first sync block the second.
create unique index if not exists meetings_owner_gcal_uidx
  on public.meetings (owner_id, gcal_event_id)
  where gcal_event_id is not null;
