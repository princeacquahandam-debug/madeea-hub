-- MadeEA EA Hub — initial schema
-- Multi-user from day one: every row is owned by an auth user and isolated by RLS.

-- ---------- enums ----------
create type priority as enum ('urgent', 'high', 'normal', 'low');
create type task_status as enum ('todo', 'in_progress', 'done');
create type message_category as enum ('urgent', 'reply', 'delegate', 'archive');
create type meeting_status as enum ('prepared', 'needs_prep', 'pending');
create type automation_status as enum ('active', 'paused');

-- ---------- profiles ----------
create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default 'Elite EA',
  role text not null default 'Elite EA',
  initials text not null default 'EA',
  created_at timestamptz not null default now()
);

-- ---------- clients ----------
create table clients (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  title text,
  company text,
  preferred_channel text,
  tone text,
  tags text[] default '{}',
  bio text,
  preferences_notes text,
  created_at timestamptz not null default now()
);

-- ---------- tasks ----------
create table tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  client_id uuid references clients (id) on delete set null,
  title text not null,
  due_label text,
  due_at timestamptz,
  priority priority not null default 'normal',
  status task_status not null default 'todo',
  created_at timestamptz not null default now()
);

-- ---------- messages ----------
create table messages (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  client_id uuid references clients (id) on delete set null,
  sender_name text not null,
  sender_initials text,
  subject text,
  preview text,
  body text,
  received_at timestamptz not null default now(),
  category message_category not null default 'reply',
  source text not null default 'manual',
  gmail_id text,
  is_read boolean not null default false
);

-- ---------- meetings ----------
create table meetings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  client_id uuid references clients (id) on delete set null,
  title text not null,
  starts_at timestamptz,
  status meeting_status not null default 'pending',
  source text not null default 'manual',
  gcal_event_id text
);

-- ---------- automations ----------
create table automations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  description text,
  trigger text,
  action text,
  status automation_status not null default 'active',
  last_run_at timestamptz,
  total_runs int not null default 0,
  is_custom boolean not null default false
);

create table automation_runs (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid not null references automations (id) on delete cascade,
  ran_at timestamptz not null default now(),
  summary text,
  output jsonb
);

-- ---------- ai generations (output history is first-class) ----------
create table ai_generations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  client_id uuid references clients (id) on delete set null,
  tool text not null,            -- quick_action | studio | bookkeeping
  format text not null,
  inputs jsonb not null default '{}',
  output text,
  created_at timestamptz not null default now()
);

-- ---------- assistant chat ----------
create table assistant_threads (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  title text,
  created_at timestamptz not null default now()
);

create table assistant_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references assistant_threads (id) on delete cascade,
  role text not null,            -- user | assistant
  content text not null,
  created_at timestamptz not null default now()
);

-- ---------- provider credentials (server-side only) ----------
create table google_credentials (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade unique,
  refresh_token text not null,
  scopes text,
  connected_at timestamptz not null default now()
);

create table slack_credentials (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade unique,
  access_token text not null,
  team_id text,
  connected_at timestamptz not null default now()
);

-- ---------- RLS: owner-only on every table ----------
alter table profiles enable row level security;
alter table clients enable row level security;
alter table tasks enable row level security;
alter table messages enable row level security;
alter table meetings enable row level security;
alter table automations enable row level security;
alter table automation_runs enable row level security;
alter table ai_generations enable row level security;
alter table assistant_threads enable row level security;
alter table assistant_messages enable row level security;
alter table google_credentials enable row level security;
alter table slack_credentials enable row level security;

create policy "own profile" on profiles for all using (id = auth.uid()) with check (id = auth.uid());

-- generic owner policies
do $$
declare t text;
begin
  foreach t in array array[
    'clients','tasks','messages','meetings','automations',
    'ai_generations','assistant_threads','google_credentials','slack_credentials'
  ] loop
    execute format(
      'create policy "owner all" on %I for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());', t
    );
  end loop;
end $$;

-- child tables: scope through parent ownership
create policy "owner via automation" on automation_runs for all
  using (exists (select 1 from automations a where a.id = automation_id and a.owner_id = auth.uid()))
  with check (exists (select 1 from automations a where a.id = automation_id and a.owner_id = auth.uid()));

create policy "owner via thread" on assistant_messages for all
  using (exists (select 1 from assistant_threads th where th.id = thread_id and th.owner_id = auth.uid()))
  with check (exists (select 1 from assistant_threads th where th.id = thread_id and th.owner_id = auth.uid()));

-- service_role (Edge Functions) bypasses RLS automatically.
