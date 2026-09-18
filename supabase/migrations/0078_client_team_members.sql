-- A client's own team members, who do timed work on the account.
--
-- === THIS IS A SECOND REVERSAL, AND IT CHANGES WHAT THE PRODUCT IS =======
--
-- 14 Sep ruled client-side people out entirely: "hindi po sila pwede magpasok
-- ng team members nila, kasi exclusive lang po ito for MadeEA" (15:18). 0074
-- reopened it as READ-ONLY viewers, capped at five, which kept the commercial
-- line intact: more eyes on the work, not more people doing it.
--
-- This goes further. A member clocks in, is screenshotted, and is handed tasks.
-- That is an assistant, staffed by the client rather than by the agency, which
-- is the thing the original decision existed to prevent. It is a defensible
-- product -- it sells the OS rather than the people -- but it is a different
-- business from the one the call was protecting, and it is recorded here as a
-- decision rather than left to be inferred from a schema.
--
-- === WHY NEW TABLES AND NOT THE EXISTING ONES ===========================
--
-- Every policy on time_entries and time_screenshots gates on
-- `workspace_id = my_workspace()`, and my_workspace() is NULL for every client
-- account by construction (0065: the isolation is the ABSENCE of a membership
-- row). A client member can therefore never read or write those tables, and
-- the fix is NOT to give them a membership -- 0070 refuses that combination by
-- trigger, and it would handreach them the entire agency app.
--
-- So: parallel tables, scoped by client_id and gated on my_client(). They carry
-- no workspace_id at all, which is the point. Agency staff cannot read them
-- either, which is the answer to "who sees this": the client only. The agency
-- has no reason to hold monitoring footage of people it does not employ, and
-- every extra reader of a screenshot table is a data-protection question
-- somebody has to answer later.
--
-- === THE THREE ROLES ====================================================
--
--   primary  the client. Assigns work, sees everything on the account.
--   member   their staff. Own tasks, own clock, own captures. NOT the client
--            channels, and not another member's monitoring.
--   viewer   unchanged from 0074: reads the account, does nothing.

-- ---------------------------------------------------------------------------
-- 1. The new role.
-- ---------------------------------------------------------------------------

alter table public.client_users drop constraint if exists client_users_role_check;
alter table public.client_users
  add constraint client_users_role_check check (role in ('primary', 'viewer', 'member'));

comment on column public.client_users.role is
  'primary is the client and may act on everything. member is their own staff, who do timed work. viewer reads the account and does nothing.';

-- ---------------------------------------------------------------------------
-- 2. Their clock.
-- ---------------------------------------------------------------------------

create table if not exists public.client_time_entries (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  owner_id  uuid not null references auth.users (id) on delete cascade default auth.uid(),

  started_at timestamptz not null default now(),
  -- Null means running. One open entry per person, enforced below.
  ended_at   timestamptz,
  note       text,
  task_id    uuid references public.tasks (id) on delete set null,

  /* The working day this belongs to, set by the browser from ITS local date --
     0027's reasoning, unchanged: somebody finishing at 01:00 is still working
     the previous day, and current_date on a UTC server disagrees. */
  work_date date not null default current_date,
  created_at timestamptz not null default now()
);

create unique index if not exists client_time_one_running
  on public.client_time_entries (owner_id) where ended_at is null;

create index if not exists client_time_client_day
  on public.client_time_entries (client_id, work_date desc);

create table if not exists public.client_time_screenshots (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  owner_id  uuid not null references auth.users (id) on delete cascade default auth.uid(),
  entry_id  uuid references public.client_time_entries (id) on delete cascade,

  captured_at timestamptz not null default now(),
  storage_path text not null,
  surface text check (surface in ('monitor', 'window', 'browser', 'unknown')),
  width int,
  height int,
  created_at timestamptz not null default now()
);

create index if not exists client_shots_owner_time
  on public.client_time_screenshots (owner_id, captured_at desc);

alter table public.client_time_entries      enable row level security;
alter table public.client_time_screenshots  enable row level security;

/* A member writes their own rows and reads them back. The primary reads every
   row on their account and writes none -- a timesheet the employer can edit is
   not a timesheet. A viewer matches neither clause and sees nothing. */
drop policy if exists "client time own" on public.client_time_entries;
create policy "client time own" on public.client_time_entries
  for all to authenticated
  using (client_id = public.my_client() and owner_id = auth.uid())
  with check (client_id = public.my_client() and owner_id = auth.uid()
              and public.my_client_role() = 'member');

drop policy if exists "client time primary reads" on public.client_time_entries;
create policy "client time primary reads" on public.client_time_entries
  for select to authenticated
  using (client_id = public.my_client() and public.my_client_role() = 'primary');

drop policy if exists "client shots own" on public.client_time_screenshots;
create policy "client shots own" on public.client_time_screenshots
  for all to authenticated
  using (client_id = public.my_client() and owner_id = auth.uid())
  with check (client_id = public.my_client() and owner_id = auth.uid()
              and public.my_client_role() = 'member');

