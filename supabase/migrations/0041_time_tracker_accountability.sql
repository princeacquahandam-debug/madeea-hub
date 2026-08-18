-- Time Tracker becomes a payroll and work-verification record, not an honour
-- system with a stopwatch on it.
--
-- Reichelle's requirement in one sentence: it must be able to answer "how do we
-- know the EA actually worked those hours". Everything here exists to make the
-- recorded hours hard to fabricate after the fact.
--
-- WHAT WAS ACTUALLY OPEN. The `time write` policy was `for ALL` with
-- `owner_id = auth.uid()`, which reads like ownership but grants INSERT, UPDATE
-- and DELETE on your own rows without limit. An EA could delete a short day,
-- extend a session after finishing, or insert a row backdated to last Tuesday,
-- and nothing in the schema or the UI would have noticed. A timesheet its own
-- subject can rewrite is not evidence of anything.

-- ── 1. Early clock-out reason ────────────────────────────────────────────
-- A note, not a picklist. Reichelle asked for a plain field: the reasons that
-- matter are the ones nobody thought to put in a dropdown, and a required
-- "Other" option collects nothing useful.
alter table public.time_entries
  add column if not exists early_reason text;

-- ── 2. Workspace time settings ───────────────────────────────────────────
-- The expected day and the screenshot interval are policy, not constants
-- compiled into a page. Reichelle wants 10 minutes but explicitly accepted 15
-- or 20 if volume demands it, so the number has to be changeable without a
-- deploy. 30 was called too long and is refused by the check.
create table if not exists public.time_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  daily_hours numeric(4,2) not null default 8 check (daily_hours > 0 and daily_hours <= 24),
  screenshot_minutes int not null default 10 check (screenshot_minutes between 5 and 20),
  screenshots_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.time_settings enable row level security;

create policy "time settings readable by the workspace"
  on public.time_settings for select
  using (workspace_id = my_workspace());

-- Only an admin sets policy. An EA who could raise their own expected day, or
-- switch screenshots off, would be back to an honour system.
create policy "time settings changed by admins"
  on public.time_settings for all
  using (workspace_id = my_workspace() and is_admin())
  with check (workspace_id = my_workspace() and is_admin());

insert into public.time_settings (workspace_id)
  select id from public.workspaces
  on conflict (workspace_id) do nothing;

-- ── 3. Screenshots ───────────────────────────────────────────────────────
-- The image itself lives in storage; this is the index. Kept append-only for
-- the subject of the screenshot, because a monitoring record its subject can
-- delete monitors nothing.
create table if not exists public.time_screenshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default my_workspace() references public.workspaces(id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  time_entry_id uuid references public.time_entries(id) on delete cascade,
  captured_at timestamptz not null default now(),
  storage_path text not null,
  -- What the EA actually shared. A browser cannot force a full-desktop grab, so
  -- recording whether they shared a screen, a window or a single tab is the
  -- difference between evidence and a comforting thumbnail.
  surface text check (surface in ('monitor', 'window', 'browser', 'unknown')),
  width int,
  height int,
  created_at timestamptz not null default now()
);

create index if not exists time_screenshots_owner_time
  on public.time_screenshots (owner_id, captured_at desc);

alter table public.time_screenshots enable row level security;

create policy "screenshots visible to their subject and to admins"
  on public.time_screenshots for select
  using (
    workspace_id = my_workspace()
    and (owner_id = auth.uid() or is_admin())
  );

-- An EA may add their own. Deliberately no update or delete policy for them:
-- absent means denied, the same append-only rule used elsewhere in this schema.
create policy "screenshots inserted by their subject"
  on public.time_screenshots for insert
  with check (workspace_id = my_workspace() and owner_id = auth.uid());

create policy "screenshots removed by admins"
  on public.time_screenshots for delete
  using (workspace_id = my_workspace() and is_admin());

-- ── 4. Close the timesheet to its own subject ────────────────────────────
drop policy if exists "time write" on public.time_entries;

create policy "time clock in as self"
  on public.time_entries for insert
  with check (workspace_id = my_workspace() and owner_id = auth.uid());

-- An EA updates only to CLOSE a running session. The guard below enforces what
-- a policy cannot express: which columns may move.
create policy "time clock out own open session"
  on public.time_entries for update
  using (workspace_id = my_workspace() and owner_id = auth.uid());

-- No delete policy for EAs at all. Deleting a short day was the single easiest
-- way to fake a timesheet, and it left no trace because the row simply stopped
-- existing. Corrections are an admin action, which is what Reichelle asked for:
-- the EA requests, management applies.
create policy "time deleted by admins"
  on public.time_entries for delete
  using (workspace_id = my_workspace() and is_admin());

-- ── 5. The guard ─────────────────────────────────────────────────────────
-- RLS decides WHICH rows you may touch. It cannot say which COLUMNS, and that
-- is exactly where the manipulation lives: the same UPDATE that legitimately
-- closes a session could also move its start time three hours earlier.
create or replace function public.time_entries_guard()
returns trigger
language plpgsql
as $$
begin
  -- Admins are the correction mechanism and are trusted by design.
  if public.is_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    /* Clock-in means now. Backdating is the other easy forgery: an EA could
       insert a session that started before they arrived. A little slack for
       clock skew and a slow request, no more. */
    if new.started_at < now() - interval '5 minutes'
       or new.started_at > now() + interval '5 minutes' then
      raise exception 'Clock-in time must be now. Ask an admin to add time you missed.';
    end if;
    if new.ended_at is not null then
      raise exception 'A session cannot be created already closed.';
    end if;
    return new;
  end if;

  -- UPDATE from here down.
  if old.ended_at is not null then
    raise exception 'A finished session cannot be edited. Ask an admin for a correction.';
  end if;
  if new.started_at is distinct from old.started_at then
    raise exception 'The start of a session cannot be changed.';
  end if;
  if new.owner_id is distinct from old.owner_id then
    raise exception 'A session cannot be reassigned.';
  end if;
  if new.ended_at is not null then
    if new.ended_at < old.started_at then
      raise exception 'Clock-out cannot precede clock-in.';
    end if;
    /* Closing in the future would let somebody bank hours they have not worked
       yet. Same slack as above. */
    if new.ended_at > now() + interval '5 minutes' then
      raise exception 'Clock-out cannot be in the future.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists time_entries_guard_trg on public.time_entries;
create trigger time_entries_guard_trg
  before insert or update on public.time_entries
  for each row execute function public.time_entries_guard();
