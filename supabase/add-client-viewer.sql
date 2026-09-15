-- Give a colleague of an existing client READ-ONLY access to that account.
--
-- A viewer sees Overview, Activity, Calendar and Notes. A viewer cannot request
-- work, cannot leave a note, and cannot see either message channel -- including
-- the escalation channel, which is where the client raises things about their
-- assistant. See 0074 for why that one matters most.
--
-- SAME ORDERING TRAP AS EVERY OTHER CLIENT LOGIN. Invite the address in
-- Authentication, run this, and only then have them click the confirmation
-- link. An account that confirms with no client_users row is handed a staff
-- seat by the fallback in 0070.

do $$
declare
  -- ================= SET THESE THREE ========================================
  v_email       text := 'colleague@example.com';  -- the person being added
  v_client_name text := 'Breakaway Hoops';        -- the account they may read
  v_role        text := 'viewer';                 -- viewer, or primary for a second full contact
  -- ==========================================================================
  v_user uuid; v_client uuid; v_ws uuid; v_names text; v_existing uuid;
begin
  if v_role not in ('viewer', 'primary') then
    raise exception 'Role must be viewer or primary, not %.', v_role;
  end if;

  select id into v_user from auth.users where lower(email) = lower(btrim(v_email)) limit 1;
  if v_user is null then
    raise exception 'No auth user for %. Invite the address in Authentication first.', v_email;
  end if;

  -- A member cannot also be a client, in either direction (0070).
  if exists (select 1 from public.memberships where user_id = v_user) then
    raise exception 'That address belongs to a team member. A member cannot hold a client login.';
  end if;

  select id, workspace_id into v_client, v_ws
  from public.clients where lower(btrim(name)) = lower(btrim(v_client_name)) limit 1;

  if v_client is null then
    select string_agg(name, ', ' order by name) into v_names from public.clients;
    raise exception 'No client named "%". Clients on this workspace: %',
      v_client_name, coalesce(v_names, '(none yet)');
  end if;

  select client_id into v_existing from public.client_users where user_id = v_user;
  if v_existing is not null then
    if v_existing = v_client then
      update public.client_users set role = v_role where user_id = v_user;
      raise notice 'Already on this account. Role set to %.', v_role;
      return;
    end if;
    raise exception 'That account already reads a different client.';
  end if;

  insert into public.client_users (user_id, client_id, workspace_id, role)
  values (v_user, v_client, v_ws, v_role);

  raise notice 'Added % to % as %.', v_email, v_client_name, v_role;
end $$;

-- Everyone who can see each client account.
select c.name as client,
       u.email,
       cu.role,
       cu.created_at
from public.client_users cu
join auth.users u     on u.id = cu.user_id
join public.clients c on c.id = cu.client_id
order by c.name, cu.role desc, cu.created_at;
