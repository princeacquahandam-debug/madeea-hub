-- 0012_shared_workspace.sql
-- One shared team workspace. Every member sees ALL workspace data (no per-EA
-- isolation), and everyone lives in a single workspace. This:
--   A) consolidates any separate workspaces that already exist into the oldest one,
--   B) rewrites RLS so access = "member of the workspace" (drops owner_id gating),
--   C) makes new signups JOIN the single workspace instead of creating their own.
-- Roles are preserved on merge (no lock-out); demote extra admins from the Admin
-- panel if needed. Safe to run once.

-- ============ A) consolidate into the oldest workspace ============
do $merge$
declare canon uuid; t text;
begin
  select id into canon from workspaces order by created_at asc limit 1;
  if canon is null then return; end if;

  -- move all scoped data onto the canonical workspace
  foreach t in array array[
    'clients','tasks','messages','meetings','automations','ai_generations',
    'assistant_threads','sop_runs','reminders'
  ] loop
    execute format('update %I set workspace_id = %L where workspace_id is distinct from %L', t, canon, canon);
  end loop;
  -- custom SOPs move too; global templates (workspace_id is null) stay shared
  update sops set workspace_id = canon where workspace_id is not null and workspace_id <> canon;

  -- relocate memberships to the canonical workspace (preserve role), then dedupe
  insert into memberships (workspace_id, user_id, role, created_at)
    select canon, user_id, role, created_at from memberships where workspace_id <> canon
    on conflict (workspace_id, user_id) do nothing;
  delete from memberships where workspace_id <> canon;

  -- drop the now-empty extra workspaces
  delete from workspaces where id <> canon;

  -- give it a team-friendly name
  update workspaces set name = 'MadeEA Workspace' where id = canon;
end $merge$;

-- ============ B) workspace-wide RLS (any member sees everything) ============
do $rls$
declare t text;
begin
  foreach t in array array[
    'clients','tasks','messages','meetings','automations','ai_generations','assistant_threads'
  ] loop
    execute format('drop policy if exists "ws scoped" on %I', t);
    execute format('drop policy if exists "ws shared" on %I', t);
    execute format(
      'create policy "ws shared" on %I for all '
      'using (workspace_id = my_workspace()) '
      'with check (workspace_id = my_workspace())', t);
  end loop;
end $rls$;

-- child tables scope through their parent (no owner gating)
drop policy if exists "ws via automation" on automation_runs;
create policy "ws via automation" on automation_runs for all
  using (exists (select 1 from automations a where a.id = automation_id and a.workspace_id = my_workspace()))
  with check (exists (select 1 from automations a where a.id = automation_id and a.workspace_id = my_workspace()));

drop policy if exists "ws via thread" on assistant_messages;
create policy "ws via thread" on assistant_messages for all
  using (exists (select 1 from assistant_threads th where th.id = thread_id and th.workspace_id = my_workspace()))
  with check (exists (select 1 from assistant_threads th where th.id = thread_id and th.workspace_id = my_workspace()));

-- sop_runs: shared across the workspace
drop policy if exists "sop_runs scoped" on sop_runs;
create policy "sop_runs shared" on sop_runs for all
  using (workspace_id = my_workspace())
  with check (workspace_id = my_workspace());

-- reminders: shared across the workspace
drop policy if exists "reminders scoped" on reminders;
create policy "reminders shared" on reminders for all
  using (workspace_id = my_workspace())
  with check (workspace_id = my_workspace());

-- ============ C) new signups join the single workspace ============
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $newuser$
declare wsid uuid; invited uuid; existing uuid;
begin
  insert into profiles (id, full_name, initials)
  values (new.id, coalesce(split_part(new.email, '@', 1), 'Elite EA'), upper(left(coalesce(new.email, 'EA'), 2)))
  on conflict (id) do nothing;

  invited := nullif(new.raw_user_meta_data->>'workspace_id', '')::uuid;
  select id into existing from workspaces order by created_at asc limit 1;

  if invited is not null then
    insert into memberships (workspace_id, user_id, role) values (invited, new.id, 'ea') on conflict do nothing;
  elsif existing is not null then
    -- join the one shared workspace as an EA
    insert into memberships (workspace_id, user_id, role) values (existing, new.id, 'ea') on conflict do nothing;
  else
    -- very first user ever: create the workspace (admin) + seed demo data
    insert into workspaces (name) values ('MadeEA Workspace') returning id into wsid;
    insert into memberships (workspace_id, user_id, role) values (wsid, new.id, 'admin');
    perform seed_demo_data(new.id, wsid);
  end if;
  return new;
end $newuser$;
