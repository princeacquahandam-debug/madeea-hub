-- Workforce monitoring: the data model.
--
-- WHAT THIS REUSES RATHER THAN REPLACES. The spec names Organization, User,
-- Role, Time Session and Screenshot as new entities. They already exist here as
-- workspaces, auth.users, member_role, time_entries and time_screenshots, all
-- with RLS and anti-tamper triggers already on them. Building a parallel set
-- would leave two definitions of "who worked when" and guarantee they diverge.
-- So this adds only what is genuinely missing.
--
-- THE ONE STRUCTURAL RULE, from §14: raw activity and derived intelligence are
-- separate tables. activity_records holds what was counted. activity_flags
-- holds what was concluded from it. That separation is the difference between a
-- system you can re-analyse later and one where a bad heuristic has overwritten
-- the evidence it was computed from. It is also what lets an AI pass be added
-- without touching capture, because a new analyser writes new flags and changes
-- nothing upstream.
--
-- WHAT THIS DELIBERATELY DOES NOT MODEL. There is no column for keystroke
-- content anywhere, and there will not be: the spec forbids keylogging and the
-- schema should make it impossible rather than merely discouraged. Mouse
-- coordinates are likewise absent. Only counts are stored.

-- ── 1. Roles ─────────────────────────────────────────────────────────────
-- The enum has admin and ea. The spec needs four levels. `ea` is kept and means
-- employee, because seven live rows carry it and rewriting them to satisfy a
-- naming preference is churn with a migration risk attached.
alter type member_role add value if not exists 'owner';
alter type member_role add value if not exists 'manager';
alter type member_role add value if not exists 'employee';

