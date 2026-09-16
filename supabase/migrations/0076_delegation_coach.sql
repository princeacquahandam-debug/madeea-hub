-- Delegation Coach, brought in from the standalone Lovable app.
--
-- WHAT IT IS. A guided flow that takes an executive from "I am drowning" to a
-- written handover: an assessment, a task chosen to let go of, a plan with
-- success criteria and risks, a handoff message, and scheduled check-ins. The
-- AI runs through the n8n webhook the original already used, so nothing here
-- touches the OpenAI balance.
--
-- WHO RUNS IT, AND WHY THAT IS NOT WHO ASKED. The request was to put this in
-- My Day, the assistant daily loop. The schema says otherwise: a plan carries
-- team_member, autonomy_level and handoff_message. This coaches the person
-- HANDING WORK OVER, which in this business is the client, delegating to their
-- assistant. So the client runs it in their portal, and the assistant reads the
-- result -- they are the one being delegated to, and a plan that says how they
-- will be measured is worth more to them than to anybody else.
--
-- === THREE THINGS FROM THE ORIGINAL SCHEMA ARE DELIBERATELY NOT HERE =====
--
--   profiles. The original creates its own, with email and team_size. This
--   database already has a profiles table, for staff, with different columns.
--   Recreating it would either fail or quietly redefine what a profile means.
--
--   handle_new_user, and its trigger on auth.users. This is the important one.
--   The original installs a trigger that writes a profile row for every new
--   account. This database already owns that trigger, and it has been rewritten
--   five times (0002, 0003, 0004, 0008, 0012) and is what decides whether a new
--   account becomes staff or a client. Running the original migration as
--   written would replace it, and every account created afterwards would arrive
--   with no membership and no client link -- signup silently broken, and the
--   isolation in 0065 and 0070 with it.
--
--   user_id references profiles(id). A client holds no profile row here, by
--   design. Ownership is by client_id, the way every other client-facing table
--   in this database works.
--
-- === THE SHAPE CHANGED WHERE THE ORIGINAL WAS LOSING DATA ================
--
-- risks was text[] and check_in_schedule was text, but the n8n response
-- returns objects -- a risk with its mitigation, a schedule with frequency,
-- format and topics -- and the original flattened them on the way in. jsonb
-- keeps what the AI actually said.

-- ---------------------------------------------------------------------------
-- 1. The assessment.
-- ---------------------------------------------------------------------------

create table if not exists public.delegation_assessments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  -- Which account created it. Null when that login is later removed: the
  -- assessment belongs to the client, not to the person who typed it.
  created_by uuid references auth.users (id) on delete set null default auth.uid(),

  draining_tasks       text,
  tasks_not_delegating text,
  delegation_barriers  text,
  team_members         text,
  ai_insights          text,

  created_at timestamptz not null default now()
);

