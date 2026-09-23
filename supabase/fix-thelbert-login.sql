-- READY TO RUN. Copy this whole file, paste, Run. Nothing to edit.
--
-- Turns desilocthelbert@gmail.com from a misfiled employee into the portal
-- login for a client named "thelbert", creating that client record on the way.
--
-- Safe to run twice: the second run reports that it is already linked and
-- changes nothing.
--
-- It still refuses if the account turns out to be a real employee -- anything
-- ranked above employee, or holding time entries, EOD reports or assigned
-- tasks. Those guards are the reason this is a script and not three DELETEs.

do $$
declare
  v_email       constant text := 'desilocthelbert@gmail.com';
  v_client_name constant text := 'thelbert';

  v_user uuid; v_client uuid; v_ws uuid; v_owner uuid;
  v_role text; v_work int; v_existing uuid;
begin
  select id into v_user from auth.users where lower(email) = lower(v_email) limit 1;
  if v_user is null then
    raise exception 'No auth user for %. Invite it in Authentication first.', v_email;
  end if;

  select id, workspace_id into v_client, v_ws
  from public.clients where lower(btrim(name)) = lower(v_client_name) limit 1;

  if v_client is null then
    /* clients.owner_id is NOT NULL, so the record needs a staff owner. The
       highest-ranked member is who would have created it in the Vault, and is
       never an EA who then appears to own an account nobody gave them. */
    select m.user_id, m.workspace_id into v_owner, v_ws
    from public.memberships m
    order by public.role_rank(m.role::text) desc, m.created_at asc
    limit 1;

    if v_owner is null then
      raise exception 'No staff member exists to own the client record.';
    end if;

    insert into public.clients (owner_id, workspace_id, name)
    values (v_owner, v_ws, v_client_name)
    returning id into v_client;

    raise notice 'Created client record "%".', v_client_name;
  end if;

  select role::text into v_role from public.memberships where user_id = v_user;

  if v_role is not null then
    -- Only an employee seat is the fallback's doing. Anything higher was a
    -- person appointing a person.
    if public.role_rank(v_role) > public.role_rank('employee') then
      raise exception 'That account holds the % role. Somebody appointed them. Refusing.', v_role;
    end if;

    -- A misfiled client has no shift, no report, no task. An EA has all three.
    select (select count(*) from public.time_entries where owner_id = v_user)
         + (select count(*) from public.eod_reports  where owner_id = v_user)
         + (select count(*) from public.tasks where assignee_id = v_user)
      into v_work;

    if v_work > 0 then
      raise exception 'That account has % pieces of work against it. That is an employee. Refusing.', v_work;
    end if;

    delete from public.memberships where user_id = v_user;
    raise notice 'Removed the % seat.', v_role;
  end if;

  select client_id into v_existing from public.client_users where user_id = v_user;
  if v_existing is not null then
    if v_existing = v_client then
      raise notice 'Already linked. Nothing to do.';
      return;
    end if;
    raise exception 'That account is already the portal login for a different client.';
  end if;

  insert into public.client_users (user_id, client_id, workspace_id)
  values (v_user, v_client, v_ws);

  raise notice 'Done. Sign out and back in to load the portal.';
end $$;

-- Expect one row: client = thelbert, has_staff_seat = false.
select u.email,
       c.name as client,
       exists (select 1 from public.memberships m where m.user_id = u.id) as has_staff_seat
from public.client_users cu
join auth.users u     on u.id = cu.user_id
join public.clients c on c.id = cu.client_id
where lower(u.email) = lower('desilocthelbert@gmail.com');
