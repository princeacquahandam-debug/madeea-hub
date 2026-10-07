-- A client connects their own Outlook / Microsoft 365 calendar (client portal,
-- Phase 3). The same arrangement as their Google Calendar (0083), for the
-- other half of the world's calendars. Teams meetings are Outlook calendar
-- events, so they arrive this way too, with their Join link.
--
-- outlook-calendar-sync writes these with the service role, tagged
-- source = 'outlook-client', owner_id = the client's login, client_id = their
-- client, workspace_id = the client's workspace.
--
-- 1. WHO ON THE TEAM SEES THEM: exactly as 0083. The client's lead EA and
--    admins; not the whole team. The policy now names both client sources.
-- 2. DISCONNECT MEANS GONE: client_disconnect_microsoft() removes the token
--    and every event it brought in.
--
-- Safe to run twice.

-- 1 ── meetings: client calendar events (Google or Outlook) ────────────────
drop policy if exists "ws shared" on public.meetings;
create policy "ws shared" on public.meetings for all
  using (
    workspace_id = my_workspace()
    and (
      coalesce(source, '') not in ('gcal-client', 'outlook-client')
      or is_admin()
      or exists (select 1 from public.clients c
                  where c.id = meetings.client_id and c.lead_ea_id = auth.uid())
    )
  )
  -- Staff never write a client's calendar rows; only the sync (service role) does.
  with check (workspace_id = my_workspace() and coalesce(source, '') not in ('gcal-client', 'outlook-client'));

-- 2 ── disconnect, completely ───────────────────────────────────────────────
create or replace function public.client_disconnect_microsoft()
returns void
language plpgsql security definer set search_path = public, pg_temp as $disc$
declare uid uuid := auth.uid();
begin
  if uid is null or my_client() is null then
    raise exception 'Only a client account can use this.' using errcode = 'insufficient_privilege';
  end if;
  delete from public.meetings where owner_id = uid and source = 'outlook-client';
  delete from public.integrations where user_id = uid and provider = 'microsoft';
  delete from public.microsoft_credentials where owner_id = uid;
end $disc$;

revoke all on function public.client_disconnect_microsoft() from public;
grant execute on function public.client_disconnect_microsoft() to authenticated;
