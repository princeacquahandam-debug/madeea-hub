-- Give a client a login to their portal, by hand.
--
-- STEP 2 OF 2. Step 1 happens in the dashboard, and the ORDER MATTERS -- see
-- the warning below before doing anything.
--
--   1. Supabase dashboard -> Authentication -> Users -> Add user -> Invite user.
--      Enter the client email. Do NOT auto-confirm, and do not have them click
--      the email link yet.
--   2. Come straight back here, set the two values below, and run this.
--   3. Now tell them to click the link in their email and set a password.
--
-- WHY THE ORDER IS LOAD-BEARING, from 0070: a confirmed account holding no
-- client_users row is treated as staff who forgot to be invited, and is granted
-- an employee seat in the agency workspace. my_workspace() then starts
-- returning the agency id and every workspace policy opens for them at once.
-- Writing the link BEFORE they confirm is what stops that.
--
-- If they confirm first, this script refuses rather than papering over it, and
-- the fix is to delete the membership row that was granted, then re-run.
--
-- This is the stopgap. The real answer is the invite-client Edge Function,
-- which does all of the above in a single request and cannot get the order
-- wrong. It exists and is correct; nothing in the app calls it yet.

do $$
declare
  -- ------------------------------------------------------------------ SET THESE
  v_email       text := 'client@example.com';   -- the address invited in step 1
  v_client_name text := 'Breakaway Hoops';      -- must match clients.name exactly
  -- ---------------------------------------------------------------------------
  v_user uuid;
  v_client uuid;
  v_ws uuid;
  v_existing uuid;
  v_names text;
begin
  select id into v_user from auth.users where lower(email) = lower(btrim(v_email)) limit 1;
  if v_user is null then
    raise exception 'No auth user for %. Do step 1 in the dashboard first.', v_email;
  end if;

  -- Case-insensitive and trimmed, and the failure lists what is actually there.
  select id, workspace_id into v_client, v_ws
  from public.clients
  where lower(btrim(name)) = lower(btrim(v_client_name))
  limit 1;

  if v_client is null then
    select string_agg(name, ', ' order by name) into v_names from public.clients;
    raise exception
      'No client named "%". Clients on this workspace: %', v_client_name, coalesce(v_names, '(none yet -- create one in the Client Vault first)');
  end if;

  -- The check that matters. A member cannot also be a client: 0070 refuses the
  -- combination, and a client who slipped into a staff seat can read the whole
  -- workspace until the seat is removed.
  if exists (select 1 from public.memberships where user_id = v_user) then
    raise exception
      'That account already holds a STAFF membership. It confirmed before being linked, or it belongs to a team member. Remove the membership row first if this is really a client.';
  end if;

  select client_id into v_existing from public.client_users where user_id = v_user;
  if v_existing is not null then
    if v_existing = v_client then
      raise notice 'Already linked to %. Nothing to do.', v_client_name;
      return;
    end if;
    raise exception 'That account is already the portal login for a different client.';
  end if;

  insert into public.client_users (user_id, client_id, workspace_id)
  values (v_user, v_client, v_ws);

  raise notice 'Linked % to %. They can confirm their email now.', v_email, v_client_name;
end $$;

-- Confirm it took. Expect one row, with a client name and no membership.
select u.email,
       c.name                              as client,
       cu.created_at                       as linked_at,
       exists (select 1 from public.memberships m where m.user_id = u.id) as has_staff_seat,
       u.email_confirmed_at
from public.client_users cu
join auth.users u      on u.id = cu.user_id
join public.clients c  on c.id = cu.client_id
order by cu.created_at desc
limit 10;
