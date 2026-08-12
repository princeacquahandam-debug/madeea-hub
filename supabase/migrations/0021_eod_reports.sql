-- 0021_eod_reports.sql. End-of-day reports + task blockers.
--
-- Consolidated from a feature branch that was cut against an OLDER checkout. That
-- branch shipped three migrations (0013_task_history_and_snoozes, 0016_eod,
-- 0019_one_identity_per_account); on THIS repo they were partly redundant and
-- partly harmful, so only the genuinely-new EOD schema is kept here:
--
--   * DROPPED entirely: the branch's 0013. Its columns (updated_at/completed_at/
--     assignee_id), task_events, snoozes, and their triggers already exist here
--     via 0013_followups / 0014_activity_log / 0015_delegation. Re-applying it
--     would have added a SECOND reassignment trigger (duplicate task_events rows)
--     and, worse, re-created a `for all` write policy on task_events. Undoing the
--     audit-trail lockdown 0020 just applied.
--   * DROPPED: the branch 0016's re-declare of the completed_at stamping trigger,
--     0014 already stamps completed_at (tasks_touch_completed_at).
--   * KEPT (below): task blocker columns, the eod_reports table + RLS, and the
--     one-identity canonical-name trigger.
--
-- Uses my_workspace() / is_admin() (0003) and the workspace-shared RLS pattern.
-- Idempotent throughout; the frontend degrades gracefully if this isn't applied
-- (the EOD page falls back to its imported July history and hides the submit box).

-- ---------- task blockers ----------
-- A blocker was the one part of an EOD the Kanban couldn't express. Making it a
-- task field means it shows on the board, ages, and rolls into EOD by itself.
alter table tasks add column if not exists blocked boolean not null default false;
alter table tasks add column if not exists blocker_note text;

-- ---------- eod_reports ----------
-- One submitted report per person per day. This is what makes "did Bryan report
-- yesterday?" answerable. Compliance % and the coverage heatmap only mean
-- something because submitting is a deliberate act, not a computed view.
create table if not exists eod_reports (
  id uuid primary key default gen_random_uuid(),
  -- Nullable on purpose: the imported July history predates these people having
  -- accounts, so those rows carry a name but no auth user.
  owner_id uuid references auth.users (id) on delete set null default auth.uid(),
  workspace_id uuid references workspaces (id) on delete cascade default my_workspace(),
  -- Who the report is for. Always set, including for imported rows.
  person_name text not null,
  report_date date not null default current_date,
  done text[] not null default '{}',
  blockers text[] not null default '{}',
  plans text[] not null default '{}',
  -- Free prose for the things that aren't tasks ("attended Monday meeting").
  notes text,
  -- Verbatim source text, kept for the imported sheet reports.
  raw text,
  imported boolean not null default false,
  submitted_at timestamptz not null default now(),
  -- Re-submitting the same day corrects the report rather than duplicating it.
  unique (person_name, report_date)
);

alter table eod_reports enable row level security;

-- Compliance is a team metric, so any member READS everyone's reports...
drop policy if exists "eod read" on eod_reports;
create policy "eod read" on eod_reports for select
  using (workspace_id = my_workspace());

-- ...but you only write your own. Admins can correct any, which is also the only
-- way the imported (owner_id null) July rows can be edited.
drop policy if exists "eod write" on eod_reports;
create policy "eod write" on eod_reports for all
  using (workspace_id = my_workspace() and (is_admin() or owner_id = auth.uid()))
  with check (workspace_id = my_workspace() and (is_admin() or owner_id = auth.uid()));

create index if not exists eod_reports_date_idx on eod_reports (workspace_id, report_date desc);
create index if not exists tasks_blocked_idx on tasks (workspace_id, blocked) where blocked;

-- ---------- one account = one identity in EOD ----------
-- Reports are attributed by the person_name the client sends (the signed-in
-- user's cached profile name). Two devices, or a profile renamed between
-- submissions, could otherwise fork one human into two rows ("Rio Castillo" and
-- "rio.castillo") and split their compliance. Derive person_name from the owner's
-- profile on every write instead; the client's value is only a fallback.
-- search_path includes pg_temp for the same defense-in-depth reason as 0020.
create or replace function eod_canonical_person()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $canon$
declare nm text;
begin
  -- Only when we know the owner. Imported/seeded rows have no owner and keep
  -- whatever name they were given.
  if new.owner_id is not null then
    select nullif(trim(full_name), '') into nm from profiles where id = new.owner_id;
    if nm is not null then
      new.person_name := nm;
    end if;
  end if;
  return new;
end $canon$;

-- BEFORE INSERT fires ahead of ON CONFLICT resolution, so the app's upsert
-- compares against the canonical name and updates the existing row rather than
-- creating a second one.
drop trigger if exists eod_canonical_person_trigger on eod_reports;
create trigger eod_canonical_person_trigger
  before insert or update on eod_reports
  for each row execute function eod_canonical_person();

-- Normalise any profile still carrying a raw email prefix ("rio.castillo" ->
-- "Rio Castillo") so the canonical name is the readable one. Idempotent: only
-- touches rows whose full_name is exactly the email local-part.
create or replace function pretty_name_from_email(addr text)
returns text language sql immutable as $$
  select nullif(trim(initcap(
    regexp_replace(split_part(coalesce(addr, ''), '@', 1), '[._-]+', ' ', 'g')
  )), '')
$$;

update profiles p
set full_name = pretty_name_from_email(u.email)
from auth.users u
where u.id = p.id
  and p.full_name = split_part(u.email, '@', 1)
  and pretty_name_from_email(u.email) is not null;
