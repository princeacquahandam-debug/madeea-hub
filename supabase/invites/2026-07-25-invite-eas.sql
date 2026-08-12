-- Invite EAs into the shared workspace. 2026-07-25
--   angelica.roma@madeeas.com
--   johncarlo.japitana@madeeas.com
--   rowena.petran@madeeas.com
--   reich.rellora@madeeas.com
--   fj.caballes@madeeas.com
--   laura.esteban@madeeas.com
--
-- One-off operational script, NOT a schema migration. Do not add it to the
-- migration runner (it seeds invite rows, it doesn't change structure).
--
-- Preferred path is still the app's Admin panel "Invite by email", which does
-- BOTH steps below in one call via the invite-member Edge Function. Use this file
-- only if the Admin panel or its email delivery isn't working and you're driving
-- it from the Supabase dashboard by hand.
--
-- TWO STEPS ARE REQUIRED, the SQL below is only step 1:
--
--   1. (this file) Pre-authorize the addresses in `invites`. handle_new_user reads
--      this row to decide membership; without it a signup gets NO seat (see 0016).
--   2. Supabase Dashboard -> Authentication -> Users -> "Invite user", once per
--      address. THIS is what creates the account and actually sends the email.
--
-- Run step 1 BEFORE step 2: since migration 0020, membership is granted when the
-- address is CONFIRMED (the invitee clicks the email link), and the confirm-time
-- trigger reads `invites` at that moment. If the row isn't there yet, they land
-- with no workspace.
--
-- Idempotent: `on conflict (email) do nothing` means re-running won't clobber an
-- invite that's already been accepted (which is what keeps an existing member in
-- the workspace).

insert into invites (email, workspace_id, role, expires_at, accepted_at)
values
  ('angelica.roma@madeeas.com',      (select id from workspaces order by created_at limit 1), 'ea', now() + interval '14 days', null),
  ('johncarlo.japitana@madeeas.com', (select id from workspaces order by created_at limit 1), 'ea', now() + interval '14 days', null),
  ('rowena.petran@madeeas.com',      (select id from workspaces order by created_at limit 1), 'ea', now() + interval '14 days', null),
  ('reich.rellora@madeeas.com',      (select id from workspaces order by created_at limit 1), 'ea', now() + interval '14 days', null),
  ('fj.caballes@madeeas.com',        (select id from workspaces order by created_at limit 1), 'ea', now() + interval '14 days', null),
  ('laura.esteban@madeeas.com',      (select id from workspaces order by created_at limit 1), 'ea', now() + interval '14 days', null)
on conflict (email) do nothing;

-- Verify the rows landed and are pointed at the right workspace:
--   select email, workspace_id, role, accepted_at, expires_at from invites
--   where email in (
--     'angelica.roma@madeeas.com', 'johncarlo.japitana@madeeas.com',
--     'rowena.petran@madeeas.com', 'reich.rellora@madeeas.com',
--     'fj.caballes@madeeas.com', 'laura.esteban@madeeas.com'
--   );
