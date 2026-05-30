-- 0003_workspaces.sql
-- Multi-tenant workspaces + roles, per the spec ("accounts, roles, per-EA inbox
-- views, workspace isolation"). Access to a row = member of its workspace AND
-- (admin OR you own it). EAs see only their assignments; admins see the workspace.

-- ---------- new tables ----------
create type member_role as enum ('admin', 'ea');

create table workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'MadeEA Workspace',
  monthly_cap_usd numeric not null default 100,   -- Phase F spend cap
  created_at timestamptz not null default now()
);

create table memberships (
  workspace_id uuid not null references workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role member_role not null default 'ea',
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

-- ---------- workspace_id on scoped entities ----------
alter table clients           add column workspace_id uuid references workspaces (id) on delete cascade;
alter table tasks             add column workspace_id uuid references workspaces (id) on delete cascade;
alter table messages          add column workspace_id uuid references workspaces (id) on delete cascade;
alter table meetings          add column workspace_id uuid references workspaces (id) on delete cascade;
alter table automations       add column workspace_id uuid references workspaces (id) on delete cascade;
alter table ai_generations    add column workspace_id uuid references workspaces (id) on delete cascade;
alter table assistant_threads add column workspace_id uuid references workspaces (id) on delete cascade;

-- usage tracking (Phase F foundation)
alter table ai_generations add column model text;
alter table ai_generations add column prompt_tokens int;
alter table ai_generations add column completion_tokens int;
alter table ai_generations add column cost_usd numeric;

-- ---------- helper functions (SECURITY DEFINER avoids RLS recursion) ----------
create or replace function my_workspace() returns uuid
  language sql stable security definer set search_path = public as $$
  select workspace_id from memberships where user_id = auth.uid() limit 1
$$;

create or replace function is_admin() returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from memberships where user_id = auth.uid() limit 1), false)
$$;

-- ---------- column defaults so inserts auto-fill owner + workspace ----------
do $defaults$
declare t text;
begin
  foreach t in array array[
    'clients','tasks','messages','meetings','automations','ai_generations','assistant_threads'
  ] loop
    execute format('alter table %I alter column owner_id set default auth.uid()', t);
    execute format('alter table %I alter column workspace_id set default my_workspace()', t);
  end loop;
end $defaults$;

-- ---------- RLS: workspaces + memberships ----------
alter table workspaces enable row level security;
alter table memberships enable row level security;

create policy "ws members read" on workspaces for select using (id = my_workspace());
create policy "ws admin update" on workspaces for update
  using (id = my_workspace() and is_admin()) with check (id = my_workspace() and is_admin());

create policy "memb read" on memberships for select using (workspace_id = my_workspace());
create policy "memb admin write" on memberships for all
  using (workspace_id = my_workspace() and is_admin())
  with check (workspace_id = my_workspace() and is_admin());

-- ---------- RLS rewrite: workspace + role on scoped entities ----------
do $rls$
declare t text;
begin
  foreach t in array array[
    'clients','tasks','messages','meetings','automations','ai_generations','assistant_threads'
  ] loop
    execute format('drop policy if exists "owner all" on %I', t);
    execute format(
      'create policy "ws scoped" on %I for all '
      'using (workspace_id = my_workspace() and (is_admin() or owner_id = auth.uid())) '
      'with check (workspace_id = my_workspace() and (is_admin() or owner_id = auth.uid()))',
      t
    );
  end loop;
end $rls$;

-- child tables scope through their parent
drop policy if exists "owner via automation" on automation_runs;
create policy "ws via automation" on automation_runs for all
  using (exists (select 1 from automations a
    where a.id = automation_id and a.workspace_id = my_workspace() and (is_admin() or a.owner_id = auth.uid())))
  with check (exists (select 1 from automations a
    where a.id = automation_id and a.workspace_id = my_workspace() and (is_admin() or a.owner_id = auth.uid())));

drop policy if exists "owner via thread" on assistant_messages;
create policy "ws via thread" on assistant_messages for all
  using (exists (select 1 from assistant_threads th
    where th.id = thread_id and th.workspace_id = my_workspace() and (is_admin() or th.owner_id = auth.uid())))
  with check (exists (select 1 from assistant_threads th
    where th.id = thread_id and th.workspace_id = my_workspace() and (is_admin() or th.owner_id = auth.uid())));

