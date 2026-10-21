-- 0090: Reich's testing feedback (20 Oct 2026) and the 21 Oct requests.
--
--   1. Deleted tasks go to Recently deleted for 30 days instead of vanishing.
--   2. A past EOD report can't be deleted by anyone; today's can.
--   3. Madeline's memory is per account, not shared by the whole workspace.
--   4. Personal knowledge-base folders stop leaking to the workspace.
--   5. Rowena and Prince can see every member's EOD reports (Team view).
--
-- Safe to run more than once.

-- ---------------------------------------------------------------------------
-- 1. Recently deleted tasks
-- ---------------------------------------------------------------------------
/* A trigger, not a "deleted" flag on tasks. Twenty-odd screens, the client
   portal, Madeline and the EOD draft all read tasks directly; a flag would have
   to be remembered in every one of them, and the one that forgets counts
   deleted work as active (Reich's Dashboard said 7 when her board showed 5).
   So a deleted task really leaves `tasks`, and a copy of it, checklist,
   notes, progress, links and comments included, waits here. */
create table if not exists task_trash (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  task_id uuid not null,
  title text not null,
  task jsonb not null,
  comments jsonb not null default '[]'::jsonb,
  deleted_by uuid references auth.users (id) on delete set null,
  deleted_at timestamptz not null default now()
);
create index if not exists task_trash_ws_idx on task_trash (workspace_id, deleted_at desc);
alter table task_trash enable row level security;

-- Everyone who could see the task can see it was deleted, and restore it.
drop policy if exists "trash read" on task_trash;
create policy "trash read" on task_trash for select to authenticated
  using (workspace_id = my_workspace());

/* Emptying it for good: whoever deleted it, or a manager and up. Writes only
   ever come from the trigger and the functions below. */
drop policy if exists "trash purge" on task_trash;
create policy "trash purge" on task_trash for delete to authenticated
  using (workspace_id = my_workspace() and (deleted_by = auth.uid() or role_rank(my_role()) >= 20));

grant select, delete on task_trash to authenticated;

create or replace function keep_deleted_task()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.workspace_id is null then return old; end if;
  insert into task_trash (workspace_id, task_id, title, task, comments, deleted_by)
  values (
    old.workspace_id, old.id, old.title, to_jsonb(old),
    coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at)
              from task_comments c where c.task_id = old.id), '[]'::jsonb),
    auth.uid()
  );
  return old;
end $$;

drop trigger if exists tasks_keep_deleted on tasks;
create trigger tasks_keep_deleted before delete on tasks
  for each row execute function keep_deleted_task();

/* force_owner_id (0020) stamps the caller as owner on every insert. A restored
   task must keep the person who created it, so the restore function sets a
   transaction-local flag this trigger respects. Clients can't set it: PostgREST
   only exposes functions in public, and set_config isn't one. */
create or replace function force_owner_id()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $owner$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null and coalesce(current_setting('madeea.restoring', true), '') <> 'on' then
      new.owner_id := auth.uid();
    end if;
  else
    new.owner_id := old.owner_id;  -- attribution is immutable
  end if;
  return new;
end $owner$;