drop policy if exists "client shots primary reads" on public.client_time_screenshots;
create policy "client shots primary reads" on public.client_time_screenshots
  for select to authenticated
  using (client_id = public.my_client() and public.my_client_role() = 'primary');

-- ---------------------------------------------------------------------------
-- 3. Somewhere for the images.
-- ---------------------------------------------------------------------------
--
-- Its own bucket, not the staff one. time-screenshots holds footage of agency
-- employees and its policies are written for workspace members; mixing a second
-- population into it means one policy change can expose either group to the
-- other. Separate buckets make that impossible rather than unlikely.

insert into storage.buckets (id, name, public)
select 'client-screenshots', 'client-screenshots', false
where not exists (select 1 from storage.buckets where id = 'client-screenshots');

do $shots$
begin
  if not exists (select 1 from pg_policies
                 where schemaname = 'storage' and tablename = 'objects'
                   and policyname = 'client shots upload own folder') then
    /* The first path segment is the uploader's auth id, so a member can only
       ever write beneath themselves. Without it any client account could
       overwrite another person's captures by guessing a path. */
    create policy "client shots upload own folder" on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'client-screenshots'
        and (storage.foldername(name))[1] = auth.uid()::text
        and public.my_client_role() = 'member'
      );
  end if;

  if not exists (select 1 from pg_policies
                 where schemaname = 'storage' and tablename = 'objects'
                   and policyname = 'client shots read') then
    create policy "client shots read" on storage.objects
      for select to authenticated
      using (
        bucket_id = 'client-screenshots'
        and (
          -- The person who took it.
          (storage.foldername(name))[1] = auth.uid()::text
          -- Or the client whose account they work on.
          or (
            public.my_client_role() = 'primary'
            and exists (
              select 1 from public.client_users cu
              where cu.user_id::text = (storage.foldername(name))[1]
                and cu.client_id = public.my_client()
            )
          )
        )
      );
  end if;
end $shots$;

-- ---------------------------------------------------------------------------
-- 4. The clock, as two calls.
-- ---------------------------------------------------------------------------

create or replace function public.client_clock_in(p_task_id uuid default null, p_note text default null)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $cin$
declare cid uuid; new_id uuid;
begin
  cid := public.my_client();
  if cid is null or public.my_client_role() <> 'member' then
    raise exception 'Only a team member on this account may clock in.' using errcode = 'insufficient_privilege';
  end if;

  if exists (select 1 from public.client_time_entries where owner_id = auth.uid() and ended_at is null) then
    raise exception 'You are already clocked in.' using errcode = 'check_violation';
  end if;

  insert into public.client_time_entries (client_id, owner_id, task_id, note)
  values (cid, auth.uid(), p_task_id, p_note)
  returning id into new_id;

  return new_id;
end $cin$;

create or replace function public.client_clock_out()
returns boolean
language plpgsql security definer set search_path = public, pg_temp as $cout$
begin
  if public.my_client_role() <> 'member' then
    raise exception 'Only a team member may clock out.' using errcode = 'insufficient_privilege';
  end if;

  update public.client_time_entries
     set ended_at = now()
   where owner_id = auth.uid() and ended_at is null;

  if not found then
    raise exception 'You are not clocked in.' using errcode = 'no_data_found';
  end if;
  return true;
end $cout$;

-- ---------------------------------------------------------------------------
-- 5. Work handed to a team member.
-- ---------------------------------------------------------------------------
--
-- tasks.assignee_id is an auth user, and a client member is one, so the
-- existing table carries this without a new column. What it needs is a door:
-- client_create_task always assigns to the lead EA, which is right for work
-- asked OF the agency and wrong for work the client hands to their own staff.

