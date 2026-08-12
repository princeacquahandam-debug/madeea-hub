-- Grant rio.castillo a workspace seat. 2026-07-29
--
-- Symptom: signed in as rio.castillo, the EOD page shows "Sign in to draft and
-- submit" and hides the submit box. Cause: the account has a login but NO row in
-- `memberships`, so useWorkspaceMembers can't find "you" and the page can't
-- attribute a report to you.
--
-- Why the seat is missing: since migration 0020, membership is granted only when
-- an `invites` row is consumed at email confirmation. rio.castillo was never in
-- the invite list, so the account was created (or confirmed) with no seat.
-- Re-inviting now does nothing (confirmation already happened) so the seat is
-- inserted directly here.
--
-- CONFIRM THE EMAIL below matches the account (adjust if it isn't rio.castillo@madeeas.com).
-- Idempotent: safe to re-run.

-- 1) The actual workspace seat (this is what unblocks EOD submission).
insert into memberships (workspace_id, user_id, role)
select w.id, u.id, 'ea'
from auth.users u
cross join (select id from workspaces order by created_at limit 1) w
where lower(u.email) = 'rio.castillo@madeeas.com'
on conflict do nothing;

-- 2) Record an accepted invite too, so the account's state is consistent with the
--    normal flow (and a future re-confirm can't double-process it).
insert into invites (email, workspace_id, role, accepted_at)
select 'rio.castillo@madeeas.com', w.id, 'ea', now()
from (select id from workspaces order by created_at limit 1) w
on conflict (email) do update set accepted_at = coalesce(invites.accepted_at, now());

-- 3) Canonical display name, so EOD shows "Rio Castillo" (matching the roster)
--    instead of the raw "rio.castillo" and doesn't split into two identities.
update profiles p
set full_name = 'Rio Castillo'
from auth.users u
where u.id = p.id and lower(u.email) = 'rio.castillo@madeeas.com';

-- Verify:
--   select u.email, m.role, p.full_name
--   from auth.users u
--   left join memberships m on m.user_id = u.id
--   left join profiles p on p.id = u.id
--   where lower(u.email) = 'rio.castillo@madeeas.com';
