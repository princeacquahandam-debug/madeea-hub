-- Two things the 14 Sep call asked for that nothing in the app answered.
--
-- 1. A CLIENT CAN SEE THAT A TASK IS STUCK AND NOT WHY.
--
-- 0072 withholds tasks.blocker_note from client_tasks, and that was right: it
-- is the assistant writing to themselves and to their EOD, in the words they
-- would use to a colleague. Publishing it would be publishing a private note.
--
-- But the most common blocker on an assistant task is the client themselves --
-- a login not shared, an approval not given, an invoice not signed off. Telling
-- them "1 blocked" and nothing else is how a task sits for a week over
-- something the client could have cleared in a minute.
--
-- So a SECOND field, written deliberately for the client, rather than
-- republishing the first. Two fields on one concept is a cost, and it is the
-- cheaper of the two mistakes available: the alternative is an assistant having
-- to write every blocker note as if a client will read it, which makes the
-- private one useless and the EOD worse.
--
-- 2. NOBODY IS TOLD WHEN AN EA SIMPLY NEVER CLOCKS IN.
--
-- 0063 gates the clock on reporting, and 0064 tells the client when their
-- assistant starts. Both are about somebody doing something. An assistant who
-- does nothing at all fires neither, and Bryan named the route on the call:
-- "papasok yan kay Rachel kung sakali, kasi si Rachel nag-monitor" (17:30).
-- It did not exist.
--
-- A missing clock-in is the absence of a row, so nothing can emit it at the
-- moment it happens. What follows is the readable fact -- who has not started
-- today -- plus the alert route that lets it be sent somewhere, seeded off and
-- pointing nowhere exactly as 0036 and 0064 seed theirs.

-- ---------------------------------------------------------------------------
-- 1. The blocker a client may read.
-- ---------------------------------------------------------------------------

alter table public.tasks
  add column if not exists client_visible_blocker text;

comment on column public.tasks.client_visible_blocker is
  'What the client needs to do or know for this to move, written for them. Distinct from blocker_note, which is the assistant own working note and is never published.';

-- client_tasks lists its columns by name, so the new one has to be added here
-- on purpose. That is the property 0072 was built for.
drop view if exists public.client_tasks;
create view public.client_tasks as
select
  t.id,
  t.client_id,
  t.title,
  t.status,
  t.priority,
  t.due_label,
  t.due_at,
  t.blocked,
  t.client_visible_blocker,
  t.completed_at,
  t.created_at,
  t.updated_at,
  t.requested_by_client
from public.tasks t
where t.client_id = public.my_client();

comment on view public.client_tasks is
  'The client-safe projection of tasks. Columns are listed explicitly so a new column on tasks is not published by accident. blocker_note is absent and client_visible_blocker is the field written for this audience.';

grant select on public.client_tasks to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Who has not started today.
-- ---------------------------------------------------------------------------
--
-- MANAGERS AND ABOVE ONLY. The WHERE clause is the access rule, the same shape
-- 0072 uses: my_workspace() is NULL for a client so they see nothing, and the
-- rank test means an employee cannot read a register of who was late.
--
-- ON current_date. time_entries.work_date is set by the assistant own machine
-- from ITS local date, deliberately (0027), because an EA in Manila finishing
-- at 01:00 is still working the previous day. Comparing it to the server
-- current_date is therefore approximate near midnight UTC. last_worked is
-- published alongside so the reader can see the shape rather than trusting a
-- boolean: somebody who last worked three days ago is a different conversation
-- from somebody whose clock-in has not synced yet.

create or replace view public.staff_clock_status as
select
  m.user_id,
  coalesce(p.full_name, 'Unknown') as name,
  m.role::text                     as role,
  (select max(te.work_date) from public.time_entries te where te.owner_id = m.user_id) as last_worked,
  exists (
    select 1 from public.time_entries te
    where te.owner_id = m.user_id and te.work_date = current_date
  ) as clocked_in_today,
  exists (
    select 1 from public.eod_reports er
    where er.owner_id = m.user_id and er.report_date = current_date
  ) as filed_eod_today
from public.memberships m
left join public.profiles p on p.id = m.user_id
where m.workspace_id = public.my_workspace()
  and public.role_rank(m.role::text) <= public.role_rank('employee')
  and public.role_rank(public.my_role()) >= public.role_rank('manager');

comment on view public.staff_clock_status is
  'Every assistant in the workspace and whether they have started today. Managers and above only. last_worked is published beside the boolean because a clock-in that has not synced and a person who has not worked in days look identical otherwise.';

grant select on public.staff_clock_status to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Somewhere for it to go.
-- ---------------------------------------------------------------------------
--
-- Internal, not client. 0036 wrote the audience column and warned that telling
-- a client we were late at the moment it happens is the least useful time to
-- hear it. "Your assistant has not started" is that, twice over: it is about
-- the agency managing its own people, and the client learning it first is how
-- a recoverable morning becomes an account review.
--
-- Off and pointing nowhere until an admin chooses a destination in Settings.

insert into alert_routes (workspace_id, event, channel, audience, is_active)
select w.id, 'ea_not_clocked_in', 'none', 'internal', false from workspaces w
where not exists (
  select 1 from alert_routes r where r.workspace_id = w.id and r.event = 'ea_not_clocked_in'
);
