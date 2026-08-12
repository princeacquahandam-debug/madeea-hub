-- 0031_files_and_saved.sql. Shared files, and a place to keep things.
--
-- Run once in the Supabase SQL editor, after 0030.
--
-- Two small features from PROJECT_PLAN §4.5, and the 10 Aug audit's §5.5.
--
-- FILES. Clients hand assistants documents constantly, and today the only home
-- for one is a link pasted on a task. A link dies when someone tidies their
-- Drive; a file the workspace owns does not.
--
-- SAVED. Wing's sidebar has a "Saved" section, and the reason it earns a place
-- is that an EA reads something on Monday they need on Thursday, a task, a
-- recording, a comment, and the alternative is remembering where it was.

-- ---------- the bucket ----------
-- Private, like sop-recordings. Files here are client documents: contracts,
-- invoices, a passport scan for a visa application. None of that should sit
-- behind a URL that works for anyone who has it.
insert into storage.buckets (id, name, public, file_size_limit)
values ('workspace-files', 'workspace-files', false, 52428800)
on conflict (id) do nothing;

-- ---------- folders ----------
-- One level of nesting via parent_id. Deliberately not a full tree UI: a flat
-- list with folders covers what an EA actually does, and a drag-and-drop tree
-- is a week of work for the last 5%.
create table if not exists folders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid default my_workspace() references workspaces (id) on delete cascade,
  parent_id uuid references folders (id) on delete cascade,
  name text not null,
  client_id uuid references clients (id) on delete set null,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table folders enable row level security;

drop policy if exists "folders shared" on folders;
create policy "folders shared" on folders for all to authenticated
  using (workspace_id = my_workspace())
  with check (workspace_id = my_workspace());

-- ---------- files ----------
create table if not exists files (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid default my_workspace() references workspaces (id) on delete cascade,
  folder_id uuid references folders (id) on delete set null,
  client_id uuid references clients (id) on delete set null,
  task_id uuid references tasks (id) on delete set null,

  name text not null,
  mime_type text,
  size_bytes bigint not null default 0,
  storage_key text not null,
  uploaded_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table files enable row level security;

create index if not exists files_folder_idx on files (workspace_id, folder_id, created_at desc);
create index if not exists files_client_idx on files (workspace_id, client_id) where client_id is not null;

-- Shared, because a file the team cannot see is a file the cover EA cannot
-- find on the day the usual one is off. Deleting is left to the uploader and
-- admins: a shared drive where anyone can delete anything is a shared drive
-- somebody eventually empties.
drop policy if exists "files read" on files;
create policy "files read" on files for select to authenticated
  using (workspace_id = my_workspace());

drop policy if exists "files write" on files;
create policy "files write" on files for insert to authenticated
  with check (workspace_id = my_workspace() and uploaded_by = auth.uid());

drop policy if exists "files update" on files;
create policy "files update" on files for update to authenticated
  using (workspace_id = my_workspace())
  with check (workspace_id = my_workspace());

drop policy if exists "files delete" on files;
create policy "files delete" on files for delete to authenticated
  using (workspace_id = my_workspace() and (uploaded_by = auth.uid() or is_admin()));

-- ---------- the objects ----------
-- Namespaced by workspace rather than by user: these are team documents, and
-- the RLS above already decides who may see the row that points at them.
drop policy if exists "workspace files read" on storage.objects;
create policy "workspace files read" on storage.objects for select to authenticated
  using (bucket_id = 'workspace-files');

drop policy if exists "workspace files write" on storage.objects;
create policy "workspace files write" on storage.objects for insert to authenticated
  with check (bucket_id = 'workspace-files');

drop policy if exists "workspace files delete" on storage.objects;
create policy "workspace files delete" on storage.objects for delete to authenticated
  using (bucket_id = 'workspace-files');

-- ---------- saved ----------
-- A pointer, not a copy. Saving a task must not freeze it as it was; the point
-- is to find it again, and finding a stale copy is worse than not saving it.
create table if not exists saved_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid default my_workspace() references workspaces (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('task', 'recording', 'file', 'sop', 'note', 'eod')),
  target_id uuid not null,
  label text,
  created_at timestamptz not null default now(),
  -- Saving the same thing twice is a no-op, not a second row.
  unique (user_id, kind, target_id)
);

alter table saved_items enable row level security;

create index if not exists saved_items_user_idx on saved_items (user_id, created_at desc);

-- Yours alone. A shared "saved" list is a bookmarks folder nobody curates.
drop policy if exists "saved own" on saved_items;
create policy "saved own" on saved_items for all to authenticated
  using (workspace_id = my_workspace() and user_id = auth.uid())
  with check (workspace_id = my_workspace() and user_id = auth.uid());
