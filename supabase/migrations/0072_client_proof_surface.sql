-- What a client may see of the work, and the one thing they may write.
--
-- ═══ WHY VIEWS AND NOT POLICIES ══════════════════════════════════════════
--
-- The obvious way to show a client their tasks is a policy:
-- `select ... using (client_id = my_client())`. It is wrong, and the reason is
-- worth stating because the instinct is strong.
--
-- RLS is ROW level. A row it admits, it admits entirely. `tasks` carries
-- `notes` (the assistant's own working notes), `blocker_note`, `source_quote`
-- (a verbatim line from a meeting recording), `attachments` and `progress`.
-- A policy that lets a client read "their" task rows hands them all of it.
-- Column privileges cannot save this either: staff and clients are both the
-- `authenticated` role, so a revoke aimed at one hits the other.
--
-- So the client-facing shape is a VIEW listing the columns by name. Adding a
-- column to `tasks` later does not silently publish it, which is the property
-- that matters: the next person to add `internal_rate` to tasks should not
-- have to know this file exists.
--
-- The views run as their owner rather than the invoker, so they read the
-- underlying tables without those tables needing a client policy at all. The
-- WHERE clause is the access rule, and my_client() returns NULL for staff, so
-- a member selecting from these sees nothing rather than everything.
--
-- ═══ WHAT IS DELIBERATELY NOT HERE ═══════════════════════════════════════
--
-- EOD reports. eod_reports has no client_id — one report per person per day,
-- covering every client that assistant touched (0012: "one EOD report covers
-- all of them"). Exposing it to one client publishes the others' work. Giving
-- a client a real EOD view means tagging EOD lines with a client at entry
-- time, which is a schema change and a form change, not a policy.
--
-- Screenshots. time_screenshots stores a photograph of a monitor. Even a
-- capture taken during a time entry tagged to this client shows whatever else
-- was on screen. 0065 already says it: "No row-level rule reaches a picture."

-- ---------------------------------------------------------------------------
-- 0. The column client_tasks projects, added before the view that reads it.
-- ---------------------------------------------------------------------------
alter table public.tasks add column if not exists requested_by_client boolean not null default false;

comment on column public.tasks.requested_by_client is
  'True when the row came from client_create_task. The agency side shows it so an assistant can tell a request from their own planning.';

-- ---------------------------------------------------------------------------
-- 1. Their tasks, by column name.
-- ---------------------------------------------------------------------------
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
  t.completed_at,
  t.created_at,
  t.updated_at,
  t.requested_by_client
from public.tasks t
where t.client_id = public.my_client();

comment on view public.client_tasks is
  'The client-safe projection of tasks. Columns are listed explicitly so a new column on tasks is not published by accident. Empty for staff, because my_client() is NULL for them.';

-- ---------------------------------------------------------------------------
-- 2. Hours on their account. An aggregate, so no note travels with it.
-- ---------------------------------------------------------------------------
drop view if exists public.client_hours;
create view public.client_hours as
select
  te.work_date,
  /* A running entry counts up to now. The alternative — showing nothing until
     the assistant clocks out — reads as "nobody worked today" for most of the
     working day, which is worse than approximately right. */
  (sum(extract(epoch from (coalesce(te.ended_at, now()) - te.started_at))) / 60)::bigint as minutes,
  count(*)::int as sessions
from public.time_entries te
where te.client_id = public.my_client()
group by te.work_date;

comment on view public.client_hours is
  'Minutes worked on this client per working day. Aggregated deliberately: time_entries.note is the assistant''s own and does not belong in a client view.';

-- ---------------------------------------------------------------------------
-- 3. Who their assistant is.
-- ---------------------------------------------------------------------------
drop view if exists public.client_overview;
create view public.client_overview as
select
  c.id            as client_id,
  c.name          as client_name,
  c.company       as company,
  p.full_name     as assistant_name,
  p.initials      as assistant_initials
from public.clients c
left join public.profiles p on p.id = c.lead_ea_id
where c.id = public.my_client();

comment on view public.client_overview is
  'The client''s own header: their name, and the assistant accountable for them. profiles is otherwise unreadable to a client, which is why the join happens in here.';

grant select on public.client_tasks    to authenticated;
grant select on public.client_hours    to authenticated;
grant select on public.client_overview to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The one thing a client may write: a task for their own assistant.
-- ---------------------------------------------------------------------------
--
-- Through a function rather than an INSERT policy, for the same reason as the
-- views. An insert policy can check the values of the columns a client sends;
-- it cannot stop them sending `requires_approval`, `assignee_id`, a `status`
-- of 'done', or an `attachments` blob. Here the client supplies a title and a
-- due label, and every other column is decided server-side.

create or replace function public.client_create_task(p_title text, p_due_label text default null)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $newtask$
declare cid uuid; ws uuid; ea uuid; open_count int; new_id uuid;
begin
  cid := public.my_client();
  if cid is null then
    raise exception 'Only a client may request a task.' using errcode = 'insufficient_privilege';
  end if;

  if coalesce(btrim(p_title), '') = '' then
    raise exception 'A task needs a title.' using errcode = 'check_violation';
  end if;

  select cu.workspace_id into ws from public.client_users cu where cu.user_id = auth.uid() limit 1;
  select c.lead_ea_id  into ea from public.clients c where c.id = cid;

  /* A ceiling, not a rate limit. Somebody with fifty open requests has a
     conversation to have with their assistant rather than a fifty-first
     request to file, and an unbounded insert reachable from a browser is how
     a work queue becomes a spam target. */
  select count(*) into open_count
  from public.tasks
  where client_id = cid and requested_by_client and status <> 'done';

  if open_count >= 50 then
    raise exception 'You have 50 open requests already. Talk to your assistant before adding more.'
      using errcode = 'check_violation';
  end if;

  /* owner_id is left to its default of auth.uid(), which force_owner_id would
     set to the same value anyway: the client really is who wrote this. status
     and priority take their table defaults ('todo', 'normal') — a client
     cannot file something as already done, or as urgent. */
  insert into public.tasks (workspace_id, client_id, title, due_label, assignee_id, requested_by_client)
  values (ws, cid, btrim(p_title), nullif(btrim(coalesce(p_due_label, '')), ''), ea, true)
  returning id into new_id;

  return new_id;
end $newtask$;

revoke execute on function public.client_create_task(text, text) from public, anon;
grant execute on function public.client_create_task(text, text) to authenticated;

comment on function public.client_create_task is
  'The only write a client holds. Title and due label are theirs; workspace, client, assignee, status and priority are decided here.';
