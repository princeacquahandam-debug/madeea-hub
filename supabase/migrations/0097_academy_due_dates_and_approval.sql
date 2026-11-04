-- 0097_academy_due_dates_and_approval.sql. Assigned training and the sign-off
-- for client work.
--
-- Run once in the Supabase SQL editor, after 0096. Safe to run more than once.
--
-- From the EOS tracker (22 Oct 2026):
--   EOS-038 MadeEA Ready: "completion and approval can be recorded". Passing the
--     course (0095) is the completion; this adds the approval: an admin signs
--     someone off for client work, and the record says who and when.
--   EOS-039 MadeEA Academy: "assigned training ... progress/completion tracking".
--     An admin gives each person a date to finish the course by; the learner
--     sees it, and the Team roster shows who is late.
--
-- One row per person per workspace. Nobody writes the table directly: the two
-- functions below are the only way in, so the rules live in one place.
--   * Only admins set due dates or approve.
--   * Nobody approves themselves (same rule as the practicals in 0095).
--   * Approval needs Made Ready first: every quiz and every practical passed.
--   * Taking an approval back is allowed, and clears who/when.

create table if not exists academy_plan (
  workspace_id uuid not null references workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  due_date date,
  assigned_by uuid references auth.users (id) on delete set null,
  assigned_at timestamptz,
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  approval_note text,
  primary key (workspace_id, user_id)
);

alter table academy_plan enable row level security;

-- Your own row, or everyone's in your workspace if you are an admin. Managers
-- see due dates and approvals through academy_ready_roster() below.
drop policy if exists "plan read" on academy_plan;
create policy "plan read" on academy_plan for select to authenticated
  using (workspace_id = my_workspace() and (user_id = auth.uid() or is_admin()));

-- No insert, update or delete policies: writes go through the functions.

-- Has this person passed every published quiz and practical in my workspace?
create or replace function academy_made_ready(p_user uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  with ws as (select my_workspace() as id),
  t as (
    select (select count(*) from academy_modules am, ws where am.workspace_id = ws.id and am.is_published)::int as modules,
           (select count(*) from academy_lessons l join academy_modules am on am.id = l.module_id, ws
             where am.workspace_id = ws.id and am.is_published and l.kind = 'practical')::int as practicals,
           (select count(distinct a.module_id) from academy_attempts a join academy_modules am on am.id = a.module_id, ws
             where a.user_id = p_user and a.passed and am.is_published and am.workspace_id = ws.id)::int as modules_passed,
           (select count(*) from academy_submissions s join academy_lessons l on l.id = s.lesson_id
              join academy_modules am on am.id = l.module_id, ws
             where s.user_id = p_user and s.status = 'passed' and am.is_published and l.kind = 'practical'
               and am.workspace_id = ws.id)::int as practicals_passed
  )
  select modules > 0 and modules_passed >= modules and practicals_passed >= practicals from t
$$;

revoke execute on function academy_made_ready(uuid) from public;

-- Set or clear the date someone should finish the course by.
create or replace function academy_set_due(p_user uuid, p_due date)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare ws uuid := my_workspace();
begin
  if not is_admin() then raise exception 'Only admins assign training.'; end if;
  if not exists (select 1 from memberships m where m.workspace_id = ws and m.user_id = p_user) then
    raise exception 'That person is not in this workspace.';
  end if;
  insert into academy_plan (workspace_id, user_id, due_date, assigned_by, assigned_at)
  values (ws, p_user, p_due, auth.uid(), now())
  on conflict (workspace_id, user_id) do update
    set due_date = excluded.due_date, assigned_by = auth.uid(), assigned_at = now();
end $$;

-- Approve someone for client work, or take the approval back.
create or replace function academy_approve(p_user uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare ws uuid := my_workspace();
begin
  if not is_admin() then raise exception 'Only admins approve people for client work.'; end if;
  if p_user = auth.uid() then raise exception 'Someone else has to approve you.'; end if;
  if not exists (select 1 from memberships m where m.workspace_id = ws and m.user_id = p_user) then
    raise exception 'That person is not in this workspace.';
  end if;
  if p_approve and not academy_made_ready(p_user) then
    raise exception 'They have to be Made Ready first: every quiz and every practical passed.';
  end if;
  insert into academy_plan (workspace_id, user_id, approved_by, approved_at, approval_note)
  values (ws, p_user,
          case when p_approve then auth.uid() end,
          case when p_approve then now() end,
          case when p_approve then nullif(btrim(p_note), '') end)
  on conflict (workspace_id, user_id) do update
    set approved_by = excluded.approved_by, approved_at = excluded.approved_at, approval_note = excluded.approval_note;
end $$;

revoke execute on function academy_set_due(uuid, date) from public;
revoke execute on function academy_approve(uuid, boolean, text) from public;
grant execute on function academy_set_due(uuid, date) to authenticated;
grant execute on function academy_approve(uuid, boolean, text) to authenticated;

-- The Lead EA picker's roster (0096), now with the due date and approval.
-- Its columns change, so it has to be dropped first.
drop function if exists academy_ready_roster();
create function academy_ready_roster()
returns table (user_id uuid, modules_passed integer, modules_total integer,
               practicals_passed integer, practicals_total integer, made_ready boolean,
               due_date date, approved_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  with ws as (select my_workspace() as id),
  totals as (
    select (select count(*) from academy_modules am, ws where am.workspace_id = ws.id and am.is_published)::int as modules,
           (select count(*) from academy_lessons l join academy_modules am on am.id = l.module_id, ws
             where am.workspace_id = ws.id and am.is_published and l.kind = 'practical')::int as practicals
  ),
  people as (
    select m.user_id,
           (select count(distinct a.module_id) from academy_attempts a join academy_modules am on am.id = a.module_id
             where a.user_id = m.user_id and a.passed and am.is_published and am.workspace_id = ws.id)::int as modules_passed,
           (select count(*) from academy_submissions s join academy_lessons l on l.id = s.lesson_id
              join academy_modules am on am.id = l.module_id
             where s.user_id = m.user_id and s.status = 'passed' and am.is_published and l.kind = 'practical'
               and am.workspace_id = ws.id)::int as practicals_passed
      from memberships m, ws
     where m.workspace_id = ws.id
       -- Managers and up assign clients; nobody else gets rows.
       and my_role() in ('owner', 'admin', 'manager')
  )
  select p.user_id, p.modules_passed, t.modules, p.practicals_passed, t.practicals,
         t.modules > 0 and p.modules_passed >= t.modules and p.practicals_passed >= t.practicals,
         ap.due_date, ap.approved_at
    from people p cross join totals t
    left join academy_plan ap on ap.user_id = p.user_id and ap.workspace_id = (select id from ws)
$$;

revoke execute on function academy_ready_roster() from public;
grant execute on function academy_ready_roster() to authenticated;
