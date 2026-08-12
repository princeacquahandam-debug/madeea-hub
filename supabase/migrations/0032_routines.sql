-- 0032_routines.sql. Work that comes back on a schedule.
--
-- Run once in the Supabase SQL editor, after 0031.
--
-- PROJECT_PLAN §5.7, and Reichelle's R-4.7.5 at 1:08:12: "update the attendance
-- sheet daily" is a real recurring job that nobody should have to remember to
-- create every morning.
--
-- ── How this differs from tasks.recurrence, which already exists ──────────
-- They are not the same thing and both are worth having:
--
--   tasks.recurrence  "when this is DONE, make another one". Completion-driven
--   routines          "every Monday, make one". Calendar-driven
--
-- The second is what you want for a report due every Monday whether or not last
-- Monday's got finished. The first is right for a chore that only makes sense
-- once the previous instance is closed.

create table if not exists routines (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid default my_workspace() references workspaces (id) on delete cascade,

  name text not null,
  -- What to create. Held as jsonb rather than columns because it is a task
  -- template, and every column added to tasks would otherwise need adding here
  -- too and kept in step forever.
  task_template jsonb not null default '{}'::jsonb,

  -- RFC 5545, e.g. FREQ=WEEKLY;BYDAY=MO,WE. Stored as the standard string even
  -- though the app currently understands a subset of it, so adopting a real
  -- rrule library later is a code change and not a data migration.
  rrule text not null,
  -- IANA name. The EA's own zone: "every Monday" means Monday where they are.
  timezone text not null default 'UTC',

  client_id uuid references clients (id) on delete set null,
  assignee_id uuid references auth.users (id) on delete set null,

  is_active boolean not null default true,
  -- Create the task this many days before it is due, so it appears in time to
  -- be worked rather than on the morning it is already late.
  lead_days integer not null default 0,

  last_run_on date,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table routines enable row level security;

create index if not exists routines_active_idx on routines (workspace_id, is_active) where is_active;

drop policy if exists "routines shared" on routines;
create policy "routines shared" on routines for all to authenticated
  using (workspace_id = my_workspace())
  with check (workspace_id = my_workspace());

-- ---------- the link back, and the thing that stops duplicates ----------
alter table tasks add column if not exists routine_id uuid references routines (id) on delete set null;
-- Which occurrence this task IS. Two people opening the app on Monday must not
-- produce two copies of Monday's task, and a job runner retrying must not
-- either. The uniqueness is the guarantee; nothing else has to coordinate.
alter table tasks add column if not exists occurrence_date date;

create unique index if not exists tasks_routine_occurrence_idx
  on tasks (routine_id, occurrence_date)
  where routine_id is not null and occurrence_date is not null;

comment on column tasks.occurrence_date is
  'Which scheduled occurrence produced this task. Unique per routine, so materialising twice is a no-op.';

-- ---------- materialisation ----------
-- Callable from anywhere: the app on load, a pg_cron job, or by hand. It is
-- idempotent by construction, so calling it more often than necessary is free.
--
-- Deliberately does NOT compute the recurrence, that lives in the client,
-- where the rule subset is implemented and testable. This takes the dates it is
-- given and creates what is missing, which is the part that must be atomic.
create or replace function materialize_routine_occurrence(
  p_routine_id uuid,
  p_occurrence date
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $mat$
declare
  r routines%rowtype;
  new_id uuid;
begin
  select * into r from routines where id = p_routine_id and workspace_id = my_workspace();
  if not found or not r.is_active then return null; end if;

  insert into tasks (
    workspace_id, title, priority, status, due_at,
    client_id, assignee_id, routine_id, occurrence_date, notes
  )
  values (
    r.workspace_id,
    coalesce(r.task_template ->> 'title', r.name),
    coalesce((r.task_template ->> 'priority')::text, 'normal'),
    'todo',
    p_occurrence::timestamptz,
    r.client_id,
    r.assignee_id,
    r.id,
    p_occurrence,
    r.task_template ->> 'notes'
  )
  -- Already materialised. Not an error: this is the whole point of the index.
  on conflict (routine_id, occurrence_date) where routine_id is not null and occurrence_date is not null
  do nothing
  returning id into new_id;

  if new_id is not null then
    update routines set last_run_on = greatest(coalesce(last_run_on, p_occurrence), p_occurrence) where id = r.id;
  end if;

  return new_id;
end $mat$;

revoke execute on function materialize_routine_occurrence(uuid, date) from public;
grant execute on function materialize_routine_occurrence(uuid, date) to authenticated;
