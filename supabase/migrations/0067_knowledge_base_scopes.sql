-- A team knowledge base and a personal one, and the leak that had to close first.
--
-- ═══ WHAT WAS ACTUALLY WRONG ═════════════════════════════════════════════
--
-- 0031 gave `files` correct row policies — read your workspace, delete your own
-- or as an admin — and then wrote this for the objects themselves:
--
--   create policy "workspace files read" on storage.objects for select
--     using (bucket_id = 'workspace-files');
--
-- No workspace. No owner. Any authenticated account, in ANY workspace, could
-- read, overwrite and DELETE every object in the bucket. Its comment explains
-- the reasoning — "the RLS above already decides who may see the row that
-- points at them" — and that is the mistake: the row policy governs the
-- POINTER, storage policies govern the BYTES. Anyone holding or guessing a
-- storage key had the file, and keys were `${Date.now()}-${name}`, so guessing
-- "1724822400000-invoice.pdf" is a loop rather than a break-in.
--
-- That is cross-contamination in the plainest sense, and it exists today,
-- before any of this migration's features. It is fixed below.
--
-- The pattern being adopted is already in this schema: 0028 scopes
-- sop-recordings with (storage.foldername(name))[1] = auth.uid()::text. files
-- simply never did.
--
-- ═══ TWO SHELVES, AND WHY 'personal' MEANS PERSONAL ══════════════════════
--
--   team      the shared KB. Every member reads it, which is the point: a file
--             the team cannot see is a file the cover EA cannot find on the day
--             the usual one is off (0031's reasoning, unchanged).
--
--   personal  one account's own shelf. Readable by that account and by nobody
--             else — NOT by admins.
--
-- No admin override, deliberately, and for the reason 0040 gives about private
-- mail: a shelf an admin can read is not a personal shelf, it is a shared one
-- with a longer name, and somebody will put something on it believing the
-- label. If oversight of a personal shelf is ever wanted it needs a real
-- design — a request, a record that it happened — not a clause here.
--
-- ═══ EXISTING FILES ══════════════════════════════════════════════════════
--
-- Everything already uploaded becomes 'team', which is what it effectively was.
-- Old keys are flat (no folder), so a path-based read rule would strand them.
-- Reads and deletes are therefore governed by the `files` ROW, which every
-- object has and which already carries workspace, scope and uploader. Only
-- INSERT is path-based, because at upload time the row does not exist yet.

-- ---------------------------------------------------------------------------
-- 1. The shelf a file sits on.
-- ---------------------------------------------------------------------------
do $$ begin
  create type kb_scope as enum ('team', 'personal');
exception when duplicate_object then null; end $$;

alter table files
  add column if not exists scope kb_scope not null default 'team';

alter table folders
  add column if not exists scope kb_scope not null default 'team';

/* A personal shelf is keyed on the uploader, which files already records.
   Indexed together because "my personal files" is the only query that matters
   on that shelf and it would otherwise scan the workspace. */
create index if not exists files_personal_idx
  on files (workspace_id, uploaded_by, created_at desc)
  where scope = 'personal';

create index if not exists folders_scope_idx on folders (workspace_id, scope);

comment on column files.scope is
  'team = the shared workspace KB. personal = readable only by uploaded_by, admins included.';

-- ---------------------------------------------------------------------------
-- 2. Row policies: the personal shelf is genuinely personal.
-- ---------------------------------------------------------------------------
drop policy if exists "files read" on files;
create policy "files read" on files for select to authenticated
  using (
    workspace_id = my_workspace()
    and (scope = 'team' or uploaded_by = auth.uid())
  );

/* Writing a personal file as somebody else would be the obvious way to plant
   one, so the uploader is pinned to the caller on both shelves. */
drop policy if exists "files write" on files;
create policy "files write" on files for insert to authenticated
  with check (workspace_id = my_workspace() and uploaded_by = auth.uid());

drop policy if exists "files update" on files;
create policy "files update" on files for update to authenticated
  using (workspace_id = my_workspace() and (scope = 'team' or uploaded_by = auth.uid()))
  with check (workspace_id = my_workspace() and (scope = 'team' or uploaded_by = auth.uid()));

/* Delete: your own on either shelf, or an admin on the TEAM shelf. An admin
   cannot delete a personal file they are not allowed to read — being unable to
   see a thing and being able to destroy it is a strange pair of powers. */
drop policy if exists "files delete" on files;
create policy "files delete" on files for delete to authenticated
  using (
    workspace_id = my_workspace()
    and (uploaded_by = auth.uid() or (scope = 'team' and is_admin()))
  );

-- Folders follow their files.
drop policy if exists "folders read" on folders;
create policy "folders read" on folders for select to authenticated
  using (
    workspace_id = my_workspace()
    and (scope = 'team' or created_by = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- 3. The objects. This is the part that was open to everybody.
-- ---------------------------------------------------------------------------

/* Read and delete are decided by the row that points at the object. That row is
   already governed by the policies above, so this subquery inherits them: an
   object whose `files` row you cannot see is an object you cannot fetch. It
   also covers the old flat keys, which no path rule could. */
drop policy if exists "workspace files read" on storage.objects;
create policy "workspace files read" on storage.objects for select to authenticated
  using (
    bucket_id = 'workspace-files'
    and exists (select 1 from public.files f where f.storage_key = storage.objects.name)
  );

/* INSERT cannot ask the row, because the upload happens first — the row is
   written once the object exists. So uploads are penned into a folder named
   for the uploader, which is 0028's rule. Whether the resulting file is team or
   personal is then the row's business, not the path's. */
drop policy if exists "workspace files write" on storage.objects;
create policy "workspace files write" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'workspace-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "workspace files delete" on storage.objects;
create policy "workspace files delete" on storage.objects for delete to authenticated
  using (
    bucket_id = 'workspace-files'
    and exists (select 1 from public.files f where f.storage_key = storage.objects.name)
  );

-- ---------------------------------------------------------------------------
-- 4. What the shelves cost, in bytes.
-- ---------------------------------------------------------------------------
/* Supabase storage is metered. "No added cost" holds only while the total stays
   inside the plan's allowance, and a knowledge base grows by design. This makes
   the number visible so it is a decision rather than a surprise on an invoice.
   Deliberately a view and not a quota: refusing an upload is a product choice
   that has not been made, and guessing it here would be the wrong place. */
create or replace view kb_usage
with (security_invoker = true) as
  select
    workspace_id,
    scope,
    uploaded_by,
    count(*)                    as file_count,
    coalesce(sum(size_bytes), 0) as bytes
  from files
  group by workspace_id, scope, uploaded_by;

comment on view kb_usage is
  'Bytes held per shelf per account. security_invoker, so it shows only what the caller may already read.';
