-- An account that should be a client was given an employee seat. Fix it.
--
-- WHAT HAPPENED, from 0070: an account that confirms its email while holding no
-- client_users row is treated as staff somebody forgot to invite, and
-- grant_membership_fallback grants it an employee seat in the single workspace.
-- That is correct behaviour for real staff and wrong for a client, and the only
-- thing that tells the two apart is whether the client_users row was written
-- before the confirmation. It was not, so the fallback fired.
--
-- Nothing leaked that matters yet: the seat means they COULD read workspace
-- data, not that they did. Removing it closes that immediately.
--
-- WHY THE DELETE IS ALLOWED HERE AND NOT FROM THE APP. membership_guard exits
-- early when auth.uid() is null, which is the case in the SQL editor. From a
-- browser the same delete is checked against the caller's rank. So this script
-- carries its own guards instead, because the database will not stop it.
--
-- THE THREE REFUSALS BELOW ARE THE POINT. Deleting the wrong membership row
-- removes a real employee from the workspace and takes their access with it.
-- Each check below is a way of asking "is this actually a client who got
-- misfiled, or a person who works here?" before touching anything.

do $$
declare
  -- ================= SET THESE TWO, EVERY TIME YOU RE-COPY THIS FILE =========
  -- Re-pasting the file resets them to the placeholders below. If you get
  -- "No auth user for client@example.com", this is the line you missed.
  v_email       text := 'client@example.com';   -- the account that got the seat
  v_client_name text := 'Breakaway Hoops';      -- the business the login is for

  -- Set true to CREATE the client record if no such name exists, instead of
  -- refusing. For setting up a test login without going to the Client Vault
  -- first. Leave false for a real client, so the record is created properly in
  -- the app with their company, tone and preferences filled in.
  v_create_client boolean := false;
  -- ===========================================================================
  v_user uuid;
  v_client uuid;
  v_ws uuid;
  v_role text;
  v_work int;
  v_existing uuid;
  v_names text;
  v_owner uuid;
begin
  select id into v_user from auth.users where lower(email) = lower(btrim(v_email)) limit 1;
  if v_user is null then
    raise exception 'No auth user for %.', v_email;
  end if;

  /* Case-insensitive and trimmed. An exact match sent somebody back around the
     loop over "thelbert" against "Thelbert", which is a spelling lesson, not a
     safety check -- and the safety here is the membership guards below. */
  select id, workspace_id into v_client, v_ws
  from public.clients
  where lower(btrim(name)) = lower(btrim(v_client_name))
  limit 1;

  if v_client is null and v_create_client then
    /* owner_id is NOT NULL on clients, so the record needs a staff owner. The
       highest-ranked member is the safe pick: an owner or admin is who would
       have created it in the Vault anyway, and it is never an EA who then
       appears to own an account nobody gave them. */
    select m.user_id, m.workspace_id into v_owner, v_ws
    from public.memberships m
    order by public.role_rank(m.role::text) desc, m.created_at asc
    limit 1;

    if v_owner is null then
      raise exception 'No staff member exists to own the client record. Create the client in the app instead.';
    end if;

    insert into public.clients (owner_id, workspace_id, name)
    values (v_owner, v_ws, btrim(v_client_name))
    returning id into v_client;

    raise notice 'Created client record "%".', btrim(v_client_name);
  end if;

  if v_client is null then
    -- Say what IS there. "No client named X" without the list is one more trip
    -- back to the Vault to read a name off the screen.
    select string_agg(name, ', ' order by name) into v_names from public.clients;
    raise exception
      'No client named "%". Clients on this workspace: %. Either use one of those, or set v_create_client := true to make it.',
      v_client_name, coalesce(v_names, '(none yet)');
  end if;

  select role::text into v_role from public.memberships where user_id = v_user;

  if v_role is null then
    raise notice 'No membership to remove. Going straight to the link.';
  else
    -- REFUSAL 1: anything above employee was granted deliberately by a person.
    -- The fallback only ever grants an employee seat, so a manager, admin or
    -- owner row is somebody real.
    if public.role_rank(v_role) > public.role_rank('employee') then
      raise exception
        'That account holds the % role, which the fallback never grants. Somebody appointed them. Refusing to delete a real staff member.', v_role;
    end if;

    -- REFUSAL 2: has this person actually done work? A misfiled client has no
    -- shift, no report and no task assigned to them. An EA has all three.
    select
      (select count(*) from public.time_entries  where owner_id    = v_user) +
      (select count(*) from public.eod_reports   where owner_id    = v_user) +
      (select count(*) from public.tasks         where assignee_id = v_user)
    into v_work;

    if v_work > 0 then
      raise exception
        'That account has % pieces of work against it (time entries, EOD reports or assigned tasks). That is an employee, not a misfiled client. Refusing.', v_work;
    end if;

    delete from public.memberships where user_id = v_user;
    raise notice 'Removed the % seat from %.', v_role, v_email;
  end if;

  -- REFUSAL 3: do not quietly move somebody between clients.
  select client_id into v_existing from public.client_users where user_id = v_user;
  if v_existing is not null then
    if v_existing = v_client then
      raise notice 'Already the portal login for %. Nothing further to do.', v_client_name;
      return;
    end if;
    raise exception 'That account is already the portal login for a different client.';
  end if;

  insert into public.client_users (user_id, client_id, workspace_id)
  values (v_user, v_client, v_ws);

  raise notice 'Linked % to %. Sign out and back in for the portal to load.', v_email, v_client_name;
end $$;

-- Expect one row: a client name, and has_staff_seat = false.
select u.email,
       c.name as client,
       exists (select 1 from public.memberships m where m.user_id = u.id) as has_staff_seat,
       u.email_confirmed_at
from public.client_users cu
join auth.users u     on u.id = cu.user_id
join public.clients c on c.id = cu.client_id
order by cu.created_at desc
limit 10;