-- let workspace co-members read each other's profile (team admin display)
create policy "read workspace profiles" on profiles for select using (
  exists (select 1 from memberships m1 join memberships m2 on m1.workspace_id = m2.workspace_id
          where m1.user_id = auth.uid() and m2.user_id = profiles.id)
);

-- ---------- seed (workspace-aware) ----------
create or replace function seed_demo_data(uid uuid, wsid uuid)
returns void language plpgsql security definer set search_path = public as $seed$
declare c_james uuid; c_priya uuid; c_david uuid;
begin
  if exists (select 1 from clients where workspace_id = wsid) then return; end if;

  insert into clients (owner_id, workspace_id, name, title, company, preferred_channel, tone, tags, bio, preferences_notes)
  values (uid, wsid, 'James Harrington', 'CEO', 'Harrington Capital', 'Email', 'Formal',
    array['Board Prep','Investor Relations','Travel'],
    'Founding CEO of Harrington Capital, a $2.4B growth equity firm. Values precision, punctuality and brevity.',
    'Morning briefing before 8 AM. Never call without pre-scheduling. Always copy the CFO on financials. Be specific with numbers and dates.')
    returning id into c_james;
  insert into clients (owner_id, workspace_id, name, title, company, preferred_channel, tone, tags, bio, preferences_notes)
  values (uid, wsid, 'Priya Nair', 'Founder & CEO', 'NovaMed Health', 'Slack', 'Direct, collaborative',
    array['Product Roadmap','Media','Fundraising'],
    'Founder of NovaMed Health, closing a $22M Series B. Highly responsive but time-poor.',
    'Slack day-to-day; email for formal/external. Lead with the ask. Calls Tue/Thu 9-11 AM only. Vegetarian.')
    returning id into c_priya;
  insert into clients (owner_id, workspace_id, name, title, company, preferred_channel, tone, tags, bio, preferences_notes)
  values (uid, wsid, 'David Osei', 'Managing Director', 'Osei Global Ventures', 'WhatsApp', 'Concise, informal',
    array['Travel','Deal Flow','Events'],
    'MD of Osei Global Ventures ($800M AUM), based between London and Accra. Values efficiency above all.',
    'WhatsApp primary. Email for contracts only. Always business class. Rosewood/Four Seasons/St. Regis. Keep messages under 3 sentences.')
    returning id into c_david;

  insert into tasks (owner_id, workspace_id, client_id, title, due_label, priority, status) values
    (uid, wsid, c_david, 'Book SF flights for David', 'Tomorrow', 'normal', 'todo'),
    (uid, wsid, c_james, 'Draft investor update email', 'Friday', 'high', 'todo'),
    (uid, wsid, c_james, 'Prepare Q3 expense report', 'Next week', 'normal', 'todo'),
    (uid, wsid, c_priya, 'Write NovaMed briefing doc', 'Thursday', 'high', 'todo'),
    (uid, wsid, c_james, 'Prepare board deck slides', 'Today, 3pm', 'urgent', 'in_progress'),
    (uid, wsid, c_priya, 'Research NovaMed competitors', 'Today, EOD', 'high', 'in_progress'),
    (uid, wsid, c_james, 'Reschedule Monday call', 'Completed', 'low', 'done'),
    (uid, wsid, c_david, 'Send travel itinerary', 'Completed', 'normal', 'done');

  insert into messages (owner_id, workspace_id, client_id, sender_name, sender_initials, subject, preview, body, category) values
    (uid, wsid, c_james, 'James Harrington', 'JH', 'Board Meeting Agenda Request', 'Could you please send over the agenda for Thursday''s board meeting by tomorrow morning?', 'Could you please send over the agenda for Thursday''s board meeting by tomorrow morning?', 'urgent'),
    (uid, wsid, c_priya, 'Priya Nair', 'PN', 'Postponing Thursday meeting', 'I need to reschedule our Thursday check-in. Can we move it to next Monday instead?', 'I need to reschedule our Thursday check-in. Can we move it to next Monday instead?', 'reply'),
    (uid, wsid, null, 'CFO Office', 'CO', 'Q3 Expense Report Due', 'Reminder: Q3 expense reports are due by end of month.', 'Reminder: Q3 expense reports are due by end of month. Please ensure all receipts are submitted.', 'delegate'),
    (uid, wsid, c_david, 'Travel Agent', 'TA', 'SF Flight Options - David Osei', 'Here are three flight options for Mr. Osei''s San Francisco trip.', 'Here are three flight options for Mr. Osei''s San Francisco trip. Please confirm preference.', 'reply'),
    (uid, wsid, null, 'Newsletter Service', 'NS', 'Weekly industry digest - Issue #142', 'This week in executive leadership: AI adoption trends, market analysis, and more.', 'This week in executive leadership: AI adoption trends, market analysis, and more.', 'archive'),
    (uid, wsid, null, 'HR Team', 'HT', 'Team offsite planning - Q4', 'We''re planning the Q4 team offsite and need input on preferred dates and venues.', 'We''re planning the Q4 team offsite and need input on preferred dates and venues.', 'delegate');

  insert into meetings (owner_id, workspace_id, client_id, title, status) values
    (uid, wsid, c_james, 'Board Prep Call', 'prepared'),
    (uid, wsid, c_priya, 'Product Review', 'needs_prep'),
    (uid, wsid, c_david, 'Travel Brief', 'prepared'),
    (uid, wsid, null, 'Team Sync', 'pending');

  insert into automations (owner_id, workspace_id, name, description, status, total_runs) values
    (uid, wsid, 'Executive Priority Alignment Automation™', 'Every morning at 7:30 AM, analyses your calendar, emails and task list to generate a prioritised daily briefing.', 'active', 247),
    (uid, wsid, 'Meeting Preparation Automation™', 'Triggered 24 hours before every scheduled meeting. Compiles attendee profiles, agenda drafts and reminders.', 'active', 183),
    (uid, wsid, 'Executive Summary Inbox Automation™', 'Runs every 2 hours to triage email, archive newsletters, delegate routine requests and surface what needs attention.', 'paused', 312);
