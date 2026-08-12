-- 0029_task_comments_and_activity.sql. Conversation on the work, and a log of it.
--
-- Run once in the Supabase SQL editor, after 0028_sop_recordings.sql.
--
-- Ported from PROJECT_PLAN §4.3 / §5.2 / §5.4.
--
-- The insight worth keeping from that document: the conversation belongs ON the
-- task, not in a separate messenger. A general chat loses to Slack, which the
-- client already has open. A thread pinned to a specific piece of work does not,
-- because Slack cannot do it, and the 10 Aug audit says a feature only earns
-- its place if it beats the tool the client already pays for (§5.6).
--
-- It also answers the question left open in docs/PERMISSIONS.md: "Can a client
-- comment, or only read? A comment is a request, and a request needs a route
-- into the Task Manager or it becomes a second inbox." This is that route.
--
-- Activity is written by TRIGGERS, following the precedent 0015 set for
-- reassignment: "an audit trail the application can forget to write isn't an
-- audit trail." Any path that moves a task, the board, the modal, a bulk
-- update, someone running SQL by hand. Gets logged.
--
-- task_events (0015) is left exactly as it is. It is the reassignment-specific
-- log with its own trigger, and rewriting it into this table would mean
-- dropping a working trigger and migrating history for a cosmetic tidy. The UI
-- merges both into one feed instead.

-- ---------- comments ----------
create table if not exists task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks (id) on delete cascade,
  workspace_id uuid default my_workspace() references workspaces (id) on delete cascade,
  author_id uuid default auth.uid() references auth.users (id) on delete set null,
  body text not null,
  -- Mentioned people, for notifying later. Stored now so the column does not
  -- need adding once notifications exist.
  mentions uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  edited_at timestamptz
);

create index if not exists task_comments_task_idx on task_comments (workspace_id, task_id, created_at);

alter table task_comments enable row level security;

-- Everyone in the workspace reads the thread: a conversation only half the room
-- can see is worse than no conversation.
drop policy if exists "task comments read" on task_comments;
create policy "task comments read" on task_comments for select to authenticated
  using (workspace_id = my_workspace());

-- You write as yourself, and you may edit or delete only your own words.
drop policy if exists "task comments write own" on task_comments;
create policy "task comments write own" on task_comments for insert to authenticated
  with check (workspace_id = my_workspace() and author_id = auth.uid());

drop policy if exists "task comments edit own" on task_comments;
create policy "task comments edit own" on task_comments for update to authenticated
  using (workspace_id = my_workspace() and author_id = auth.uid())
  with check (workspace_id = my_workspace() and author_id = auth.uid());

drop policy if exists "task comments delete own" on task_comments;
create policy "task comments delete own" on task_comments for delete to authenticated
  using (workspace_id = my_workspace() and (author_id = auth.uid() or is_admin()));

-- ---------- activity ----------
create table if not exists task_activity (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks (id) on delete cascade,
  workspace_id uuid default my_workspace() references workspaces (id) on delete cascade,
  actor_id uuid default auth.uid() references auth.users (id) on delete set null,
  -- created | status | priority | due | blocked | unblocked | commented
  verb text not null,
  from_value text,
  to_value text,
  created_at timestamptz not null default now()
);

create index if not exists task_activity_task_idx on task_activity (workspace_id, task_id, created_at desc);

alter table task_activity enable row level security;

-- Append-only, and enforced rather than documented: there is a read policy and
-- nothing else. With RLS on, absent means denied, so nobody. Including an
-- admin, including the app. Can quietly rewrite what happened.
drop policy if exists "task activity read" on task_activity;
create policy "task activity read" on task_activity for select to authenticated
  using (workspace_id = my_workspace());

-- ---------- the triggers that write it ----------
create or replace function log_task_activity() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $act$
begin
  if TG_OP = 'INSERT' then
    insert into task_activity (task_id, workspace_id, verb, to_value)
    values (new.id, new.workspace_id, 'created', new.status);
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into task_activity (task_id, workspace_id, verb, from_value, to_value)
    values (new.id, new.workspace_id, 'status', old.status, new.status);
  end if;

  if new.priority is distinct from old.priority then
    insert into task_activity (task_id, workspace_id, verb, from_value, to_value)
    values (new.id, new.workspace_id, 'priority', old.priority, new.priority);
  end if;

  if new.due_at is distinct from old.due_at then
    insert into task_activity (task_id, workspace_id, verb, from_value, to_value)
    values (new.id, new.workspace_id, 'due', old.due_at::text, new.due_at::text);
  end if;

  -- The blocker note is the interesting half, not the boolean: "why" is what
  -- someone reading this back next week actually needs.
  if new.blocked is distinct from old.blocked then
    insert into task_activity (task_id, workspace_id, verb, from_value, to_value)
    values (new.id, new.workspace_id, case when new.blocked then 'blocked' else 'unblocked' end,
            old.blocker_note, new.blocker_note);
  end if;

  return new;
end $act$;

drop trigger if exists log_task_activity_trigger on tasks;
create trigger log_task_activity_trigger
  after insert or update on tasks
  for each row execute function log_task_activity();

-- A comment is an event too, so the feed reads as one story rather than two.
create or replace function log_comment_activity() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $c$
begin
  insert into task_activity (task_id, workspace_id, actor_id, verb, to_value)
  values (new.task_id, new.workspace_id, new.author_id, 'commented', left(new.body, 120));
  return new;
end $c$;

drop trigger if exists log_comment_activity_trigger on task_comments;
create trigger log_comment_activity_trigger
  after insert on task_comments
  for each row execute function log_comment_activity();

comment on table task_activity is
  'Append-only log of what happened to a task. Written by triggers, never by the app. Reassignments live in task_events (0015).';
