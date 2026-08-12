-- 0008_automations.sql. Make automations executable: identify each by a stable
-- key, (re)seed the core set per workspace, and keep run history (automation_runs
-- already exists from 0001).

alter table automations add column automation_key text;  -- priority_alignment | meeting_prep | inbox_triage | custom

create or replace function seed_core_automations(wsid uuid, uid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from automations where workspace_id = wsid and automation_key is not null) then
    return;
  end if;
  insert into automations (owner_id, workspace_id, name, description, status, automation_key, total_runs) values
    (uid, wsid, 'Executive Priority Alignment Automation™',
     'Every morning at 7:30 AM, analyses your calendar, emails and task list to generate a prioritised daily briefing. Flags conflicts, urgent items and schedule optimisations.',
     'active', 'priority_alignment', 0),
    (uid, wsid, 'Meeting Preparation Automation™',
     'Compiles attendee profiles, agenda drafts and prep notes for upcoming meetings.',
     'active', 'meeting_prep', 0),
    (uid, wsid, 'Executive Summary Inbox Automation™',
     'Triages the inbox. Auto-archives newsletters and surfaces only what needs executive attention.',
     'paused', 'inbox_triage', 0);
end $$;

-- backfill existing workspaces (owner = a workspace admin)
do $bf$
declare w record; admin_id uuid;
begin
  for w in select id from workspaces loop
    select user_id into admin_id from memberships where workspace_id = w.id and role = 'admin' limit 1;
    if admin_id is not null then perform seed_core_automations(w.id, admin_id); end if;
  end loop;
end $bf$;

-- new workspaces get the core automations at signup (still no demo clients/tasks)
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $nu$
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
    perform seed_core_automations(wsid, new.id);
  end if;
  return new;
end $nu$;
