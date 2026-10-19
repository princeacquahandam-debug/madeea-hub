-- Pausing the time tracker (19 Oct 2026, client request).
--
-- A pause is the running session closing with `paused = true`; Resume opens a
-- new session for the same client. Paused time is simply not in any session,
-- so it never counts toward attendance or payroll, and screen capture (which
-- belongs to a running session) stops with it.
--
-- The one new permission: clocking out while paused. The paused session is
-- already finished, and 0041's guard refuses any edit to a finished session.
-- This allows exactly one: turning `paused` off, with the clock-out notes
-- (early_reason, eod_skipped_reason). Times, owner, client, task, note and day
-- stay locked, so nothing about the hours worked can move.
--
-- Safe to run twice.

alter table public.time_entries
  add column if not exists paused boolean not null default false;

comment on column public.time_entries.paused is
  'True when this session ended with Pause rather than Clock out; the shift resumes with a new session. Cleared on clock-out.';

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
    if new.paused then
      raise exception 'A session cannot start paused.';
    end if;
    return new;
  end if;

  -- UPDATE from here down.
  if old.ended_at is not null then
    /* Clocking out while paused (0088): only `paused` goes off, plus the
       clock-out notes. Every column that says when, who or what is unchanged. */
    if old.paused and not new.paused
       and new.started_at is not distinct from old.started_at
       and new.ended_at   is not distinct from old.ended_at
       and new.owner_id   is not distinct from old.owner_id
       and new.work_date  is not distinct from old.work_date
       and new.client_id  is not distinct from old.client_id
       and new.task_id    is not distinct from old.task_id
       and new.note       is not distinct from old.note then
      return new;
    end if;
    raise exception 'A finished session cannot be edited. Ask an admin for a correction.';
  end if;
  if new.started_at is distinct from old.started_at then
    raise exception 'The start of a session cannot be changed.';
  end if;
  if new.owner_id is distinct from old.owner_id then
    raise exception 'A session cannot be reassigned.';
  end if;
  if new.paused and new.ended_at is null then
    raise exception 'Only a session that is ending can be paused.';
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
