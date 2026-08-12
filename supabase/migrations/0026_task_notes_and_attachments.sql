-- ===========================================================================
-- Task notes, day-stamped progress, and attachments.
--
-- Run once in the Supabase SQL editor, after 0025_meeting_intelligence.sql.
--
-- From the 10 Aug product audit, Reichelle at 46:06 and 47:04-48:10:
--
--   R-4.7.2  a research or deliverable task produces an OUTPUT, and the output
--            has to live on the task: a reference link to the Google Doc, an
--            image, a document.
--   R-4.7.3  the only free-text field on a task is a one-line "What's blocking
--            this?" input. Real notes do not fit on one line.
--   R-4.7.4  a task spanning several days needs day-stamped progress notes, so
--            the EA knows where they left off. Her example: building a 3-day
--            course with assessments.
--
-- blocker_note is deliberately left alone. It means something specific — this
-- is blocked, and here is why — and it feeds the blockers section of the EOD
-- draft (lib/eodDraft.ts). Folding general notes into it would put "spoke to
-- the printer" in tomorrow's blockers list.
-- ===========================================================================

-- ── free-text notes (R-4.7.3) ─────────────────────────────────────────────
alter table public.tasks add column if not exists notes text;

comment on column public.tasks.notes is
  'Free-text working notes for the task. Distinct from blocker_note, which means blocked-and-why and feeds the EOD.';

-- ── day-stamped progress (R-4.7.4) ────────────────────────────────────────
-- An array of {at, body}, newest first. jsonb rather than a child table: these
-- are read and written only with their task, never queried across tasks, and a
-- table would add a join and an RLS policy for no gain.
alter table public.tasks add column if not exists progress jsonb not null default '[]'::jsonb;

comment on column public.tasks.progress is
  'Day-stamped progress entries, newest first: [{"at":"2026-08-12T09:00:00Z","body":"Drafted module 1"}].';

-- ── attachments and reference links (R-4.7.2) ─────────────────────────────
-- {id, kind:'link'|'file', label, url}. A link and an uploaded file are the
-- same shape deliberately: the EA thinks "the deliverable is attached to the
-- task", not "this one is a URL and that one is in a bucket".
alter table public.tasks add column if not exists attachments jsonb not null default '[]'::jsonb;

comment on column public.tasks.attachments is
  'Reference links and files: [{"id":"...","kind":"link","label":"Deliverable","url":"https://..."}].';

-- Guard the shape. Without this a client bug can write a bare object or a
-- string, and every reader then needs to defend against it forever.
alter table public.tasks drop constraint if exists tasks_progress_is_array;
alter table public.tasks add constraint tasks_progress_is_array
  check (jsonb_typeof(progress) = 'array');

alter table public.tasks drop constraint if exists tasks_attachments_is_array;
alter table public.tasks add constraint tasks_attachments_is_array
  check (jsonb_typeof(attachments) = 'array');

-- No RLS changes needed: these are columns on `tasks`, and the existing
-- policies already decide who may read or write a task row. A new column
-- inherits them.
