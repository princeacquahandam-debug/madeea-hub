-- 0028_sop_recordings.sql. Screen recordings, and the SOPs they become.
--
-- Run once in the Supabase SQL editor, after 0027_time_tracking.sql.
--
-- §4.6. Prince called this "a serious feature" (29:00-30:57) after seeing Wing
-- Assistant's recorder. The 09 Aug direction is sharper about why: Wing has a
-- recorder, nobody has the LOOP,
--
--   EA records how they do a task
--     -> the recording becomes an SOP
--     -> the SOP is a runnable checklist
--     -> the EOD proves it was run
--     -> the client sees the proof
--     -> the replacement EA runs it on day one
--
-- That is continuity as a product, and it is the answer to "what happens when
-- our EA leaves", which is the thing a client actually fears.
--
-- Constraints come from that same document: browser tab only, mic optional,
-- ten minute cap, and the RECORDING auto-deletes at 30 days while the SOP is
-- permanent. The video is scaffolding; the written SOP is the asset.

-- ---------- the bucket ----------
-- Created here rather than by hand in the dashboard, so applying this file is
-- the whole install. Private: a recording can show an inbox, a client name, a
-- price. Sharing is done with a signed URL (R-4.6.4), which expires.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sop-recordings', 'sop-recordings', false, 209715200, array['video/webm', 'video/mp4'])
on conflict (id) do nothing;

-- ---------- recordings ----------
create table if not exists recordings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  workspace_id uuid references workspaces (id) on delete cascade default my_workspace(),

  title text not null,
  -- Path inside the bucket. Null once the 30-day cleanup has removed the file
  -- but the row is kept, so an SOP can still say where it came from.
  storage_path text,
  duration_seconds integer not null default 0,
  has_audio boolean not null default false,

  -- The SOP this became, if it became one. Null is normal: a recording can be
  -- made and written up later, or never.
  sop_id uuid references sops (id) on delete set null,

  created_at timestamptz not null default now(),
  -- Read by the cleanup below. A column rather than a computed interval so the
  -- retention window can be changed per row if a recording is ever worth keeping.
  expires_at timestamptz not null default now() + interval '30 days'
);

alter table recordings enable row level security;

create index if not exists recordings_owner_idx on recordings (workspace_id, owner_id, created_at desc);
create index if not exists recordings_expiry_idx on recordings (expires_at);

-- ---------- who sees a recording ----------
-- Yours only. This is the deliberate part: PRODUCT-DIRECTION decision 5 says
-- recordings are EA-only and never client-visible. An EA recording how they do
-- their job will show their inbox, their notes and other clients' names, and
-- they will only record honestly if they know it is not being watched.
--
-- The SOP that comes OUT of it is the shareable artifact. That is the whole
-- design: the video is private, the written procedure is the product.
drop policy if exists "recordings own" on recordings;
create policy "recordings own" on recordings for all
  using (workspace_id = my_workspace() and owner_id = auth.uid())
  with check (workspace_id = my_workspace() and owner_id = auth.uid());

-- ---------- the files ----------
-- Same rule, one level down. Objects are namespaced by user id, so the owner
-- check is the first path segment.
drop policy if exists "sop recordings read own" on storage.objects;
create policy "sop recordings read own" on storage.objects for select to authenticated
  using (bucket_id = 'sop-recordings' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "sop recordings write own" on storage.objects;
create policy "sop recordings write own" on storage.objects for insert to authenticated
  with check (bucket_id = 'sop-recordings' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "sop recordings delete own" on storage.objects;
create policy "sop recordings delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'sop-recordings' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- 30-day cleanup ----------
-- Deletes the FILE and blanks the path, keeping the row so an SOP can still
-- show its provenance. Not scheduled here: pg_cron is not enabled on every
-- Supabase plan, and a migration that silently does nothing is worse than one
-- that hands you a command. Run it from a scheduled Edge Function, or:
--
--   select cron.schedule('purge-recordings', '0 3 * * *', $$select purge_expired_recordings()$$);
create or replace function purge_expired_recordings()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $purge$
declare n integer := 0;
begin
  -- Remove the objects first. If this half fails the rows keep their paths and
  -- the next run retries; blanking first would orphan the files forever.
  delete from storage.objects
  where bucket_id = 'sop-recordings'
    and name in (select storage_path from recordings where expires_at < now() and storage_path is not null);

  update recordings set storage_path = null where expires_at < now() and storage_path is not null;
  get diagnostics n = row_count;
  return n;
end $purge$;

comment on table recordings is
  'Screen recordings that become SOPs. EA-only by design (PRODUCT-DIRECTION decision 5); the SOP is the shareable artifact, not the video. Files purge at 30 days via purge_expired_recordings().';

-- The SOP keeps a pointer back, so "where did this procedure come from" has an
-- answer for as long as the file exists.
alter table sops add column if not exists source_recording_id uuid references recordings (id) on delete set null;
