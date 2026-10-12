-- Madeline chat history (12 Oct 2026, UI review deck slide 11).
--
-- madeline_threads (0080) held ONE conversation per person in `turns`. The
-- redesign keeps several: a list grouped Today / Yesterday / Last 7 days /
-- Older, each renamable and deletable. They go in a `chats` column on the same
-- private row, so the existing RLS (owner only) covers them unchanged.
--
-- Shape: [{ id, title, turns: [...], updatedAt }], newest first, capped at 50
-- chats of 30 turns by the app. `turns` stays as the open chat, so an older
-- tab that doesn't know about `chats` keeps working.
--
-- Safe to run twice.

alter table public.madeline_threads
  add column if not exists chats jsonb not null default '[]'::jsonb;

comment on column public.madeline_threads.chats is
  'Saved Madeline conversations: [{id, title, turns, updatedAt}], newest first. Private to the row owner (RLS from 0080).';
