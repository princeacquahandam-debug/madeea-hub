-- 0017_memory.sql — the Memory Helper's durable facts.
--
-- SCOPE NOTE, because the name promises more than this delivers and that gap is
-- worth writing down rather than discovering later:
--
-- This is a CURATED memory, not an automatic one. Every row got here because a
-- human wrote it down or confirmed it. There is no embedding column, no vector
-- index, and no background job reading past emails and inferring facts.
--
-- That was a deliberate call. Automatic semantic recall over the whole workspace
-- needs pgvector, an embedding pipeline, a retrieval strategy, and — because this
-- is an invite-only shared workspace — an answer to "whose data can surface in
-- whose prompt". Shipping a keyword-matched curated store first means the schema
-- that a later embedding layer would sit on already exists and is populated, and
-- nothing claims to be smarter than it is in the meantime.
--
-- If embeddings are added later: add `embedding vector(1536)` and an ivfflat index
-- here. Nothing in this table needs to change shape.

create table if not exists memories (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid default my_workspace() references workspaces (id) on delete cascade,
  owner_id uuid default auth.uid() references auth.users (id) on delete set null,

  -- What kind of thing this is. Drives how it's surfaced: a `preference` belongs in
  -- an email draft, a `commitment` belongs in a briefing.
  kind text not null default 'fact'
    check (kind in ('preference', 'fact', 'commitment', 'context')),

  -- Who it's about. Null = a general fact about the desk, not about a client.
  client_id uuid references clients (id) on delete cascade,

  body text not null,

  -- Where it came from, in the user's words ("said on the 12 Mar call"). Provenance
  -- is not decoration: a fact with no traceable origin is one nobody dares act on.
  source text not null default '',

  -- Pinned facts always surface for their client, regardless of keyword match.
  pinned boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists memories_client_idx on memories (workspace_id, client_id, pinned);

alter table memories enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'memories' and policyname = 'ws shared') then
    create policy "ws shared" on memories for all
      using (workspace_id = my_workspace())
      with check (workspace_id = my_workspace());
  end if;
end $$;

-- Keep updated_at honest without the app having to remember.
create or replace function touch_memory() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists memories_touch on memories;
create trigger memories_touch
  before update on memories
  for each row execute function touch_memory();
