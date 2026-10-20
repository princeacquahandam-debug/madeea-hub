-- From the 19 Oct 2026 team meeting (EOS action items).
--
--   1. Automatic break deduction on the time tracker.
--   2. A time zone on each client, set when the client is onboarded.
--   3. Loom videos in Learn: training videos and SOP walkthroughs.
--
-- Safe to run twice.

-- ── 1. Automatic break deduction ─────────────────────────────────────────
-- An unpaid break taken off a long day automatically, the way most payroll
-- time trackers do it. Off by default (0 minutes) until an admin sets it.
-- Breaks already taken with Pause (0088) count toward it, so nobody loses the
-- same break twice. Only admins can change it (the existing "time settings"
-- policy in 0041 covers these columns).
alter table public.time_settings
  add column if not exists auto_break_minutes int not null default 0
    check (auto_break_minutes between 0 and 120),
  add column if not exists auto_break_after_hours numeric(4,2) not null default 6
    check (auto_break_after_hours > 0 and auto_break_after_hours <= 24);

comment on column public.time_settings.auto_break_minutes is
  'Unpaid break deducted from a working day longer than auto_break_after_hours. 0 = off. Time already paused that day counts toward it.';

-- ── 2. Client time zone ──────────────────────────────────────────────────
-- An IANA zone name ("Asia/Dubai"). Null until set. Covered by the existing
-- clients policies.
alter table public.clients
  add column if not exists timezone text;

comment on column public.clients.timezone is
  'The client''s own time zone (IANA name), set at onboarding. Used to show their local time.';

-- ── 3. Training videos (Loom) ────────────────────────────────────────────
create table if not exists public.learn_videos (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade default my_workspace(),
  title text not null check (length(trim(title)) between 1 and 200),
  -- The Loom share link (https://www.loom.com/share/...). Only Loom links:
  -- the app embeds them, and an embed from anywhere else is not something to
  -- allow by accident.
  url text not null check (url ~ '^https://(www\.)?loom\.com/(share|embed)/[A-Za-z0-9]+'),
  -- Attached to an SOP as its walkthrough, or null for the Training Center.
  sop_id uuid references public.sops (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists learn_videos_workspace_idx on public.learn_videos (workspace_id, created_at desc);
create index if not exists learn_videos_sop_idx on public.learn_videos (sop_id) where sop_id is not null;

alter table public.learn_videos enable row level security;

-- Everyone in the workspace can watch.
drop policy if exists "learn videos readable by the workspace" on public.learn_videos;
create policy "learn videos readable by the workspace"
  on public.learn_videos for select
  using (workspace_id = my_workspace());

-- Managers, admins and owners add and remove them.
drop policy if exists "learn videos managed by managers" on public.learn_videos;
create policy "learn videos managed by managers"
  on public.learn_videos for all
  using (workspace_id = my_workspace() and my_role() in ('owner', 'admin', 'manager'))
  with check (workspace_id = my_workspace() and my_role() in ('owner', 'admin', 'manager'));

grant select, insert, update, delete on public.learn_videos to authenticated;
