-- 0025_meeting_intelligence.sql. Read Fathom transcripts, give back the tasks,
-- decisions and memory hiding inside them.
--
-- The proposal's problem is that meetings evaporate: 79 transcripts captured, one
-- action-items file untouched since March, nothing feeding the knowledge base.
-- The fix is not another place to read notes, it is routing each extraction into
-- the tables the team ALREADY works from:
--
--   action items  -> tasks      (owned, dated, on the board they already use)
--   commitments   -> memories   (kind 'commitment')
--   insights      -> memories   (kind 'context')
--   decisions     -> meeting_decisions   (new: append-only, nothing else fits)
--   open questions-> stay on the note     (nowhere to route them, so they stay put)
--
-- A separate "meeting notes" silo would reproduce the exact failure the proposal
-- describes, a file nobody opens. Only decisions get a new table, because the
-- Hub genuinely has nowhere to put "we chose X, on this date, for this reason".

-- ---------- one structured note per recording ----------
create table if not exists meeting_notes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  workspace_id uuid not null default my_workspace() references workspaces (id) on delete cascade,

  -- Fathom's own id. The unique index below is what makes a re-sync or a backfill
  -- safe to run twice: the same recording can never be extracted (or billed) twice.
  fathom_recording_id bigint not null,

  title text not null,
  meeting_url text,
  share_url text,
  recorded_at timestamptz,
  attendees text[] not null default '{}',
  transcript_chars int not null default 0,

  summary text,
  -- The model's full structured output, kept verbatim. The routed rows below are
  -- derived from it; this is the audit trail when someone asks "why is this a task".
  extracted jsonb not null default '{}'::jsonb,

  status text not null default 'extracted',
  error text,
  routed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table meeting_notes drop constraint if exists meeting_notes_status_check;
alter table meeting_notes add constraint meeting_notes_status_check
  check (status in ('extracted', 'routed', 'failed'));

create unique index if not exists meeting_notes_fathom_uniq
  on meeting_notes (workspace_id, fathom_recording_id);
create index if not exists meeting_notes_recent_idx
  on meeting_notes (workspace_id, recorded_at desc);

-- ---------- the decisions log ----------
-- Append-only by policy, not just by convention: members may insert and read,
-- never update or delete. A decision log you can quietly edit is not a log.
create table if not exists meeting_decisions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  workspace_id uuid not null default my_workspace() references workspaces (id) on delete cascade,
  meeting_note_id uuid references meeting_notes (id) on delete cascade,

  decision text not null,
  context text,                -- why, in the meeting's own words
  quote text,                  -- the exact line it came from
  timestamp_label text,        -- e.g. "00:42:10", so it is citable
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists meeting_decisions_recent_idx
  on meeting_decisions (workspace_id, decided_at desc);

-- ---------- provenance on the routed rows ----------
-- Without these, an action item that appears on the board is indistinguishable
-- from one someone typed, and nobody can check it against what was actually said.
alter table tasks add column if not exists source_meeting_id uuid references meeting_notes (id) on delete set null;
alter table tasks add column if not exists source_quote text;
alter table memories add column if not exists source_meeting_id uuid references meeting_notes (id) on delete set null;

create index if not exists tasks_source_meeting_idx on tasks (workspace_id, source_meeting_id);

-- ---------- sync cursor ----------
-- One row per workspace. `last_created_at` is Fathom's own created_at for the
-- newest recording already pulled, which is what the API's created_after filter
-- takes, so the cursor and the filter can never disagree.
create table if not exists fathom_sync_state (
  workspace_id uuid primary key references workspaces (id) on delete cascade,
  last_created_at timestamptz,
  last_synced_at timestamptz,
  last_status text,
  last_error text,
  meetings_seen int not null default 0,
  tasks_created int not null default 0,
  decisions_logged int not null default 0,
  memories_written int not null default 0
);

-- ---------- RLS ----------
alter table meeting_notes enable row level security;
alter table meeting_decisions enable row level security;
alter table fathom_sync_state enable row level security;

drop policy if exists "ws shared" on meeting_notes;
create policy "ws shared" on meeting_notes for all
  using (workspace_id = my_workspace())
  with check (workspace_id = my_workspace());

-- Append-only: select + insert only. No update, no delete policy at all.
drop policy if exists "ws shared" on meeting_decisions;
drop policy if exists "ws read decisions" on meeting_decisions;
drop policy if exists "ws append decisions" on meeting_decisions;
create policy "ws read decisions" on meeting_decisions for select
  using (workspace_id = my_workspace());
create policy "ws append decisions" on meeting_decisions for insert
  with check (workspace_id = my_workspace());

drop policy if exists "ws read fathom state" on fathom_sync_state;
create policy "ws read fathom state" on fathom_sync_state for select
  using (workspace_id = my_workspace());
drop policy if exists "ws write fathom state" on fathom_sync_state;
create policy "ws write fathom state" on fathom_sync_state for all
  using (workspace_id = my_workspace())
  with check (workspace_id = my_workspace());

-- ---------- inherit the 0020 / 0013 guarantees ----------
-- A table created after those migrations gets neither by default.
do $trg$
begin
  if exists (select 1 from pg_proc where proname = 'force_owner_id') then
    execute 'drop trigger if exists meeting_notes_force_owner on public.meeting_notes';
    execute 'create trigger meeting_notes_force_owner before insert or update on public.meeting_notes
               for each row execute function force_owner_id()';
    execute 'drop trigger if exists meeting_decisions_force_owner on public.meeting_decisions';
    execute 'create trigger meeting_decisions_force_owner before insert or update on public.meeting_decisions
               for each row execute function force_owner_id()';
  end if;
end $trg$;
