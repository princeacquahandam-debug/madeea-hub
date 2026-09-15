-- The rest of what a client may see, decided on the 14 Sep call.
--
-- 0072 built three views and stopped at two questions it could not answer
-- without a product decision. Both were taken on the call:
--
--   EOD reports   The client tracks their assistant's progress. But eod_reports
--                 still has no client_id, and 0072's objection stands: one
--                 report per person per day covers every client that assistant
--                 touched. So the client does NOT read the EOD. They read a
--                 digest computed from the two things already tagged by client
--                 -- tasks and time_entries. Nothing crosses accounts, because
--                 nothing untagged is ever read. Per-line EOD tagging remains
--                 the eventual answer; this is not it, and does not pretend to
--                 be.
--
--   Screenshots   "ang client, ang nakikita niya lang po is yung screenshot."
--                 The call's intent was proof that the assistant was at the
--                 desk. The pictures themselves cannot deliver that safely --
--                 0065: "No row-level rule reaches a picture", and a capture
--                 taken on this client's time can still show another client's
--                 inbox. So the client reads the SHAPE of the session: when it
--                 started, when it ended, how long, and how many captures are
--                 held on file. Same accountability, no image published.
--                 client_days lists its columns by name and storage_path is
--                 not among them, so no later change publishes one by accident.
--
-- Also here, from the same call: the calendar reflected to the client (Rowena,
-- 0:18) and notes running both ways between client and assistant (19:18).
--
-- Every view follows 0072's rule and none of it is restated here: columns by
-- name, never `select *`; the view runs as its owner so the WHERE clause is the
-- access rule; my_client() is NULL for staff, so a member reading these sees
-- nothing rather than everything.

-- ---------------------------------------------------------------------------
-- 1. Notes gain a side, and a door.
-- ---------------------------------------------------------------------------
--
-- notes.client_id already exists, and it does NOT mean "the client may read
-- this". It means "this note is about them" -- an assistant's working notes on
-- an account are the overwhelming majority of those rows. Publishing them on
-- the strength of client_id alone would hand a client every private line their
-- assistant ever wrote about them.
--
-- So sharing is its own column, it defaults to false, and every note that
-- exists today stays private on the day this applies.

alter table public.notes
  add column if not exists shared_with_client boolean not null default false,
  -- Which side wrote it. Without this the portal cannot draw a conversation:
  -- owner_id is an auth user either way, and a client cannot read profiles to
  -- find out whose it is.
  add column if not exists author_is_client   boolean not null default false;

comment on column public.notes.shared_with_client is
  'The assistant has deliberately shared this note with the client. Default false: notes.client_id means the note is ABOUT a client, not readable BY them.';

comment on column public.notes.author_is_client is
  'True when the note came from client_create_note. Lets both sides tell who wrote it without reading profiles.';

create index if not exists notes_client_shared_idx
  on public.notes (client_id, updated_at desc) where shared_with_client;

-- ---------------------------------------------------------------------------
-- 2. The working day, as the client may see it.
-- ---------------------------------------------------------------------------
--
-- This replaces client_hours, which had work_date, minutes and sessions and is
-- a strict subset of what follows. Two overlapping views of the same rows is
-- how the two drift apart.
--
-- WHY THE CAPTURE COUNT IS JOINED AND NOT SELECTED INLINE. Joining screenshots
-- to entries multiplies the entry rows by the number of captures, and the
-- duration sum multiplies with them: a four-hour session with 24 captures
-- reports 96 hours. The counts are aggregated separately and joined on the day.

drop view if exists public.client_hours;

create view public.client_days as
select
  d.work_date,
  d.minutes,
  d.sessions,
  d.first_started_at,
  d.last_ended_at,
  d.running,
  coalesce(c.captures, 0)::int as captures
from (
  select
    te.work_date,
    /* A running entry counts up to now -- 0072's reasoning, unchanged: showing
       nothing until the assistant clocks out reads as "nobody worked today"
       for most of the working day. */
    (sum(extract(epoch from (coalesce(te.ended_at, now()) - te.started_at))) / 60)::bigint as minutes,
    count(*)::int                as sessions,
    min(te.started_at)           as first_started_at,
    -- Null while a session is still open, which is the honest answer to "when
    -- did they finish" rather than a max() over the entries that have closed.
    max(te.ended_at)             as last_ended_at,
    bool_or(te.ended_at is null) as running
  from public.time_entries te
  where te.client_id = public.my_client()
  group by te.work_date
) d
left join (
  select te.work_date, count(s.id) as captures
  from public.time_screenshots s
  join public.time_entries te on te.id = s.time_entry_id
  where te.client_id = public.my_client()
  group by te.work_date
) c on c.work_date = d.work_date;