end $seed$;

-- ---------- signup: create-or-join workspace ----------
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $newuser$
declare wsid uuid; invited uuid;
begin
  insert into profiles (id, full_name, initials)
  values (new.id, coalesce(split_part(new.email, '@', 1), 'Elite EA'), upper(left(coalesce(new.email, 'EA'), 2)))
  on conflict (id) do nothing;

  invited := nullif(new.raw_user_meta_data->>'workspace_id', '')::uuid;
  if invited is not null then
    insert into memberships (workspace_id, user_id, role) values (invited, new.id, 'ea')
      on conflict do nothing;
  else
    insert into workspaces (name) values (coalesce(split_part(new.email, '@', 1) || '''s Workspace', 'MadeEA Workspace'))
      returning id into wsid;
    insert into memberships (workspace_id, user_id, role) values (wsid, new.id, 'admin');
    perform seed_demo_data(new.id, wsid);
  end if;
  return new;
end $newuser$;

-- ---------- backfill existing users (signed up under the old schema) ----------
do $backfill$
declare u record; wsid uuid;
begin
  for u in select id, email from auth.users where id not in (select user_id from memberships) loop
    insert into workspaces (name) values (coalesce(split_part(u.email, '@', 1) || '''s Workspace', 'MadeEA Workspace'))
      returning id into wsid;
    insert into memberships (workspace_id, user_id, role) values (wsid, u.id, 'admin');
    update clients           set workspace_id = wsid where owner_id = u.id and workspace_id is null;
    update tasks             set workspace_id = wsid where owner_id = u.id and workspace_id is null;
    update messages          set workspace_id = wsid where owner_id = u.id and workspace_id is null;
    update meetings          set workspace_id = wsid where owner_id = u.id and workspace_id is null;
    update automations       set workspace_id = wsid where owner_id = u.id and workspace_id is null;
    update ai_generations    set workspace_id = wsid where owner_id = u.id and workspace_id is null;
    update assistant_threads set workspace_id = wsid where owner_id = u.id and workspace_id is null;
  end loop;
end $backfill$;
