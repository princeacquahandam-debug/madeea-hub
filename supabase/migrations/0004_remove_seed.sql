-- 0004_remove_seed.sql
-- Clean slate: new accounts are NOT pre-populated with demo data, and the
-- existing demo records are cleared. Real data is created in-app or synced
-- from integrations.

-- Signup no longer seeds. Just create profile + workspace/membership.
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $newuser$
declare wsid uuid; invited uuid;
begin
  insert into profiles (id, full_name, initials)
  values (new.id, coalesce(split_part(new.email, '@', 1), 'Elite EA'), upper(left(coalesce(new.email, 'EA'), 2)))
  on conflict (id) do nothing;

  invited := nullif(new.raw_user_meta_data->>'workspace_id', '')::uuid;
  if invited is not null then
    insert into memberships (workspace_id, user_id, role) values (invited, new.id, 'ea') on conflict do nothing;
  else
    insert into workspaces (name) values (coalesce(split_part(new.email, '@', 1) || '''s Workspace', 'MadeEA Workspace'))
      returning id into wsid;
    insert into memberships (workspace_id, user_id, role) values (wsid, new.id, 'admin');
  end if;
  return new;
end $newuser$;

-- seed_demo_data kept as a no-op so any stale references are harmless.
create or replace function seed_demo_data(uid uuid, wsid uuid)
returns void language plpgsql as $noop$ begin return; end $noop$;

-- Clear the demo records (no real data exists yet).
truncate table
  ai_generations, assistant_messages, assistant_threads,
  automation_runs, automations, messages, meetings, tasks, clients
  restart identity cascade;
