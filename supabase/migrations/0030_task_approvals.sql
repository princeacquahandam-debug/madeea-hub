-- 0030_task_approvals.sql. Sign-off before client-facing work is called done.
--
-- Run once in the Supabase SQL editor, after 0029.
--
-- ⚠️ RUN THIS FILE IN TWO STEPS. Postgres will not let a new enum value be USED
-- in the same transaction that adds it, and the SQL editor runs a whole script
-- as one. Run PART 1 on its own, then PART 2. If you paste the lot and see
-- "unsafe use of new value of enum type", that is exactly this and nothing is
-- broken. Just run part 2 separately.
--
-- Ported from PROJECT_PLAN §5.3. Some assistant output goes straight to a
-- client: an email to their customer, a published post, an invoice. A task
-- marked as needing approval cannot be closed by the person who did it, it
-- lands in Review and waits for an admin.
--
-- This is the "trust dial" that lets an EA be given more rope over time without
-- the agency losing the ability to catch something before the client sees it.

-- ============================ PART 1 ============================
alter type task_status add value if not exists 'review';

-- ============================ PART 2 ============================
alter table tasks add column if not exists requires_approval boolean not null default false;
alter table tasks add column if not exists approved_by uuid references auth.users (id) on delete set null;
alter table tasks add column if not exists approved_at timestamptz;

comment on column tasks.requires_approval is
  'Client-facing output. Cannot reach done without an approver. Enforced by enforce_task_approval().';

create index if not exists tasks_review_idx on tasks (workspace_id, status) where status = 'review';

-- The rule lives in the database, not the button. A UI check is a suggestion:
-- the board, a bulk update and a stray SQL statement all bypass it, and the one
-- thing this feature must never do is let unapproved work be marked done.
create or replace function enforce_task_approval() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $ap$
begin
  if new.status = 'done' and new.requires_approval and new.approved_at is null then
    raise exception 'This task needs approval before it can be completed.'
      using errcode = 'check_violation';
  end if;

  -- Approving stamps who and when, so "approved by" cannot be set by hand to
  -- somebody who never looked at it.
  if new.status = 'done' and new.requires_approval and old.approved_at is null and new.approved_at is not null then
    new.approved_by := coalesce(new.approved_by, auth.uid());
  end if;

  -- Reopening clears the approval. Otherwise a task could be approved, sent
  -- back, quietly changed, and closed again on the strength of the old sign-off.
  if new.status <> 'done' and old.status = 'done' then
    new.approved_at := null;
    new.approved_by := null;
  end if;

  return new;
end $ap$;

drop trigger if exists enforce_task_approval_trigger on tasks;
create trigger enforce_task_approval_trigger
  before update on tasks
  for each row execute function enforce_task_approval();

-- Approval is an event worth reading back later, so it joins the 0029 feed.
create or replace function log_task_approval() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $la$
begin
  if new.approved_at is not null and old.approved_at is null then
    insert into task_activity (task_id, workspace_id, actor_id, verb, to_value)
    values (new.id, new.workspace_id, new.approved_by, 'approved', null);
  end if;
  return new;
end $la$;

drop trigger if exists log_task_approval_trigger on tasks;
create trigger log_task_approval_trigger
  after update on tasks
  for each row execute function log_task_approval();
