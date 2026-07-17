-- 0015_delegation.sql — task assignment across multiple EAs.
--
-- The user/team foundation already existed (profiles 0001, workspaces+memberships
-- 0003, shared-workspace RLS 0012, invite-member function). What was missing is the
-- one thing that makes delegation possible: a way to say who a task is FOR.
--
-- owner_id already tells us who CREATED a task. That is not the same person as the
-- one who has to do it — an admin creating work for an EA is the whole point — so
-- assignee_id is a separate column rather than a reinterpretation of owner_id.
-- Reassigning must not rewrite authorship.

-- ---------- who is this task for ----------
alter table tasks add column if not exists assignee_id uuid references auth.users (id) on delete set null;
create index if not exists tasks_assignee_idx on tasks (workspace_id, assignee_id, status);

-- Nullable on purpose: every task that exists today has no assignee, and that is a
-- legitimate state ("nobody has picked this up"), not a broken row.

-- ---------- accountability: who moved work onto whose plate ----------
create table if not exists task_events (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks (id) on delete cascade,
  workspace_id uuid default my_workspace() references workspaces (id) on delete cascade,
  -- Who performed the reassignment.
  actor_id uuid default auth.uid() references auth.users (id) on delete set null,
  from_user_id uuid references auth.users (id) on delete set null,
  to_user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists task_events_task_idx on task_events (workspace_id, task_id, created_at desc);

alter table task_events enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'task_events' and policyname = 'ws shared') then
    create policy "ws shared" on task_events for all
      using (workspace_id = my_workspace())
      with check (workspace_id = my_workspace());
  end if;
end $$;

-- Logged by a TRIGGER, not by the app. Any path that changes an assignee gets
-- recorded — the task modal, the board, a bulk update, or someone running SQL by
-- hand. An audit trail the application can forget to write isn't an audit trail.
create or replace function log_task_assignment() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.assignee_id is distinct from old.assignee_id then
    insert into task_events (task_id, workspace_id, actor_id, from_user_id, to_user_id)
    values (new.id, new.workspace_id, auth.uid(), old.assignee_id, new.assignee_id);
  end if;
  return new;
end $$;

drop trigger if exists tasks_log_assignment on tasks;
create trigger tasks_log_assignment
  after update on tasks
  for each row execute function log_task_assignment();

-- ---------- clients: a named lead, without changing who can see what ----------
-- Informational only. RLS stays exactly as 0012 left it — the workspace is shared
-- and every EA still sees every client. Restricting visibility would mean rewriting
-- the policies on every table, which is a good way to lock a team out of its own
-- data; a "lead EA" label gives accountability without that risk.
alter table clients add column if not exists lead_ea_id uuid references auth.users (id) on delete set null;
