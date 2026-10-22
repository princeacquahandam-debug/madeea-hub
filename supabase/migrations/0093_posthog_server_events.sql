-- 0093: PostHog business events, sent by the database (tracking plan, Oct 2026).
--
-- TO TURN IT ON, run once in the SQL editor with the project's public token:
--
--   update analytics_settings set posthog_token = 'phc_...', enabled = true;
--
-- WHY THE DATABASE SENDS THEM. The app has no backend of its own: the browser
-- writes straight to these tables under RLS. An event the browser sends can be
-- lost (ad blocker, closed tab) or made up (anyone can POST to PostHog). A row
-- that was actually written is neither, so the events that measure the business
-- (a task created, a shift clocked, an EOD sent) fire from AFTER triggers here,
-- through pg_net. pg_net queues the request and sends it only once the
-- transaction commits, so a rolled-back save sends nothing.
--
-- WHAT IS SENT. IDs, counts, yes/no and short fixed categories. Never a name,
-- an email, a task title, message text or note text. distinct_id is the auth
-- user id. Every event carries the person's role and workspace (`organization`,
-- also as the PostHog group).
--
-- CONSENT. profiles.analytics_consent: null = not asked yet, 'yes' or 'no'. The
-- browser asks and writes it (the "own profile" policy from 0001 is FOR ALL on
-- id = auth.uid(), so a person can already update their own row; no column
-- grants on profiles restrict it). Nothing is sent for anyone but 'yes'.
--
-- NEVER IN THE WAY. ph_capture swallows every error. Analytics failing must not
-- stop a task from saving. Each trigger does the same around its own work.
--
-- Idempotent: safe to run more than once.

-- ── 0. pg_net ─────────────────────────────────────────────────────────────
-- Supabase ships pg_net (its functions live in schema `net`). The DO block only
-- exists so this file also runs on a local Postgres without it, where the
-- test harness stubs net.http_post instead.
do $pgnet$
begin
  create extension if not exists pg_net with schema extensions;
exception when others then
  raise notice 'pg_net not available here (%); server analytics will not send.', sqlerrm;
end $pgnet$;

-- ── 1. Consent ────────────────────────────────────────────────────────────
alter table public.profiles add column if not exists analytics_consent text;

do $c$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_analytics_consent_check') then
    alter table public.profiles add constraint profiles_analytics_consent_check
      check (analytics_consent is null or analytics_consent in ('yes', 'no'));
  end if;
end $c$;

comment on column public.profiles.analytics_consent is
  'Product analytics consent. NULL = not asked yet, ''yes'' or ''no''. Server-side PostHog events (0093) and the AI edge functions send only for ''yes''.';