create or replace function public.client_create_team_task(
  p_title text, p_assignee_email text, p_due_label text default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $teamtask$
declare cid uuid; ws uuid; target uuid; open_count int; new_id uuid;
begin
  cid := public.my_client();
  if cid is null or public.my_client_role() <> 'primary' then
    raise exception 'Only the account owner may assign work to the team.' using errcode = 'insufficient_privilege';
  end if;

  if coalesce(btrim(p_title), '') = '' then
    raise exception 'A task needs a title.' using errcode = 'check_violation';
  end if;

  /* Resolved against THIS account's people. Naming anybody else, deliberately
     or by typo, has to fail rather than quietly assign work into the void. */
  select cu.user_id into target
  from public.client_users cu
  join auth.users u on u.id = cu.user_id
  where cu.client_id = cid and cu.role = 'member'
    and lower(u.email) = lower(btrim(p_assignee_email))
  limit 1;

  if target is null then
    raise exception 'Nobody on your team uses that address.' using errcode = 'no_data_found';
  end if;

  select cu.workspace_id into ws from public.client_users cu where cu.user_id = auth.uid() limit 1;

  select count(*) into open_count
  from public.tasks where client_id = cid and assignee_id = target and status <> 'done';
  if open_count >= 100 then
    raise exception 'That person already has 100 open tasks.' using errcode = 'check_violation';
  end if;

  insert into public.tasks (workspace_id, client_id, title, due_label, assignee_id, requested_by_client)
  values (ws, cid, btrim(p_title), nullif(btrim(coalesce(p_due_label, '')), ''), target, true)
  returning id into new_id;

  return new_id;
end $teamtask$;

/* A member moves their own work along. Status only: the title, the client and
   the assignee are not theirs to change, and an insert policy could not stop
   them sending those. */
create or replace function public.client_member_set_status(p_task_id uuid, p_status text)
returns boolean
language plpgsql security definer set search_path = public, pg_temp as $setst$
declare cid uuid;
begin
  cid := public.my_client();
  if cid is null or public.my_client_role() <> 'member' then
    raise exception 'Only a team member may update their own work.' using errcode = 'insufficient_privilege';
  end if;

  if p_status not in ('todo', 'in_progress', 'done') then
    raise exception 'Status must be todo, in_progress or done.' using errcode = 'check_violation';
  end if;

  /* tasks.status is the task_status enum (0001), not text. Without the cast
     Postgres refuses the assignment at runtime, which is a failure a reader of
     this function would never predict from its signature. */
  update public.tasks
     set status = p_status::task_status,
         completed_at = case when p_status = 'done' then now() else null end
   where id = p_task_id and client_id = cid and assignee_id = auth.uid();

  if not found then
    raise exception 'That task is not assigned to you.' using errcode = 'no_data_found';
  end if;
  return true;
end $setst$;

-- ---------------------------------------------------------------------------
-- 6. What each side reads.
-- ---------------------------------------------------------------------------

/* The member's own board. client_tasks shows everything on the account, which
   is right for the client and wrong for their staff -- a work surface that
   opens on somebody else's work is not a work surface. */
create or replace view public.client_my_tasks as
select
  t.id, t.title, t.status, t.priority, t.due_label, t.due_at,
  t.blocked, t.client_visible_blocker, t.completed_at, t.created_at
from public.tasks t
where t.client_id = public.my_client()
  and t.assignee_id = auth.uid();

/* The member's own clock, and the primary's view of the whole team. Two views
   rather than one with a branch, so neither can be widened by accident. */
create or replace view public.client_my_time as
select
  e.id, e.started_at, e.ended_at, e.work_date, e.note, e.task_id,
  (select count(*) from public.client_time_screenshots s where s.entry_id = e.id)::int as captures
from public.client_time_entries e
where e.owner_id = auth.uid();

create or replace view public.client_team_time as
select
  e.owner_id,
  u.email,
  e.work_date,
  (sum(extract(epoch from (coalesce(e.ended_at, now()) - e.started_at))) / 60)::bigint as minutes,
  count(*)::int as sessions,
  min(e.started_at) as first_started_at,
  max(e.ended_at)   as last_ended_at,
  bool_or(e.ended_at is null) as running
from public.client_time_entries e
join auth.users u on u.id = e.owner_id
where e.client_id = public.my_client()
  and public.my_client_role() = 'primary'
group by e.owner_id, u.email, e.work_date;

/* The primary DOES get the images here, unlike the agency-side client view in
   0073. The difference is whose screen it is: 0073 withholds pictures of an
   ASSISTANT's monitor from a client because that monitor carries other
   clients' work. This is the client's own staff, working only on this account,
   monitored by the person who employs them. */
create or replace view public.client_team_screenshots as
select
  s.id, s.owner_id, u.email, s.entry_id, s.captured_at,
  s.storage_path, s.surface, s.width, s.height
from public.client_time_screenshots s
join auth.users u on u.id = s.owner_id
where s.client_id = public.my_client()
  and (public.my_client_role() = 'primary' or s.owner_id = auth.uid());

grant select on public.client_my_tasks          to authenticated;
grant select on public.client_my_time           to authenticated;
grant select on public.client_team_time         to authenticated;
grant select on public.client_team_screenshots  to authenticated;

revoke execute on function public.client_clock_in(uuid, text)                     from public, anon;
revoke execute on function public.client_clock_out()                              from public, anon;
revoke execute on function public.client_create_team_task(text, text, text)       from public, anon;
revoke execute on function public.client_member_set_status(uuid, text)            from public, anon;

grant execute on function public.client_clock_in(uuid, text)                to authenticated;
grant execute on function public.client_clock_out()                         to authenticated;
grant execute on function public.client_create_team_task(text, text, text)  to authenticated;
grant execute on function public.client_member_set_status(uuid, text)       to authenticated;

comment on table public.client_time_entries is
  'Timed work by a client own team member. No workspace_id on purpose: agency staff do not read this, because the agency does not employ these people.';
