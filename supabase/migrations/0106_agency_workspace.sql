-- 0106_agency_workspace.sql. Name the agency's workspace instead of assuming it
-- is the only one.
--
-- Run in the Supabase SQL editor (madeea-hub project). Safe to run twice.
--
-- WHY. Two pieces of live plumbing answered "which workspace?" with "the only
-- one", and gave up when there were two:
--
--   inbound_message_owner (0050)      files incoming WhatsApp messages. With a
--                                     second workspace it returned nothing and
--                                     the webhook stopped saving messages.
--   grant_membership_fallback (0070)  seats a confirmed staff account that had
--                                     no invite. With a second workspace it did
--                                     nothing, so that person signed in to an
--                                     empty Hub.
--
-- A second workspace is now needed: a QA sandbox, so write actions (create,
-- file, send, invite) can be tested without touching the agency's data (QA
-- round 2, 20 Nov 2026). Both functions now use agency_workspace(): the oldest
-- workspace, which is the agency's (0012 merged everything into the oldest,
-- and every workspace since has been created on purpose, by hand).
--
-- Nothing else changes. With one workspace both functions behave exactly as
-- before. The fallback still never seats a client (0070) and still only acts
-- for a confirmed account with no seat; it still must be dropped if public
-- signup is ever opened.

create or replace function public.agency_workspace()
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select id from public.workspaces order by created_at asc, id asc limit 1
$$;

revoke all on function public.agency_workspace() from public, anon, authenticated;

comment on function public.agency_workspace is
  'The agency''s own workspace: the oldest one. Used where server-side plumbing (webhooks, the membership fallback) must pick a workspace with no signed-in person to ask. Other workspaces, such as the QA sandbox, are never chosen by default.';

-- ── WhatsApp: file under the agency, whatever else exists ────────────────
create or replace function public.inbound_message_owner()
returns table (workspace_id uuid, owner_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.workspace_id, m.user_id
  from public.memberships m
  where m.workspace_id = public.agency_workspace()
  order by (m.role = 'admin') desc, m.created_at asc
  limit 1
$$;

revoke all on function public.inbound_message_owner() from public, anon, authenticated;

comment on function public.inbound_message_owner is
  'Who an unauthenticated inbound message (WhatsApp webhook) is filed under: the agency workspace (0106), never a sandbox.';

-- ── Uninvited staff: seat them in the agency, whatever else exists ───────
create or replace function public.grant_membership_fallback(p_user uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $fallback$
declare ws uuid;
begin
  if exists (select 1 from public.memberships where user_id = p_user) then
    return;
  end if;

  -- 0070. A client is not a member who was missed.
  if exists (select 1 from public.client_users where user_id = p_user) then
    return;
  end if;

  ws := public.agency_workspace();
  if ws is null then
    return;
  end if;

  insert into public.memberships (workspace_id, user_id, role)
  values (ws, p_user, 'ea')
  on conflict do nothing;
end $fallback$;

revoke all on function public.grant_membership_fallback(uuid) from public, anon, authenticated;

comment on function public.grant_membership_fallback is
  'Admits a confirmed account with no invite to the agency workspace (0106), as an ordinary member. Never admits a client (0070). Remove this if public signup is ever enabled.';
