-- 0107_routine_priority_cast.sql. Routines create their tasks again.
--
-- Run in the Supabase SQL editor (madeea-hub project). Safe to run twice.
--
-- WHAT WAS BROKEN. materialize_routine_occurrence (0037) inserted the task's
-- priority as TEXT into tasks.priority, which is the `priority` enum. Postgres
-- only converts text to an enum when told to, so every call failed with
--   42804  column "priority" is of type priority but expression is of type text
-- and no routine has created a task through it since 0037. Found by the QA
-- write test in the sandbox, 23 Nov 2026 (the routine saved; its task never
-- appeared, and the runner logged a 400 on every page load).
--
-- THE FIX is the cast, plus a fallback so a template holding a priority that
-- is not one of the enum's values becomes 'normal' instead of failing the
-- whole occurrence. Everything else is exactly 0037.

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
  prio priority;
begin
  select * into r from routines where id = p_routine_id and workspace_id = my_workspace();
  if not found or not r.is_active then return null; end if;

  prio := case
    when (r.task_template ->> 'priority') in ('urgent', 'high', 'normal', 'low')
      then (r.task_template ->> 'priority')::priority
    else 'normal'::priority
  end;

  insert into tasks (
    workspace_id, title, priority, status, due_at,
    client_id, assignee_id, routine_id, occurrence_date, notes
  )
  values (
    r.workspace_id,
    coalesce(r.task_template ->> 'title', r.name),
    prio,
    'todo',
    p_occurrence::timestamptz,
    r.client_id,
    -- Unassigned work is the creator's work, not nobody's (0037).
    coalesce(r.assignee_id, r.created_by),
    r.id,
    p_occurrence,
    r.task_template ->> 'notes'
  )
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
