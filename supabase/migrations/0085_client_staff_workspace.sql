-- The staff panel (a client's own team members, 0078), made a working space,
-- and joined up with the client's side of the portal. 7 Oct 2026.
--
-- 1. PRIVACY FIX. 0083/0084 bring a client's OWN Google/Outlook calendar in,
--    and told the client those events are seen by them, their EA and MadeEA's
--    admins. client_calendar is read by every login on the account, so their
--    staff (and viewers) saw them too. Those rows are now the primary's only.
-- 2. Staff see their own tasks, not the account's. client_tasks was readable
--    in full by a member through the API (the UI simply never asked). And the
--    client's board can now tell staff work from the agency's: staff_email.
-- 3. "I'm stuck": a member flags their own task with a note for the client.
-- 4. End-of-day reports from staff, read by the client.
-- 5. Messages between the client and each staff member. Not the agency: the
--    agency does not employ these people (0078), so it is not in the room.
--
-- Same shape as 0072-0078: tables nobody reads directly, views that carry the
-- access rule in their WHERE clause, and functions for every write so the
-- caller supplies content and the server decides everything else. user_id is
-- never published (0074); people are addressed by email.
--
-- Safe to run twice.

-- 1 ── client_calendar: a client's own calendar is the primary's ───────────
create or replace view public.client_calendar as
select
  m.id,
  m.title,
  m.starts_at,
  m.ends_at,
  m.all_day,
  m.location,
  m.event_timezone,
  m.hangout_link
from public.meetings m
where m.client_id = public.my_client()
  and m.starts_at is not null
  and (coalesce(m.source, '') not in ('gcal-client', 'outlook-client')
       or public.my_client_role() = 'primary');

-- 2 ── client_tasks: staff see their own; the board can label staff work ────
create or replace view public.client_tasks as
select
  t.id,
  t.client_id,
  t.title,
  t.status,
  t.priority,
  t.due_label,
  t.due_at,
  t.blocked,
  t.client_visible_blocker,
  t.completed_at,
  t.created_at,
  t.updated_at,
  t.requested_by_client,
  /* Who on the client's OWN staff this is with. Null for the agency's work.
     An email, to the primary only (0074: addresses are the primary's). */
  case when public.my_client_role() = 'primary' then (
    select u.email from public.client_users cu join auth.users u on u.id = cu.user_id
    where cu.user_id = t.assignee_id and cu.client_id = t.client_id and cu.role = 'member'
  ) end as staff_email
from public.tasks t
where t.client_id = public.my_client()
  and (public.my_client_role() <> 'member' or t.assignee_id = auth.uid());

grant select on public.client_tasks to authenticated;

-- 3 ── "I'm stuck" ─────────────────────────────────────────────────────────
/* Null or blank clears it. client_visible_blocker is "what the client needs
   to do or know" (0075), which is exactly this note's reader. */
create or replace function public.client_member_set_blocker(p_task_id uuid, p_note text)
returns boolean
language plpgsql security definer set search_path = public, pg_temp as $blk$
declare cid uuid; note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  cid := public.my_client();
  if cid is null or public.my_client_role() <> 'member' then
    raise exception 'Only a team member may flag their own work.' using errcode = 'insufficient_privilege';
  end if;
  if length(note) > 500 then
    raise exception 'Keep it under 500 characters.' using errcode = 'check_violation';
  end if;
  update public.tasks
     set blocked = note is not null,
         client_visible_blocker = note
   where id = p_task_id and client_id = cid and assignee_id = auth.uid();
  if not found then
    raise exception 'That task is not assigned to you.' using errcode = 'no_data_found';
  end if;
  return true;
end $blk$;

-- 4 ── end-of-day reports ──────────────────────────────────────────────────
create table if not exists public.client_staff_reports (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  owner_id  uuid not null references auth.users (id) on delete cascade,
  -- The member's own working day, from their browser (0027's reasoning).
  work_date date not null,
  done    text not null default '',
  blocked text not null default '',
  next    text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, work_date)
);
alter table public.client_staff_reports enable row level security;
-- No policies: read through client_team_reports, written through client_submit_report.

create or replace view public.client_team_reports as
select
  r.id,
  r.work_date,
  r.done,
  r.blocked,
  r.next,
  r.created_at,
  r.updated_at,
  r.owner_id = auth.uid() as is_you,
  case when public.my_client_role() = 'primary' then u.email end as email
