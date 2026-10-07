-- A client connects their own Google Calendar (client portal, Phase 1).
--
-- Their events are written by calendar-sync with the service role, tagged
-- source = 'gcal-client', owner_id = the client's login, client_id = their
-- client, workspace_id = the client's workspace. Three things follow:
--
-- 1. WHO ON THE TEAM SEES THEM: the client's lead EA, and admins. Not the
--    whole team. Meetings have been readable by every member ("ws shared",
--    0012); a client's own calendar holds their private life too, so these
--    rows narrow to the people accountable for that client. Agreed with
--    MadeEA on 7 Oct 2026 ("Lead EA only").
--    The client themselves reads them through client_calendar (0073), which
--    already filters on client_id = my_client().
--
-- 2. THE CLIENT CAN SEE AND REMOVE THEIR OWN CONNECTION. integrations was
--    readable only within a workspace membership (0058), which a client
--    never has.
--
-- 3. DISCONNECT MEANS GONE. client_disconnect_google() removes the token and
--    every event it brought in, so "disconnected" is true for the EA as well.
--
-- Safe to run twice.

-- 1 ── meetings: client calendar events are for the lead EA and admins ──────
drop policy if exists "ws shared" on public.meetings;
create policy "ws shared" on public.meetings for all
  using (
    workspace_id = my_workspace()
    and (
      source is distinct from 'gcal-client'
      or is_admin()
      or exists (select 1 from public.clients c
                  where c.id = meetings.client_id and c.lead_ea_id = auth.uid())
    )
  )
  -- Staff never write a client's calendar rows; only the sync (service role) does.
  with check (workspace_id = my_workspace() and source is distinct from 'gcal-client');

-- 2 ── integrations: a client reads and removes their own ───────────────────
drop policy if exists "client reads own integrations" on public.integrations;
create policy "client reads own integrations" on public.integrations for select to authenticated
  using (user_id = auth.uid() and my_client() is not null);

drop policy if exists "client disconnects own integrations" on public.integrations;
create policy "client disconnects own integrations" on public.integrations for delete to authenticated
  using (user_id = auth.uid() and my_client() is not null);

-- 3 ── disconnect, completely ───────────────────────────────────────────────
create or replace function public.client_disconnect_google()
returns void
language plpgsql security definer set search_path = public, pg_temp as $disc$
declare uid uuid := auth.uid();
begin
  if uid is null or my_client() is null then
    raise exception 'Only a client account can use this.' using errcode = 'insufficient_privilege';
  end if;
  delete from public.meetings where owner_id = uid and source = 'gcal-client';
  delete from public.integrations where user_id = uid and provider = 'google';
  delete from public.google_credentials where owner_id = uid;
end $disc$;

revoke all on function public.client_disconnect_google() from public;
grant execute on function public.client_disconnect_google() to authenticated;
