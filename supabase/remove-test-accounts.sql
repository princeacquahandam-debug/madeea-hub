-- Remove the throwaway logins made while setting up the client portal.
--
-- === READ THIS BEFORE CHANGING v_dry_run =================================
--
-- Deleting a row from auth.users is not a small act here. Twenty-seven tables
-- carry `owner_id ... references auth.users(id) on delete cascade`, and one of
-- them is `clients`. So deleting an account that owns a client record deletes
-- THE CLIENT, and everything that cascades from it. Postgres will do this
-- silently and there is no undo.
--
-- That is why this script refuses far more than it deletes. An account is only
-- removed when it owns nothing, has done nothing, and is not staff. A real test
-- account passes all three trivially. Anything else is somebody's real login
-- wearing an unfamiliar email address.
--
-- It runs as a DRY RUN by default and deletes nothing. Read what it reports,
-- then set v_dry_run := false and run it again.

do $$
declare
  -- ------------------------------------------------------------------ SET THESE
  -- The addresses to remove. Add to the list as needed.
  v_emails text[] := array[
    'desilocthelbert@gmail.com'
  ];

  -- true  = report only, change nothing   (start here)
  -- false = actually delete
  v_dry_run boolean := true;
  -- ---------------------------------------------------------------------------

  v_email text;
  v_user uuid;
  v_role text;
  v_owns_clients int;
  v_work int;
  v_client_name text;
  v_removed int := 0;
  v_skipped int := 0;
begin
  if v_dry_run then
    raise notice '=== DRY RUN. Nothing will be deleted. ===';
  else
    raise notice '=== LIVE. Accounts below will be permanently deleted. ===';
  end if;

  foreach v_email in array v_emails loop
    select id into v_user from auth.users where lower(email) = lower(btrim(v_email)) limit 1;

    if v_user is null then
      raise notice '[skip] % -- no such account. Nothing to do.', v_email;
      v_skipped := v_skipped + 1;
      continue;
    end if;

    select role::text into v_role from public.memberships where user_id = v_user;

    -- REFUSAL 1: staff above employee were appointed by a person.
    if v_role is not null and public.role_rank(v_role) > public.role_rank('employee') then
      raise notice '[REFUSE] % -- holds the % role. That is a real staff account.', v_email, v_role;
      v_skipped := v_skipped + 1;
      continue;
    end if;

    -- REFUSAL 2: owning a client is the dangerous one. clients.owner_id
    -- cascades, so this delete would take the client and its whole tree.
    select count(*) into v_owns_clients from public.clients where owner_id = v_user;
    if v_owns_clients > 0 then
      raise notice '[REFUSE] % -- owns % client record(s). Deleting it would DELETE THOSE CLIENTS. Reassign them first.', v_email, v_owns_clients;
      v_skipped := v_skipped + 1;
      continue;
    end if;

    -- REFUSAL 3: anybody who has actually worked is not a test account.
    select (select count(*) from public.time_entries where owner_id = v_user)
         + (select count(*) from public.eod_reports  where owner_id = v_user)
         + (select count(*) from public.tasks        where owner_id = v_user)
         + (select count(*) from public.tasks        where assignee_id = v_user)
         + (select count(*) from public.notes        where owner_id = v_user)
      into v_work;

    if v_work > 0 then
      raise notice '[REFUSE] % -- has % rows of real work against it (time, EOD, tasks or notes).', v_email, v_work;
      v_skipped := v_skipped + 1;
      continue;
    end if;

    select c.name into v_client_name
    from public.client_users cu join public.clients c on c.id = cu.client_id
    where cu.user_id = v_user;

    if v_dry_run then
      raise notice '[would delete] %  (role: %, portal login for: %)',
        v_email, coalesce(v_role, 'none'), coalesce(v_client_name, 'none');
      v_removed := v_removed + 1;
      continue;
    end if;

    /* Explicit, in order, rather than leaning on the cascade. The cascade would
       handle both, but writing them out means this script says what it removes
       instead of relying on a foreign key nobody re-reads. */
    delete from public.client_users where user_id = v_user;
    delete from public.memberships  where user_id = v_user;
    delete from auth.users          where id      = v_user;

    raise notice '[deleted] %', v_email;
    v_removed := v_removed + 1;
  end loop;

  raise notice '--- % account(s) %, % skipped ---',
    v_removed, case when v_dry_run then 'would be removed' else 'removed' end, v_skipped;

  if v_dry_run then
    raise notice 'Nothing changed. Set v_dry_run := false to apply.';
  end if;
end $$;

-- What is left. The client record created for testing survives on purpose --
-- it belongs to the agency, not to the login that was using it. Delete it from
-- the Client Vault if you do not want it.
select u.email,
       m.role::text                    as staff_role,
       c.name                          as client_login_for,
       u.created_at
from auth.users u
left join public.memberships m   on m.user_id = u.id
left join public.client_users cu on cu.user_id = u.id
left join public.clients c       on c.id = cu.client_id
order by u.created_at desc;