from public.client_staff_reports r
join auth.users u on u.id = r.owner_id
where r.client_id = public.my_client()
  and (public.my_client_role() = 'primary' or r.owner_id = auth.uid());

grant select on public.client_team_reports to authenticated;

create or replace function public.client_submit_report(
  p_work_date date, p_done text, p_blocked text default '', p_next text default ''
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $rep$
declare cid uuid; rid uuid;
begin
  cid := public.my_client();
  if cid is null or public.my_client_role() <> 'member' then
    raise exception 'Only a team member may send a daily report.' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(btrim(p_done), '') = '' then
    raise exception 'Say what you got done.' using errcode = 'check_violation';
  end if;
  -- A day's report, not a diary: yesterday or today (either side of midnight), and not the future.
  if p_work_date is null or p_work_date < current_date - 2 or p_work_date > current_date + 1 then
    raise exception 'A report is for today or yesterday.' using errcode = 'check_violation';
  end if;
  if length(p_done) > 4000 or length(coalesce(p_blocked, '')) > 4000 or length(coalesce(p_next, '')) > 4000 then
    raise exception 'That report is too long.' using errcode = 'check_violation';
  end if;

  insert into public.client_staff_reports (client_id, owner_id, work_date, done, blocked, next)
  values (cid, auth.uid(), p_work_date, btrim(p_done), btrim(coalesce(p_blocked, '')), btrim(coalesce(p_next, '')))
  on conflict (owner_id, work_date) do update
    set done = excluded.done, blocked = excluded.blocked, next = excluded.next, updated_at = now()
  returning id into rid;
  return rid;
end $rep$;

-- 5 ── client <-> staff messages ───────────────────────────────────────────
create table if not exists public.client_team_messages (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  -- Whose thread: one per staff member, with the client.
  member_id uuid not null references auth.users (id) on delete cascade,
  sender_id uuid not null references auth.users (id) on delete cascade,
  body text not null check (length(btrim(body)) between 1 and 4000),
  sent_at timestamptz not null default now()
);
create index if not exists client_team_messages_thread on public.client_team_messages (client_id, member_id, sent_at desc);
alter table public.client_team_messages enable row level security;
-- No policies: read through client_team_chat, written through client_team_send.

create or replace view public.client_team_chat as
select
  m.id,
  m.body,
  m.sent_at,
  m.sender_id = auth.uid() as mine,
  -- The thread's staff member, named for the primary only.
  case when public.my_client_role() = 'primary' then u.email end as member_email
from public.client_team_messages m
join auth.users u on u.id = m.member_id
where m.client_id = public.my_client()
  and (public.my_client_role() = 'primary' or m.member_id = auth.uid());

grant select on public.client_team_chat to authenticated;

/* A member always writes into their own thread. The primary names the staff
   member by email, resolved against THIS account's members only. */
create or replace function public.client_team_send(p_body text, p_member_email text default null)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $send$
declare cid uuid; r text; target uuid; mid uuid;
begin
  cid := public.my_client();
  r := public.my_client_role();
  if cid is null or r not in ('primary', 'member') then
    raise exception 'Only the account owner and their staff use these messages.' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(btrim(p_body), '') = '' then
    raise exception 'Write a message first.' using errcode = 'check_violation';
  end if;

  if r = 'member' then
    target := auth.uid();
  else
    select cu.user_id into target
    from public.client_users cu join auth.users u on u.id = cu.user_id
    where cu.client_id = cid and cu.role = 'member' and lower(u.email) = lower(btrim(coalesce(p_member_email, '')))
    limit 1;
    if target is null then
      raise exception 'Nobody on your team uses that address.' using errcode = 'no_data_found';
    end if;
  end if;

  insert into public.client_team_messages (client_id, member_id, sender_id, body)
  values (cid, target, auth.uid(), btrim(p_body))
  returning id into mid;
  return mid;
end $send$;

-- grants ────────────────────────────────────────────────────────────────────
revoke execute on function public.client_member_set_blocker(uuid, text)          from public, anon;
revoke execute on function public.client_submit_report(date, text, text, text)   from public, anon;
revoke execute on function public.client_team_send(text, text)                   from public, anon;
grant  execute on function public.client_member_set_blocker(uuid, text)          to authenticated;
grant  execute on function public.client_submit_report(date, text, text, text)   to authenticated;
grant  execute on function public.client_team_send(text, text)                   to authenticated;
