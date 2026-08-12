-- 0027_time_tracking.sql. Clock in / clock out, timesheets, attendance.
--
-- Run once in the Supabase SQL editor, after 0026_task_notes_and_attachments.sql.
--
-- From the 10 Aug audit §4.5. Every MadeEA EA currently runs TopTracker, a
-- third-party tool. Bringing it in-house was called out as required before
-- launch (Reichelle 34:05, Rowena 34:34), and it earns its place twice over:
--
--   R-4.5.2  attendance is only recorded if the EA opens the app and starts the
--            tracker. No tracker, no attendance, and that affects pay. This is
--            the deliberate adoption-forcing mechanism (Rowena 34:25, Rio 34:31)
--            and the reason the whole app gets opened every morning.
--   R-4.5.5  HR gets total hours per cutoff for the payslip, in the same place
--            as everything else (Reichelle 1:10:00).
--   R-4.5.6  time attaches to a task, so it can be attributed per task/client.
--
-- ── NOT built here, deliberately ──────────────────────────────────────────
-- OQ-5 is open: does "capture the essence of TopTracker" include SCREENSHOTS
-- and activity-level monitoring? That is a surveillance decision with real
-- privacy consequences for the EAs, and the audit says do not guess, it is
-- Reichelle's and Prince's to make. So this schema records time, not behaviour.
-- There is no screenshot column, no keystroke/activity score, and adding one
-- later is a migration rather than a redesign.
--
-- Attendance is deliberately DERIVED from these rows rather than stored: a
-- separate attendance table can disagree with the timesheet, and then someone
-- has to decide which one payroll believes.

create table if not exists time_entries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  workspace_id uuid references workspaces (id) on delete cascade default my_workspace(),

  -- What the time went on. Both nullable: an EA clocks in before knowing what
  -- the day holds, and general admin belongs to no client.
  task_id uuid references tasks (id) on delete set null,
  client_id uuid references clients (id) on delete set null,

  started_at timestamptz not null default now(),
  -- Null means running. There is exactly one of these per person; see the
  -- partial unique index below.
  ended_at timestamptz,
  note text,

  -- The working day this belongs to, so a timesheet groups without every reader
  -- re-deriving it (and disagreeing about timezones while they do). Set by the
  -- client from ITS local date: an EA in Manila finishing at 01:00 is still
  -- working the previous day, and current_date on a UTC server is not.
  work_date date not null default current_date,

  created_at timestamptz not null default now()
);

alter table time_entries enable row level security;

-- One running timer per person, enforced by the database. Two open entries
-- would double-count the day, and a client-side guard cannot survive two tabs.
create unique index if not exists time_entries_one_open_per_owner
  on time_entries (owner_id) where ended_at is null;

create index if not exists time_entries_owner_day_idx
  on time_entries (workspace_id, owner_id, work_date desc);
create index if not exists time_entries_task_idx
  on time_entries (task_id) where task_id is not null;

-- ── who sees what ─────────────────────────────────────────────────────────
-- Your own hours are yours. Admins see everyone's, because that is the payroll
-- and invoicing view R-4.5.5 asks for, and unlike an inbox, hours worked for
-- the agency are not private from the agency.
--
-- Note this is NOT the workspace-wide read that eod_reports uses. Compliance is
-- a team metric by design; one EA's minute-by-minute timesheet is not.
drop policy if exists "time read" on time_entries;
create policy "time read" on time_entries for select
  using (workspace_id = my_workspace() and (is_admin() or owner_id = auth.uid()));

drop policy if exists "time write" on time_entries;
create policy "time write" on time_entries for all
  using (workspace_id = my_workspace() and owner_id = auth.uid())
  with check (workspace_id = my_workspace() and owner_id = auth.uid());

-- Admins may correct a timesheet, a missed clock-out is the single most common
-- support request any time tracker gets, but corrections are separate from
-- writes so an EA can never edit someone else's hours.
drop policy if exists "time admin correct" on time_entries;
create policy "time admin correct" on time_entries for update
  using (workspace_id = my_workspace() and is_admin())
  with check (workspace_id = my_workspace() and is_admin());

comment on table time_entries is
  'Clock in/out records. Attendance for a day is derived from the presence of rows, not stored separately. No screenshots or activity monitoring: see OQ-5.';
