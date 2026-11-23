-- 0110_task_approvals_page.sql. Approvals: who may approve, and sending work back.
--
-- Run in the Supabase SQL editor (madeea-hub project). Safe to run twice.
--
-- 0030 added "Needs approval": such a task cannot be marked Done until someone
-- approves it, and the approver and time are recorded. Two gaps, found while
-- building the Approvals page (QA write test WA-14, 23 Nov 2026):
--
--   1. WHO MAY APPROVE was decided only by the screen. The button showed for
--      admins and owners, but the database accepted an approval from anyone,
--      including the person who did the work. Now the database checks too:
--      owners and admins only. Automated callers (no signed-in person) are
--      unchanged.
--   2. THERE WAS NO WAY TO SAY "NOT YET". An approver could only approve.
--      return_task_for_changes() sends the task back to In progress with a
--      reason, records who and when on the task, and logs it in the task's
--      history. The reason also lands as a comment, so the person doing the
--      work reads it where they read everything else about the task.

alter table public.tasks
  add column if not exists returned_at timestamptz,
  add column if not exists returned_by uuid references auth.users (id) on delete set null,
  add column if not exists return_reason text;

comment on column public.tasks.return_reason is
  'Why an approver sent this back (0110). Cleared when the task is approved.';

-- ── 1. Who may approve ────────────────────────────────────────────────────
create or replace function enforce_task_approval() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $ap$
begin
  -- 0110: setting approved_at is an approver's act. Owners and admins only.
  if new.approved_at is not null and old.approved_at is null
     and auth.uid() is not null
     and public.role_rank(public.my_role()) < public.role_rank('admin') then
    raise exception 'Only an owner or admin can approve work.' using errcode = 'insufficient_privilege';
  end if;

  if new.status = 'done' and new.requires_approval and new.approved_at is null then
    raise exception 'This task needs approval before it can be completed.'
      using errcode = 'check_violation';
  end if;
  -- Stamped here, from the session, so it cannot be set to somebody who never looked.
  if new.approved_at is not null and old.approved_at is null then
    new.approved_by := auth.uid();
    -- Approved: the earlier "sent back" no longer applies.
    new.returned_at := null;
    new.returned_by := null;
    new.return_reason := null;
  end if;
  if new.status <> 'done' and old.status = 'done' then
    new.approved_at := null;
    new.approved_by := null;
  end if;
  return new;
end $ap$;

-- ── 2. Sending work back ──────────────────────────────────────────────────
create or replace function public.return_task_for_changes(p_task_id uuid, p_reason text)
returns boolean
language plpgsql security definer set search_path = public, pg_temp as $ret$
declare
  t public.tasks%rowtype;
  reason text := btrim(coalesce(p_reason, ''));
begin
  if public.role_rank(public.my_role()) < public.role_rank('admin') then
    raise exception 'Only an owner or admin can send work back.' using errcode = 'insufficient_privilege';
  end if;
  if reason = '' then
    raise exception 'Say what needs changing.' using errcode = 'check_violation';
  end if;
  if length(reason) > 1000 then
    raise exception 'Keep it under 1,000 characters.' using errcode = 'check_violation';
  end if;

  select * into t from public.tasks where id = p_task_id and workspace_id = my_workspace();
  if not found then
    raise exception 'That task is not in your workspace.' using errcode = 'no_data_found';
  end if;

  update public.tasks
     set status = 'in_progress',
         approved_at = null,
         approved_by = null,
         returned_at = now(),
         returned_by = auth.uid(),
         return_reason = reason
   where id = p_task_id;

  insert into public.task_activity (task_id, workspace_id, actor_id, verb, to_value)
  values (p_task_id, t.workspace_id, auth.uid(), 'returned', left(reason, 120));

  -- Internal, never shown to the client (client_visible defaults to false, 0108).
  insert into public.task_comments (task_id, workspace_id, author_id, body)
  values (p_task_id, t.workspace_id, auth.uid(), 'Sent back for changes: ' || reason);

  return true;
end $ret$;

revoke execute on function public.return_task_for_changes(uuid, text) from public, anon;
grant execute on function public.return_task_for_changes(uuid, text) to authenticated;