create or replace function restore_task(p_trash_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t task_trash%rowtype;
  rec tasks%rowtype;
begin
  select * into t from task_trash where id = p_trash_id;
  if not found or t.workspace_id is distinct from my_workspace() then
    raise exception 'That task is no longer in Recently deleted.';
  end if;
  if exists (select 1 from tasks where id = t.task_id) then
    delete from task_trash where id = p_trash_id;
    return t.task_id;
  end if;

  rec := jsonb_populate_record(null::tasks, t.task);
  -- Links that no longer exist are dropped rather than failing the restore.
  if rec.client_id is not null and not exists (select 1 from clients where id = rec.client_id) then rec.client_id := null; end if;
  if rec.depends_on is not null and not exists (select 1 from tasks where id = rec.depends_on) then rec.depends_on := null; end if;
  if rec.assignee_id is not null and not exists (select 1 from auth.users where id = rec.assignee_id) then rec.assignee_id := null; end if;

  perform set_config('madeea.restoring', 'on', true);
  insert into tasks select rec.*;
  perform set_config('madeea.restoring', '', true);

  insert into task_comments
  select (jsonb_populate_record(null::task_comments, c)).*
  from jsonb_array_elements(t.comments) c
  on conflict do nothing;

  delete from task_trash where id = p_trash_id;
  return t.task_id;
end $$;

revoke all on function restore_task(uuid) from public;
grant execute on function restore_task(uuid) to authenticated;

-- Kept 30 days. Cleared whenever someone opens Recently deleted.
create or replace function purge_old_task_trash()
returns integer language sql security definer set search_path = public, pg_temp as $$
  with gone as (
    delete from task_trash
    where workspace_id = my_workspace() and deleted_at < now() - interval '30 days'
    returning 1
  )
  select count(*)::int from gone;
$$;
revoke all on function purge_old_task_trash() from public;
grant execute on function purge_old_task_trash() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. EOD reports: past reports can't be deleted
-- ---------------------------------------------------------------------------
/* "eod write" (0021) was FOR ALL, so it covered delete too: your own report, or
   anyone's if you're an admin, any date. Split so writing is unchanged and
   deleting is only ever today's report. One day of slack covers the team being
   ahead of UTC (Manila is UTC+8, so at 7am there it's still yesterday in UTC);
   the Hub itself only offers delete on today's report. */
drop policy if exists "eod write" on eod_reports;
drop policy if exists "eod insert" on eod_reports;
drop policy if exists "eod update" on eod_reports;
drop policy if exists "eod delete" on eod_reports;

create policy "eod insert" on eod_reports for insert to authenticated
  with check (workspace_id = my_workspace() and (is_admin() or owner_id = auth.uid()));

create policy "eod update" on eod_reports for update to authenticated
  using (workspace_id = my_workspace() and (is_admin() or owner_id = auth.uid()))
  with check (workspace_id = my_workspace() and (is_admin() or owner_id = auth.uid()));

create policy "eod delete" on eod_reports for delete to authenticated
  using (
    workspace_id = my_workspace()
    and (is_admin() or owner_id = auth.uid())
    and report_date >= current_date - 1
  );

-- ---------------------------------------------------------------------------
-- 3. Madeline's memory: each account has its own
-- ---------------------------------------------------------------------------
/* 0017 shared every memory with the whole workspace, so anyone could read,
   edit or delete what Madeline remembered for someone else. Now each person's
   memories are theirs alone. Meeting notes that save memories run as the
   person who asked, so those land in that person's memory. */
drop policy if exists "ws shared" on memories;
drop policy if exists "own memories" on memories;
create policy "own memories" on memories for all to authenticated
  using (workspace_id = my_workspace() and owner_id = auth.uid())
  with check (workspace_id = my_workspace() and owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 4. Knowledge base: personal folders are personal
-- ---------------------------------------------------------------------------
/* 0067 added "folders read" (team folders, or your own) but never dropped
   0031's "folders shared", and permissive policies add up, so every member
   could still read and change everyone's personal folders. */
drop policy if exists "folders shared" on folders;
drop policy if exists "folders write" on folders;
drop policy if exists "folders update" on folders;
drop policy if exists "folders delete" on folders;
create policy "folders write" on folders for insert to authenticated
  with check (workspace_id = my_workspace() and (scope = 'team' or created_by = auth.uid()));
create policy "folders update" on folders for update to authenticated
  using (workspace_id = my_workspace() and (scope = 'team' or created_by = auth.uid()))
  with check (workspace_id = my_workspace() and (scope = 'team' or created_by = auth.uid()));
create policy "folders delete" on folders for delete to authenticated
  using (workspace_id = my_workspace() and (created_by = auth.uid() or (scope = 'team' and is_admin())));

-- ---------------------------------------------------------------------------
-- 5. Rowena and Prince see every member's EOD reports
-- ---------------------------------------------------------------------------
/* Every member can already read the workspace's reports; the Team view (all
   members, coverage, blockers) shows from Manager up. This makes sure both of
   them are at least Manager. It only ever raises a role, never lowers one, and
   leaves an owner or admin as they are. */
do $$
begin
  update memberships m
     set role = 'manager'
    from profiles p
   where p.id = m.user_id
     and (p.full_name ilike 'rowena%' or p.full_name ilike 'prince%')
     and role_rank(m.role::text) < role_rank('manager');
exception when others then
  raise notice 'Role check for Rowena and Prince skipped: %', sqlerrm;
end $$;
