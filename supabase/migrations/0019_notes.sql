-- 0019_notes.sql — a lightweight Notes area (Reich's feedback: "a simple notes area").
--
-- Deliberately NOT the Memory Helper. The distinction is load-bearing:
--
--   memories — curated facts wired INTO the other helpers (a preference shapes
--              every email draft afterwards). Structured, kind-tagged, recalled.
--   notes    — a free-text scratchpad. Nothing reads a note but a human. No wiring,
--              no recall into prompts — that's the point, and keeps the two from
--              quietly competing for the same job.
--
-- Shares the workspace, like every other collaborative table here, so the team's
-- notes are one shared pad rather than a silo per EA. The frontend degrades
-- gracefully if this isn't applied yet (falls back to the local overlay, same as
-- reminders/memories), so it can't break the rest of the app before it's run.

create table if not exists notes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid default my_workspace() references workspaces (id) on delete cascade,
  owner_id uuid default auth.uid() references auth.users (id) on delete set null,

  -- Optional link to a client. Null = a general note, not about anyone in the Vault.
  client_id uuid references clients (id) on delete cascade,

  title text not null default '',
  body text not null default '',

  -- Pinned notes sort to the top, regardless of age.
  pinned boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists notes_ws_idx on notes (workspace_id, pinned, updated_at desc);

alter table notes enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'notes' and policyname = 'ws shared') then
    create policy "ws shared" on notes for all
      using (workspace_id = my_workspace())
      with check (workspace_id = my_workspace());
  end if;
end $$;

-- Keep updated_at honest without the app having to remember.
create or replace function touch_note() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists notes_touch on notes;
create trigger notes_touch
  before update on notes
  for each row execute function touch_note();