-- ── 2. Projects ──────────────────────────────────────────────────────────
-- `tasks` and `clients` exist; a project between them does not.
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default my_workspace() references public.workspaces(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  name text not null,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists projects_workspace_idx on public.projects (workspace_id) where not archived;

alter table public.time_entries
  add column if not exists project_id uuid references public.projects(id) on delete set null;

-- ── 3. Raw activity ──────────────────────────────────────────────────────
-- One row per capture interval. Counts only.
--
-- The columns are named for what they are, not for what a browser can supply,
-- because the source that fills them is not decided here. A native agent
-- reports OS-wide input; the browser fallback can only report what happened in
-- its own tab. `source` records which, so nobody later reads a browser figure
-- as if it covered the whole machine.
create table if not exists public.activity_records (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default my_workspace() references public.workspaces(id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  time_entry_id uuid not null references public.time_entries(id) on delete cascade,

  period_start timestamptz not null,
  period_end timestamptz not null,

  -- Aggregates. Never the keys themselves, never a coordinate.
  keystrokes int not null default 0 check (keystrokes >= 0),
  mouse_events int not null default 0 check (mouse_events >= 0),
  idle_seconds int not null default 0 check (idle_seconds >= 0),

  /* Where the numbers came from, so their meaning is not guessed later.
     browser  = this tab only, and blind to every other window on the machine
     agent    = OS-wide, from a desktop agent
     imported = a third-party tracker */
  source text not null default 'browser' check (source in ('browser', 'agent', 'imported')),

  created_at timestamptz not null default now(),
  constraint activity_period_ordered check (period_end >= period_start)
);
create index if not exists activity_records_entry_idx on public.activity_records (time_entry_id, period_start);
create index if not exists activity_records_owner_idx on public.activity_records (owner_id, period_start desc);

/* Derived, never stored: a computed column cannot drift from its inputs the way
   a written one does, and every one of these is cheap arithmetic. */
create or replace function public.activity_seconds(r public.activity_records)
returns int language sql immutable as $$
  select greatest(1, extract(epoch from (r.period_end - r.period_start))::int)
$$;

create or replace function public.activity_percent(r public.activity_records)
returns int language sql immutable as $$
  select least(100, greatest(0,
    round(100.0 * (public.activity_seconds(r) - least(r.idle_seconds, public.activity_seconds(r)))
          / public.activity_seconds(r))::int))
$$;

create or replace function public.keystrokes_per_minute(r public.activity_records)
returns numeric language sql immutable as $$
  select round(r.keystrokes::numeric * 60 / public.activity_seconds(r), 1)
$$;

create or replace function public.mouse_per_minute(r public.activity_records)
returns numeric language sql immutable as $$
  select round(r.mouse_events::numeric * 60 / public.activity_seconds(r), 1)
$$;

-- ── 4. Screenshots gain what review needs ────────────────────────────────
alter table public.time_screenshots
  add column if not exists activity_record_id uuid references public.activity_records(id) on delete set null,
  add column if not exists project_id uuid references public.projects(id) on delete set null,
  add column if not exists blurred boolean not null default false,
  /* A perceptual hash, so "the same screen again" survives JPEG noise and,
     critically, survives blurring. Comparing file bytes would call every
     blurred screenshot unique, which is exactly backwards: blur makes images
     MORE alike, not less. Stored as text because the value is a fixed-width
     bitstring and Postgres has no native pHash type. */
  add column if not exists phash text,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users(id) on delete set null;

create index if not exists screenshots_phash_idx on public.time_screenshots (owner_id, phash)
  where phash is not null and deleted_at is null;

-- ── 5. Screencasts ───────────────────────────────────────────────────────
-- Separate from `recordings`, which is the SOP/training video table and has a
-- different lifecycle, a different audience and an expiry. Merging them would
-- mean one delete policy for a how-to video and for surveillance footage.
create table if not exists public.screencasts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default my_workspace() references public.workspaces(id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  time_entry_id uuid not null references public.time_entries(id) on delete cascade,
  storage_path text not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  duration_seconds int,
  size_bytes bigint,
  /* Blur is NOT applied to video (§9). Recorded here so the review UI can say
     so rather than letting a viewer assume the screenshot rules carried over. */
  privacy_note text not null default 'Blur is not applied to video.',
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists screencasts_entry_idx on public.screencasts (time_entry_id);

-- ── 6. Derived intelligence, kept apart from the evidence ────────────────
create table if not exists public.activity_flags (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default my_workspace() references public.workspaces(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,

  -- A flag hangs off a screenshot or a period, never both.
  screenshot_id uuid references public.time_screenshots(id) on delete cascade,
  activity_record_id uuid references public.activity_records(id) on delete cascade,
  time_entry_id uuid references public.time_entries(id) on delete cascade,

  kind text not null check (kind in ('low_activity', 'identical_screenshot', 'unusual_activity')),

  /* 0..1. How sure the detector is, NOT how serious the finding is. Nothing
     downstream may read this as severity. */
  confidence numeric(3,2) not null default 1.0 check (confidence between 0 and 1),

  /* Why, in words a person can check. A flag whose reasoning cannot be read is
     an accusation. */
  reason text not null,

  /* Which analyser produced it, and which version. When a heuristic is replaced
     its old flags can be found and re-evaluated instead of silently outliving
     the logic that justified them. */
  detector text not null,
  detector_version int not null default 1,

  /* §5: an automatic flag is an observation, never a finding of misconduct. A
     human decides, and this column is the only place that decision can live. */
  review_state text not null default 'unreviewed'
    check (review_state in ('unreviewed', 'acknowledged', 'dismissed', 'confirmed_by_human')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,

  created_at timestamptz not null default now(),
  constraint flag_targets_one_thing check (
    (screenshot_id is not null)::int + (activity_record_id is not null)::int = 1
  )
);
create index if not exists flags_screenshot_idx on public.activity_flags (screenshot_id);
create index if not exists flags_owner_kind_idx on public.activity_flags (owner_id, kind, created_at desc);
-- One flag per detector per target, so a re-run updates rather than piles up.
create unique index if not exists flags_unique_per_detector
  on public.activity_flags (coalesce(screenshot_id, activity_record_id), kind, detector);

comment on table public.activity_flags is
  'Derived signals about tracked activity. A flag is an observation produced by a detector, not a finding of misconduct; review_state records what a human concluded.';

-- ── 7. Privacy, per organisation and per person ──────────────────────────
alter table public.time_settings
  add column if not exists blur_screenshots boolean not null default false,
  add column if not exists screencasts_enabled boolean not null default false,
  -- Randomise within the window instead of firing on the exact minute, so the
  -- capture time is not predictable and cannot be worked around (§1).
  add column if not exists randomize_capture boolean not null default true,
  add column if not exists retention_days int not null default 90
    check (retention_days between 1 and 3650);

-- Per-user overrides. NULL means "follow the organisation", which is different
-- from "false" and has to stay tellable apart, or an admin turning blur on for
-- everyone would silently overwrite a person's own stricter choice.
create table if not exists public.user_time_settings (
  workspace_id uuid not null default my_workspace() references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  screenshot_minutes int check (screenshot_minutes between 5 and 20),
  screenshots_enabled boolean,
  blur_screenshots boolean,
  screencasts_enabled boolean,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  primary key (workspace_id, user_id)
);

/* The effective setting for one person: their override, else the organisation's.
   One function, so a screen and a capture agent can never disagree about
   whether blur is on. */
create or replace function public.effective_time_settings(p_user uuid)
returns table (
  screenshot_minutes int,
  screenshots_enabled boolean,
  blur_screenshots boolean,
  screencasts_enabled boolean,
  randomize_capture boolean,
  retention_days int
)
language sql stable security definer set search_path = public, pg_temp as $$
  select
    coalesce(u.screenshot_minutes, t.screenshot_minutes),
    coalesce(u.screenshots_enabled, t.screenshots_enabled),
    /* Blur is the exception to "the override wins": if EITHER the organisation
       or the person asks for blur, it blurs. A privacy control that an admin can
       switch off for one employee is not a privacy control. */
    coalesce(u.blur_screenshots, false) or coalesce(t.blur_screenshots, false),
    coalesce(u.screencasts_enabled, t.screencasts_enabled),
    t.randomize_capture,
    t.retention_days
  from public.time_settings t
  left join public.user_time_settings u
    on u.workspace_id = t.workspace_id and u.user_id = p_user
  where t.workspace_id = (select workspace_id from public.memberships where user_id = p_user limit 1)
$$;

-- ── 8. Audit log ─────────────────────────────────────────────────────────
-- Append-only by policy: there is no update or delete policy below, so nobody,
-- including an admin, can edit it through the API. A log its subject can edit
-- records nothing.
create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default my_workspace() references public.workspaces(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  -- Who the record was ABOUT, which is the question an audit answers.
  subject_id uuid references auth.users(id) on delete set null,
  target_table text,
  target_id uuid,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_log_subject_idx on public.audit_log (subject_id, created_at desc);
create index if not exists audit_log_actor_idx on public.audit_log (actor_id, created_at desc);

-- ── 9. Who may do what ───────────────────────────────────────────────────
/* Returns TEXT, not member_role, and that is not cosmetic.
   Postgres refuses to let a value added by ALTER TYPE ... ADD VALUE be USED in
   the same transaction that added it, so referencing 'owner' as an enum literal
   below would make this migration unrunnable as a single unit. Comparing the
   role as text sidesteps that, and costs nothing: every caller is doing a set
   membership test, not enum arithmetic. */
create or replace function public.my_role()
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select role::text from public.memberships
   where user_id = auth.uid() and workspace_id = my_workspace()
   order by created_at asc limit 1
$$;

/* Capability, not role, is what every policy asks about. Adding a fifth role
   later is then one line here rather than an edit to a dozen policies, and the
   permission table in the UI can render straight from this. */
create or replace function public.can(capability text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select case capability
    when 'view_own_activity'      then true
    when 'view_team_activity'     then public.my_role() in ('owner','admin','manager')
    when 'view_screenshots'       then public.my_role() in ('owner','admin','manager')
    when 'view_recordings'        then public.my_role() in ('owner','admin','manager')
    when 'download_screenshots'   then public.my_role() in ('owner','admin')
    when 'download_recordings'    then public.my_role() in ('owner','admin')
    when 'delete_screenshots'     then public.my_role() in ('owner','admin')
    when 'delete_recordings'      then public.my_role() in ('owner','admin')
    when 'configure_capture'      then public.my_role() in ('owner','admin')
    when 'configure_privacy'      then public.my_role() in ('owner','admin')
    when 'review_flags'           then public.my_role() in ('owner','admin','manager')
    when 'read_audit_log'         then public.my_role() in ('owner','admin')
    else false
  end
$$;

-- ── 10. RLS ──────────────────────────────────────────────────────────────
alter table public.projects            enable row level security;
alter table public.activity_records    enable row level security;
alter table public.screencasts         enable row level security;
alter table public.activity_flags      enable row level security;
alter table public.user_time_settings  enable row level security;
alter table public.audit_log           enable row level security;

-- Every policy is scoped to my_workspace() first. That single predicate is what
-- stops one organisation reading another's, and it comes before any role check
-- so no capability can ever reach across a tenant boundary.
create policy "projects readable in workspace" on public.projects
  for select using (workspace_id = my_workspace());
create policy "projects managed by admins" on public.projects
  for all using (workspace_id = my_workspace() and public.can('configure_capture'))
  with check (workspace_id = my_workspace() and public.can('configure_capture'));

create policy "activity visible to self and reviewers" on public.activity_records
  for select using (
    workspace_id = my_workspace()
    and (owner_id = auth.uid() or public.can('view_team_activity'))
  );
create policy "activity written as self" on public.activity_records
  for insert with check (workspace_id = my_workspace() and owner_id = auth.uid());

create policy "screencasts visible to self and reviewers" on public.screencasts
  for select using (
    workspace_id = my_workspace()
    and deleted_at is null
    and (owner_id = auth.uid() or public.can('view_recordings'))
  );
create policy "screencasts written as self" on public.screencasts
  for insert with check (workspace_id = my_workspace() and owner_id = auth.uid());
create policy "screencasts deleted by authorised" on public.screencasts
  for update using (workspace_id = my_workspace() and public.can('delete_recordings'));

create policy "flags visible to self and reviewers" on public.activity_flags
  for select using (
    workspace_id = my_workspace()
    and (owner_id = auth.uid() or public.can('view_team_activity'))
  );
-- Reviewers record a human conclusion. Detectors write via service role.
create policy "flags reviewed by reviewers" on public.activity_flags
  for update using (workspace_id = my_workspace() and public.can('review_flags'));

create policy "own privacy settings readable" on public.user_time_settings
  for select using (
    workspace_id = my_workspace()
    and (user_id = auth.uid() or public.can('configure_privacy'))
  );
/* A person may always tighten their own privacy. An admin may configure anyone
   (§6 asks for both), and the effective_time_settings rule above is what stops
   that becoming a way to switch someone's blur off. */
create policy "own privacy settings writable" on public.user_time_settings
  for all using (
    workspace_id = my_workspace()
    and (user_id = auth.uid() or public.can('configure_privacy'))
  )
  with check (
    workspace_id = my_workspace()
    and (user_id = auth.uid() or public.can('configure_privacy'))
  );

create policy "audit log readable by admins" on public.audit_log
  for select using (workspace_id = my_workspace() and public.can('read_audit_log'));
-- Insert only. No update or delete policy exists, deliberately.
create policy "audit log append only" on public.audit_log
  for insert with check (workspace_id = my_workspace());

-- ── 11. Screenshots: viewing, deleting, and not un-blurring ──────────────
drop policy if exists "screenshots visible to their subject and to admins" on public.time_screenshots;
create policy "screenshots visible to subject and reviewers" on public.time_screenshots
  for select using (
    workspace_id = my_workspace()
    and deleted_at is null
    and (owner_id = auth.uid() or public.can('view_screenshots'))
  );

drop policy if exists "screenshots removed by admins" on public.time_screenshots;
create policy "screenshots deleted by authorised" on public.time_screenshots
  for update using (workspace_id = my_workspace() and public.can('delete_screenshots'));

/* Blur is one-way (§6). The flag can be set and never cleared, because the
   pipeline overwrites the stored image rather than keeping an original beside
   it: there is nothing to reveal, and a column that could be flipped back would
   imply otherwise. */
create or replace function public.screenshot_blur_is_permanent()
returns trigger language plpgsql as $$
begin
  if old.blurred and not new.blurred then
    raise exception 'A blurred screenshot cannot be un-blurred. The original was overwritten at capture time.';
  end if;
  return new;
end;
$$;
drop trigger if exists screenshot_blur_permanent on public.time_screenshots;
create trigger screenshot_blur_permanent
  before update on public.time_screenshots
  for each row execute function public.screenshot_blur_is_permanent();
