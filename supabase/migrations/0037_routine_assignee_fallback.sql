-- 0037_routine_assignee_fallback.sql
-- A routine with nobody's name on it produced work nobody could see.
--
-- Run once in the Supabase SQL editor, after 0036.
--
-- THE BUG. Assignee is optional on a routine, and the materialiser copied it
-- straight through. So a routine created without one produced a task with
-- assignee_id null. The EOD draft is built from tasks WHERE assignee_id = you,
-- so that task belonged to nobody and appeared in nobody's report. The routine
-- looked like it worked: the task was on the board, correctly dated, and then
-- silently absent from the one place it was supposed to end up.
--
-- Found by following the chain end to end rather than by reading it. The task
-- was created, and the EOD stayed empty.
--
-- THE FIX. Fall back to whoever set the routine up. That is the honest default:
-- if you did not say who this is for, it is yours. The app now also preselects
-- you in the form, so a null only reaches here for routines created before
-- today or through the API.

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
    -- The change. Unassigned work is the creator's work, not nobody's.
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

-- Tasks already created by an unassigned routine are orphaned in the same way.
-- Hand them to whoever set the routine up, so they turn up in the next EOD
-- rather than staying invisible forever.
update tasks t
   set assignee_id = r.created_by
  from routines r
 where t.routine_id = r.id
   and t.assignee_id is null
   and r.created_by is not null;