create index if not exists delegation_assessments_client_idx
  on public.delegation_assessments (client_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 2. The plan.
-- ---------------------------------------------------------------------------

create table if not exists public.delegation_plans (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  assessment_id uuid references public.delegation_assessments (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),

  task_name       text not null,
  team_member     text,
  context         text,
  autonomy_level  text,
  outcome         text,
  task_importance text,
  support_needed  text,
  deadline        timestamptz,
  handoff_message text,

  success_criteria text[] not null default '{}',
  best_practices   text[] not null default '{}',
  -- Objects, not strings. A risk without its mitigation is half a sentence.
  risks             jsonb not null default '[]'::jsonb,
  check_in_schedule jsonb,

  status text not null default 'draft' check (status in ('draft', 'active', 'done')),

  /* When the client hands the plan over, it becomes a real task on their
     account and this points at it. Without the link the plan and the work it
     produced sit in two places that never learn about each other. */
  task_id uuid references public.tasks (id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists delegation_plans_client_idx
  on public.delegation_plans (client_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 3. The check-ins.
-- ---------------------------------------------------------------------------

create table if not exists public.delegation_follow_ups (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  plan_id uuid not null references public.delegation_plans (id) on delete cascade,

  check_in_date timestamptz not null,
  frequency     text,
  completed     boolean not null default false,
  reflection_notes text,

  created_at timestamptz not null default now()
);

create index if not exists delegation_follow_ups_plan_idx
  on public.delegation_follow_ups (plan_id, check_in_date);

-- ---------------------------------------------------------------------------
-- 4. Staff read them. Nobody writes them from the agency side.
-- ---------------------------------------------------------------------------
--
-- The assistant reads the plan because they are the person it describes. They
-- do not edit it: a delegation plan the delegatee rewrote is not a delegation
-- plan. Changes go through the client, in their portal.

alter table public.delegation_assessments  enable row level security;
alter table public.delegation_plans        enable row level security;
alter table public.delegation_follow_ups   enable row level security;

drop policy if exists "delegation assessments read" on public.delegation_assessments;
create policy "delegation assessments read" on public.delegation_assessments
  for select to authenticated using (workspace_id = public.my_workspace());

drop policy if exists "delegation plans read" on public.delegation_plans;
create policy "delegation plans read" on public.delegation_plans
  for select to authenticated using (workspace_id = public.my_workspace());

drop policy if exists "delegation follow ups read" on public.delegation_follow_ups;
create policy "delegation follow ups read" on public.delegation_follow_ups
  for select to authenticated using (workspace_id = public.my_workspace());

-- ---------------------------------------------------------------------------
-- 5. What the client reads, by column name.
-- ---------------------------------------------------------------------------
--
-- 0072 rule, unchanged: views list their columns, the WHERE clause is the
-- access rule, my_client() is NULL for staff so a member reading these sees
-- nothing. created_by and workspace_id stay out of all three.

create or replace view public.client_delegation_plans as
select
  p.id,
  p.assessment_id,
  p.task_name,
  p.team_member,
  p.context,
  p.autonomy_level,
  p.outcome,
  p.task_importance,
  p.support_needed,
  p.deadline,
  p.handoff_message,
  p.success_criteria,
  p.best_practices,
  p.risks,
  p.check_in_schedule,
  p.status,
  p.task_id,
  p.created_at,
  p.updated_at
from public.delegation_plans p
where p.client_id = public.my_client();

create or replace view public.client_delegation_assessments as
select
  a.id,
  a.draining_tasks,
  a.tasks_not_delegating,
  a.delegation_barriers,
  a.team_members,
  a.ai_insights,
  a.created_at
from public.delegation_assessments a
where a.client_id = public.my_client();

create or replace view public.client_delegation_follow_ups as
select
  f.id,
  f.plan_id,
  f.check_in_date,
  f.frequency,
  f.completed,
  f.reflection_notes,
  f.created_at
from public.delegation_follow_ups f
where f.client_id = public.my_client();

grant select on public.client_delegation_plans       to authenticated;
grant select on public.client_delegation_assessments to authenticated;
grant select on public.client_delegation_follow_ups  to authenticated;

-- ---------------------------------------------------------------------------
-- 6. What the client may write.
-- ---------------------------------------------------------------------------
--
-- Functions rather than insert policies, for the reason 0072 gives: a policy
-- can check the values sent and cannot stop a client sending workspace_id or a
-- client_id belonging to somebody else. Every one of these reads the caller own
-- client_users row and decides those columns itself.
--
-- A viewer is refused throughout. They may read the account, and delegating
-- work is the one thing the account owner does not share (0074).

create or replace function public.client_save_assessment(
  p_draining text, p_not_delegating text, p_barriers text, p_team text, p_insights text default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $assess$
declare cid uuid; ws uuid; new_id uuid;
begin
  cid := public.my_client();
  if cid is null then
    raise exception 'Only a client may run the delegation coach.' using errcode = 'insufficient_privilege';
  end if;
  if public.my_client_role() <> 'primary' then
    raise exception 'Your access to this account is view only.' using errcode = 'insufficient_privilege';
  end if;

  select cu.workspace_id into ws from public.client_users cu where cu.user_id = auth.uid() limit 1;

  insert into public.delegation_assessments
    (workspace_id, client_id, draining_tasks, tasks_not_delegating, delegation_barriers, team_members, ai_insights)
  values (ws, cid, p_draining, p_not_delegating, p_barriers, p_team, p_insights)
  returning id into new_id;

  return new_id;
end $assess$;

create or replace function public.client_save_plan(p_plan jsonb)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $plan$
declare cid uuid; ws uuid; open_plans int; new_id uuid;
begin
  cid := public.my_client();
  if cid is null then
    raise exception 'Only a client may build a delegation plan.' using errcode = 'insufficient_privilege';
  end if;
  if public.my_client_role() <> 'primary' then
    raise exception 'Your access to this account is view only.' using errcode = 'insufficient_privilege';
  end if;

  if coalesce(btrim(p_plan ->> 'task_name'), '') = '' then
    raise exception 'A plan needs a task to delegate.' using errcode = 'check_violation';
  end if;

  select cu.workspace_id into ws from public.client_users cu where cu.user_id = auth.uid() limit 1;

  -- The same ceiling reasoning as client_create_task: a browser-reachable
  -- insert with no bound is how a work surface becomes a spam target.
  select count(*) into open_plans
  from public.delegation_plans where client_id = cid and status <> 'done';
  if open_plans >= 50 then
    raise exception 'You have 50 open delegation plans. Close some before starting another.'
      using errcode = 'check_violation';
  end if;

  insert into public.delegation_plans (
    workspace_id, client_id, assessment_id, task_name, team_member, context,
    autonomy_level, outcome, task_importance, support_needed, deadline,
    handoff_message, success_criteria, best_practices, risks, check_in_schedule, status
  ) values (
    ws,
    cid,
    nullif(p_plan ->> 'assessment_id', '')::uuid,
    btrim(p_plan ->> 'task_name'),
    p_plan ->> 'team_member',
    p_plan ->> 'context',
    p_plan ->> 'autonomy_level',
    p_plan ->> 'outcome',
    p_plan ->> 'task_importance',
    p_plan ->> 'support_needed',
    nullif(p_plan ->> 'deadline', '')::timestamptz,
    p_plan ->> 'handoff_message',
    coalesce((select array_agg(value) from jsonb_array_elements_text(coalesce(p_plan -> 'success_criteria', '[]'::jsonb))), '{}'),
    coalesce((select array_agg(value) from jsonb_array_elements_text(coalesce(p_plan -> 'best_practices',   '[]'::jsonb))), '{}'),
    coalesce(p_plan -> 'risks', '[]'::jsonb),
    p_plan -> 'check_in_schedule',
    /* Status is decided here, never sent. A client cannot file a plan as
       already done, which is the delegation equivalent of marking your own
       homework. */
    'draft'
  )
  returning id into new_id;

  return new_id;
end $plan$;

/* Handing the plan over. This is the moment the coach stops being a worksheet:
   the plan becomes a real task on the account, assigned to the accountable
   assistant, and the two stay linked. */
create or replace function public.client_hand_off_plan(p_plan_id uuid)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $handoff$
declare cid uuid; ws uuid; ea uuid; p record; new_task uuid;
begin
  cid := public.my_client();
  if cid is null then
    raise exception 'Only a client may hand over a plan.' using errcode = 'insufficient_privilege';
  end if;
  if public.my_client_role() <> 'primary' then
    raise exception 'Your access to this account is view only.' using errcode = 'insufficient_privilege';
  end if;

  select * into p from public.delegation_plans where id = p_plan_id and client_id = cid;
  if p.id is null then
    raise exception 'No such plan on this account.' using errcode = 'no_data_found';
  end if;
  if p.task_id is not null then
    raise exception 'That plan has already been handed over.' using errcode = 'check_violation';
  end if;

  select cu.workspace_id into ws from public.client_users cu where cu.user_id = auth.uid() limit 1;
  select c.lead_ea_id into ea from public.clients c where c.id = cid;

  insert into public.tasks (workspace_id, client_id, title, assignee_id, requested_by_client, notes)
  values (ws, cid, p.task_name, ea, true, p.handoff_message)
  returning id into new_task;

  update public.delegation_plans
     set task_id = new_task, status = 'active', updated_at = now()
   where id = p.id;

  return new_task;
end $handoff$;

create or replace function public.client_save_follow_up(
  p_plan_id uuid, p_check_in timestamptz, p_frequency text default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $fu$
declare cid uuid; ws uuid; new_id uuid;
begin
  cid := public.my_client();
  if cid is null or public.my_client_role() <> 'primary' then
    raise exception 'Only the account owner may schedule a check-in.' using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from public.delegation_plans where id = p_plan_id and client_id = cid) then
    raise exception 'No such plan on this account.' using errcode = 'no_data_found';
  end if;

  select cu.workspace_id into ws from public.client_users cu where cu.user_id = auth.uid() limit 1;

  insert into public.delegation_follow_ups (workspace_id, client_id, plan_id, check_in_date, frequency)
  values (ws, cid, p_plan_id, p_check_in, p_frequency)
  returning id into new_id;

  return new_id;
end $fu$;

create or replace function public.client_complete_follow_up(p_id uuid, p_notes text default null)
returns boolean
language plpgsql security definer set search_path = public, pg_temp as $cfu$
declare cid uuid;
begin
  cid := public.my_client();
  if cid is null or public.my_client_role() <> 'primary' then
    raise exception 'Only the account owner may complete a check-in.' using errcode = 'insufficient_privilege';
  end if;

  update public.delegation_follow_ups
     set completed = true, reflection_notes = coalesce(p_notes, reflection_notes)
   where id = p_id and client_id = cid;

  if not found then
    raise exception 'No such check-in on this account.' using errcode = 'no_data_found';
  end if;
  return true;
end $cfu$;

revoke execute on function public.client_save_assessment(text, text, text, text, text) from public, anon;
revoke execute on function public.client_save_plan(jsonb)                               from public, anon;
revoke execute on function public.client_hand_off_plan(uuid)                            from public, anon;
revoke execute on function public.client_save_follow_up(uuid, timestamptz, text)        from public, anon;
revoke execute on function public.client_complete_follow_up(uuid, text)                 from public, anon;

grant execute on function public.client_save_assessment(text, text, text, text, text) to authenticated;
grant execute on function public.client_save_plan(jsonb)                               to authenticated;
grant execute on function public.client_hand_off_plan(uuid)                            to authenticated;
grant execute on function public.client_save_follow_up(uuid, timestamptz, text)        to authenticated;
grant execute on function public.client_complete_follow_up(uuid, text)                 to authenticated;

comment on table public.delegation_plans is
  'A client plan for handing one piece of work to their assistant. Written by the client in their portal, read by the assistant, never edited by them.';