comment on view public.client_days is
  'One row per working day on this client: hours, session bounds, and how many captures are held. storage_path is deliberately absent, so the client reads that a capture exists and never the picture itself.';

-- ---------------------------------------------------------------------------
-- 3. Their calendar.
-- ---------------------------------------------------------------------------
--
-- WHAT IS LEFT OUT, and why each one would be a leak:
--
--   attendee_emails   other people's addresses, frequently from other accounts
--   organizer_email   whose calendar this really is
--   description       agenda notes written for the agency, not the client
--   html_link         a Google event page the client has no permission to open,
--                     so it fails for them and discloses the calendar it is on
--   calendar_id       which of the assistant's calendars this came from
--   response_status   the assistant's own answer to an invitation
--
-- hangout_link stays: it is the room for a meeting on their own account, and a
-- client who cannot join their own call is being shown a calendar for nothing.

create view public.client_calendar as
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
  and m.starts_at is not null;

comment on view public.client_calendar is
  'Meetings booked against this client. Attendees, description, organiser and the Google event link are withheld. The Meet room is published, because it is a call on the account the client owns.';

-- ---------------------------------------------------------------------------
-- 4. The shared notes, both directions.
-- ---------------------------------------------------------------------------

create view public.client_notes as
select
  n.id,
  n.title,
  n.body,
  n.author_is_client,
  n.created_at,
  n.updated_at
from public.notes n
where n.client_id = public.my_client()
  and n.shared_with_client;

comment on view public.client_notes is
  'Notes on this account that the assistant has shared, plus the ones the client wrote. notes.pinned is absent: it is how the assistant organises their own list.';

grant select on public.client_days     to authenticated;
grant select on public.client_calendar to authenticated;
grant select on public.client_notes    to authenticated;

-- ---------------------------------------------------------------------------
-- 5. The second thing a client may write.
-- ---------------------------------------------------------------------------
--
-- Same shape as client_create_task and for the same reason: an INSERT policy
-- can check the values a client sends but cannot stop them sending `pinned`,
-- an `owner_id`, or a `client_id` belonging to somebody else. Here the client
-- supplies a title and a body. Every other column is decided in this function.

create or replace function public.client_create_note(p_title text, p_body text)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $newnote$
declare cid uuid; ws uuid; note_count int; new_id uuid;
begin
  cid := public.my_client();
  if cid is null then
    raise exception 'Only a client may write a note here.' using errcode = 'insufficient_privilege';
  end if;

  if coalesce(btrim(p_body), '') = '' then
    raise exception 'A note needs something in it.' using errcode = 'check_violation';
  end if;

  select cu.workspace_id into ws from public.client_users cu where cu.user_id = auth.uid() limit 1;

  /* The same ceiling as client_create_task, for the same reason: an unbounded
     insert reachable from a browser is how a shared surface becomes a spam
     target. 200 rather than 50 because a note is a smaller act than a work
     request, and nobody's assistant has to action one. */
  select count(*) into note_count
  from public.notes
  where client_id = cid and author_is_client;

  if note_count >= 200 then
    raise exception 'That is 200 notes. Ask your assistant to clear some before adding more.'
      using errcode = 'check_violation';
  end if;

  insert into public.notes (workspace_id, client_id, title, body, shared_with_client, author_is_client)
  values (
    ws,
    cid,
    coalesce(nullif(btrim(coalesce(p_title, '')), ''), 'Note from client'),
    btrim(p_body),
    true,
    true
  )
  returning id into new_id;

  return new_id;
end $newnote$;

revoke execute on function public.client_create_note(text, text) from public, anon;
grant execute on function public.client_create_note(text, text) to authenticated;

comment on function public.client_create_note is
  'The one note a client may write. Shared and client-authored are set here rather than sent, so a client cannot write a private note into an assistant list, or pass one off as written by the assistant.';
