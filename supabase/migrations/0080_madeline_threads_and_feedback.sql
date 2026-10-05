-- Madeline's conversation, saved per person, and 👍/👎 on her answers.
--
-- ── THREADS ──────────────────────────────────────────────────────────────
--
-- The conversation lived in sessionStorage, so it was per browser tab: sign
-- in on another device and Madeline had forgotten everything. One row per
-- person holds the latest turns (the app keeps the last 30). Private: only
-- the person can read or write their own row, not admins, because it holds
-- whatever they asked about clients and inboxes.
--
-- ── FEEDBACK ─────────────────────────────────────────────────────────────
--
-- A thumbs up or down on one answer, with the question and the answer as they
-- were, so "what to improve" can be read from real cases. Anyone can rate
-- their own answers; admins read them all in their workspace. One rating per
-- answer per person: rating again changes it.

create table if not exists public.madeline_threads (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  turns jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  -- 30 turns of capped replies is well under this; a runaway client isn't.
  constraint madeline_threads_size check (pg_column_size(turns) < 400000)
);

alter table public.madeline_threads enable row level security;

drop policy if exists "own thread" on public.madeline_threads;
create policy "own thread" on public.madeline_threads for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create table if not exists public.madeline_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  workspace_id uuid default my_workspace() references public.workspaces (id) on delete cascade,
  turn_id text not null,
  rating smallint not null check (rating in (-1, 1)),
  prompt text not null check (length(prompt) <= 4000),
  reply text not null check (length(reply) <= 12000),
  page text,
  created_at timestamptz not null default now(),
  unique (user_id, turn_id)
);

alter table public.madeline_feedback enable row level security;

drop policy if exists "rate own" on public.madeline_feedback;
create policy "rate own" on public.madeline_feedback for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "change own rating" on public.madeline_feedback;
create policy "change own rating" on public.madeline_feedback for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "read own or admin" on public.madeline_feedback;
create policy "read own or admin" on public.madeline_feedback for select to authenticated
  using (user_id = auth.uid() or (workspace_id = my_workspace() and is_admin()));

create index if not exists madeline_feedback_ws_idx on public.madeline_feedback (workspace_id, created_at desc);