-- ── 2. Settings (one row) ─────────────────────────────────────────────────
create table if not exists public.analytics_settings (
  id boolean primary key default true check (id),
  posthog_token text,
  posthog_host text not null default 'https://eu.i.posthog.com'
    check (posthog_host ~ '^https://'),
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

insert into public.analytics_settings (id) values (true) on conflict (id) do nothing;

alter table public.analytics_settings enable row level security;

-- Admins only. The token is public by design (it ships in the browser too),
-- but where events go is an admin decision. No insert or delete: one row.
revoke all on public.analytics_settings from anon;
revoke insert, delete, truncate on public.analytics_settings from authenticated;
grant select, update on public.analytics_settings to authenticated;

drop policy if exists "analytics settings admin read" on public.analytics_settings;
create policy "analytics settings admin read" on public.analytics_settings
  for select to authenticated using (is_admin());

drop policy if exists "analytics settings admin update" on public.analytics_settings;
create policy "analytics settings admin update" on public.analytics_settings
  for update to authenticated using (is_admin()) with check (is_admin());

create or replace function public.analytics_settings_touch()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists analytics_settings_touch on public.analytics_settings;
create trigger analytics_settings_touch
  before update on public.analytics_settings
  for each row execute function public.analytics_settings_touch();

-- ── 3. The one sender ─────────────────────────────────────────────────────
create or replace function public.ph_capture(p_user uuid, p_event text, p_props jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_token text;
  v_host  text;
  v_on    boolean;
  v_ws    uuid;
  v_role  text;
begin
  if p_user is null or p_event is null then
    return;
  end if;

  select posthog_token, posthog_host, enabled into v_token, v_host, v_on
    from public.analytics_settings where id;
  if not coalesce(v_on, false) or coalesce(btrim(v_token), '') = '' then
    return;
  end if;

  if not exists (select 1 from public.profiles where id = p_user and analytics_consent = 'yes') then
    return;
  end if;

  select m.workspace_id, m.role::text into v_ws, v_role
    from public.memberships m
   where m.user_id = p_user
   order by m.created_at asc
   limit 1;

  perform net.http_post(
    url := rtrim(v_host, '/') || '/i/v0/e/',
    body := jsonb_build_object(
      'api_key', v_token,
      'event', p_event,
      'distinct_id', p_user::text,
      'timestamp', to_jsonb(now()),
      'properties',
        coalesce(p_props, '{}'::jsonb)
        || jsonb_build_object('role', v_role, 'organization', v_ws, '$lib', 'madeea-db')
        || case when v_ws is null then '{}'::jsonb
                else jsonb_build_object('$groups', jsonb_build_object('organization', v_ws)) end
    ),
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 3000
  );
exception when others then
  -- Never into the caller's transaction. The save matters; the event does not.
  return;
end $$;

-- Only the triggers below call it (they are SECURITY DEFINER, so they run as
-- the owner). Nobody can call it over the API to invent events.
revoke all on function public.ph_capture(uuid, text, jsonb) from public;
revoke all on function public.ph_capture(uuid, text, jsonb) from anon, authenticated;

-- ── 4. Tasks ──────────────────────────────────────────────────────────────
-- task_created: where it came from, not what it says.
-- task_stage_changed: the raw status values (todo, in_progress, follow_up =
-- "waiting", review, done). days_in_stage is measured from the task's previous
-- updated_at, i.e. its last edit, which is the closest thing to "entered this
-- stage" the table records.
create or replace function public.ph_tasks_event()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  begin
    if tg_op = 'INSERT' then
      -- restore_task (0090) re-inserts a deleted task; that is not a new one.
      if coalesce(current_setting('madeea.restoring', true), '') = 'on' then
        perform public.ph_capture(coalesce(auth.uid(), new.owner_id), 'task_restored',
          jsonb_build_object('task_id', new.id));
        return null;
      end if;
      perform public.ph_capture(coalesce(auth.uid(), new.owner_id), 'task_created', jsonb_build_object(
        'task_id', new.id,
        'source', case
          when new.routine_id is not null then 'routine'
          when new.source_meeting_id is not null then 'meeting'
          when new.requested_by_client then 'client'
          else 'app' end,
        'priority', new.priority::text,
        'has_due_date', new.due_at is not null,
        'has_client', new.client_id is not null,
        'is_assigned', new.assignee_id is not null and new.assignee_id <> new.owner_id
      ));
    elsif new.status is distinct from old.status then
      perform public.ph_capture(coalesce(auth.uid(), new.owner_id), 'task_stage_changed', jsonb_build_object(
        'task_id', new.id,
        'from_stage', old.status::text,
        'to_stage', new.status::text,
        'days_in_stage', greatest(0, floor(extract(epoch from (now() - old.updated_at)) / 86400))::int,
        'is_overdue', new.due_at is not null and new.due_at < now()
      ));
    end if;
  exception when others then
    null;
  end;
  return null;
end $$;

drop trigger if exists ph_tasks_insert on public.tasks;
create trigger ph_tasks_insert
  after insert on public.tasks
  for each row execute function public.ph_tasks_event();

drop trigger if exists ph_tasks_status on public.tasks;
create trigger ph_tasks_status
  after update of status on public.tasks
  for each row when (old.status is distinct from new.status)
  execute function public.ph_tasks_event();

-- ── 5. Shifts ─────────────────────────────────────────────────────────────
-- A new open session is a clock-in (is_resume when the person's previous
-- session ended with Pause). A session closing is a pause or a clock-out.
-- Clocking out while paused (0088) closes nothing new: it turns `paused` off
-- on the already-closed session, and is reported as a clock-out too.
-- duration_s is the length of that one session.
create or replace function public.ph_time_entries_event()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid;
  v_prev_paused boolean;
begin
  begin
    v_actor := coalesce(auth.uid(), new.owner_id);
    if tg_op = 'INSERT' then
      if new.ended_at is not null then
        return null;  -- an admin adding past time, not a clock-in
      end if;
      select t.paused into v_prev_paused
        from public.time_entries t
       where t.owner_id = new.owner_id and t.id <> new.id and t.ended_at is not null
       order by t.ended_at desc
       limit 1;
      perform public.ph_capture(v_actor, 'shift_clocked_in', jsonb_build_object(
        'entry_id', new.id,
        'client_id', new.client_id,
        'has_focus', coalesce(btrim(new.focus), '') <> '',
        'is_resume', coalesce(v_prev_paused, false)
      ));
    elsif old.ended_at is null and new.ended_at is not null then
      if new.paused then
        perform public.ph_capture(v_actor, 'shift_paused', jsonb_build_object(
          'entry_id', new.id,
          'client_id', new.client_id,
          'duration_s', greatest(0, extract(epoch from (new.ended_at - new.started_at)))::int
        ));
      else
        perform public.ph_capture(v_actor, 'shift_clocked_out', jsonb_build_object(
          'entry_id', new.id,
          'client_id', new.client_id,
          'duration_s', greatest(0, extract(epoch from (new.ended_at - new.started_at)))::int,
          'has_note', coalesce(btrim(new.note), '') <> '',
          'has_early_reason', coalesce(btrim(new.early_reason), '') <> '',
          'eod_skipped', coalesce(btrim(new.eod_skipped_reason), '') <> '',
          'while_paused', false
        ));
      end if;
    elsif old.ended_at is not null and old.paused and not new.paused then
      perform public.ph_capture(v_actor, 'shift_clocked_out', jsonb_build_object(
        'entry_id', new.id,
        'client_id', new.client_id,
        'duration_s', greatest(0, extract(epoch from (new.ended_at - new.started_at)))::int,
        'has_note', coalesce(btrim(new.note), '') <> '',
        'has_early_reason', coalesce(btrim(new.early_reason), '') <> '',
        'eod_skipped', coalesce(btrim(new.eod_skipped_reason), '') <> '',
        'while_paused', true
      ));
    end if;
  exception when others then
    null;
  end;
  return null;
end $$;

drop trigger if exists ph_time_entries_insert on public.time_entries;
create trigger ph_time_entries_insert
  after insert on public.time_entries
  for each row execute function public.ph_time_entries_event();

drop trigger if exists ph_time_entries_update on public.time_entries;
create trigger ph_time_entries_update
  after update on public.time_entries
  for each row
  when ((old.ended_at is null and new.ended_at is not null) or (old.paused and not new.paused))
  execute function public.ph_time_entries_event();

-- ── 6. EOD reports ────────────────────────────────────────────────────────
-- The app submits with an upsert, so a re-submission is an UPDATE. Only the
-- person's own write counts as a submission: an admin correcting a report, or
-- a service-role import, is not one. Imported rows never count.
create or replace function public.ph_eod_event()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ended timestamptz;
begin
  begin
    if new.imported or new.owner_id is null then
      return null;
    end if;
    if tg_op = 'UPDATE' and auth.uid() is distinct from new.owner_id then
      return null;
    end if;
    select max(t.ended_at) into v_ended
      from public.time_entries t
     where t.owner_id = new.owner_id and t.work_date = new.report_date and t.ended_at is not null;
    perform public.ph_capture(new.owner_id, 'eod_report_submitted', jsonb_build_object(
      'report_id', new.id,
      'report_date', new.report_date,
      'completed_count', coalesce(cardinality(new.done), 0),
      'blockers_count', coalesce(cardinality(new.blockers), 0),
      'plan_count', coalesce(cardinality(new.plans), 0),
      'has_notes', coalesce(btrim(new.notes), '') <> '',
      'is_update', tg_op = 'UPDATE',
      'minutes_after_shift_end',
        case when v_ended is null then null
             else floor(extract(epoch from (now() - v_ended)) / 60)::int end
    ));
  exception when others then
    null;
  end;
  return null;
end $$;

drop trigger if exists ph_eod_submitted on public.eod_reports;
create trigger ph_eod_submitted
  after insert or update on public.eod_reports
  for each row execute function public.ph_eod_event();

-- ── 7. Outbound messages ──────────────────────────────────────────────────
-- The *-send functions write the sent message as the caller. Rows written by
-- the service role (the n8n Gmail import of mail sent elsewhere) are skipped:
-- auth.uid() is null there, and that mail was not sent from the Hub.
create or replace function public.ph_messages_event()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  begin
    if new.direction = 'outbound' and auth.uid() is not null then
      perform public.ph_capture(new.owner_id, 'message_sent', jsonb_build_object(
        'message_id', new.id,
        'channel', new.source,
        'is_reply', new.thread_id is not null or new.reply_target is not null,
        'has_client', new.client_id is not null
      ));
    end if;
  exception when others then
    null;
  end;
  return null;
end $$;

drop trigger if exists ph_messages_sent on public.messages;
create trigger ph_messages_sent
  after insert on public.messages
  for each row when (new.direction = 'outbound')
  execute function public.ph_messages_event();

-- ── 8. Connections ────────────────────────────────────────────────────────
-- The OAuth callbacks upsert one row per person, so a first connection is an
-- INSERT and adding a permission later is an UPDATE of scopes. Each event fires
-- for a permission the row did not have before, so reconnecting with the same
-- permissions sends nothing.
do $conn$
begin
  if to_regclass('public.google_credentials') is not null then
    execute $f$
      create or replace function public.ph_google_credentials_event()
      returns trigger language plpgsql security definer set search_path = public, pg_temp as $b$
      declare
        v_old text := case when tg_op = 'UPDATE' then coalesce(old.scopes, '') else '' end;
        v_new text := coalesce(new.scopes, '');
        v_gmail boolean := v_new ~* 'gmail';
        v_cal boolean := v_new ~* 'calendar';
      begin
        begin
          if v_gmail and v_old !~* 'gmail' then
            perform public.ph_capture(new.owner_id, 'gmail_connected',
              jsonb_build_object('provider', 'google', 'has_calendar', v_cal));
          end if;
          if v_cal and v_old !~* 'calendar' then
            perform public.ph_capture(new.owner_id, 'calendar_connected',
              jsonb_build_object('provider', 'google', 'has_gmail', v_gmail));
          end if;
          if tg_op = 'INSERT' and not v_gmail and not v_cal then
            perform public.ph_capture(new.owner_id, 'google_connected',
              jsonb_build_object('has_gmail', false, 'has_calendar', false));
          end if;
        exception when others then
          null;
        end;
        return null;
      end $b$
    $f$;
    execute 'drop trigger if exists ph_google_connected on public.google_credentials';
    execute 'create trigger ph_google_connected after insert or update of scopes on public.google_credentials
               for each row execute function public.ph_google_credentials_event()';
  end if;

  if to_regclass('public.microsoft_credentials') is not null then
    execute $f$
      create or replace function public.ph_microsoft_credentials_event()
      returns trigger language plpgsql security definer set search_path = public, pg_temp as $b$
      declare
        v_old text := case when tg_op = 'UPDATE' then coalesce(old.scopes, '') else '' end;
        v_new text := coalesce(new.scopes, '');
        v_mail boolean := v_new ~* '(^|[\s/])mail\.';
        v_cal boolean := v_new ~* 'calendars\.';
        v_teams boolean := v_new ~* '(chat|channelmessage)\.';
      begin
        begin
          if v_mail and v_old !~* '(^|[\s/])mail\.' then
            perform public.ph_capture(new.owner_id, 'outlook_connected',
              jsonb_build_object('provider', 'microsoft', 'has_calendar', v_cal, 'has_teams', v_teams));
          end if;
          if v_cal and v_old !~* 'calendars\.' then
            perform public.ph_capture(new.owner_id, 'calendar_connected',
              jsonb_build_object('provider', 'microsoft', 'has_mail', v_mail));
          end if;
          if tg_op = 'INSERT' and not v_mail and not v_cal then
            perform public.ph_capture(new.owner_id, 'microsoft_connected',
              jsonb_build_object('has_teams', v_teams));
          end if;
        exception when others then
          null;
        end;
        return null;
      end $b$
    $f$;
    execute 'drop trigger if exists ph_microsoft_connected on public.microsoft_credentials';
    execute 'create trigger ph_microsoft_connected after insert or update of scopes on public.microsoft_credentials
               for each row execute function public.ph_microsoft_credentials_event()';
  end if;
end $conn$;

-- ── 9. Notes ──────────────────────────────────────────────────────────────
-- The Notes area (0019). Length as a bucket only; the text never leaves.
create or replace function public.ph_notes_event()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_len int;
begin
  begin
    v_len := length(coalesce(new.body, ''));
    perform public.ph_capture(coalesce(auth.uid(), new.owner_id), 'quick_note_created', jsonb_build_object(
      'note_id', new.id,
      'has_client', new.client_id is not null,
      'length_bucket', case when v_len < 80 then 'short' when v_len < 400 then 'medium' else 'long' end
    ));
  exception when others then
    null;
  end;
  return null;
end $$;

do $n$
begin
  if to_regclass('public.notes') is not null then
    execute 'drop trigger if exists ph_notes_created on public.notes';
    execute 'create trigger ph_notes_created after insert on public.notes
               for each row execute function public.ph_notes_event()';
  end if;
end $n$;

-- Trigger functions are not meant to be called directly.
revoke all on function public.ph_tasks_event() from public, anon, authenticated;
revoke all on function public.ph_time_entries_event() from public, anon, authenticated;
revoke all on function public.ph_eod_event() from public, anon, authenticated;
revoke all on function public.ph_messages_event() from public, anon, authenticated;
revoke all on function public.ph_notes_event() from public, anon, authenticated;
