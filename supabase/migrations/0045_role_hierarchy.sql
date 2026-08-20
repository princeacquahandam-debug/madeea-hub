-- Roles that can actually be granted, and cannot be escalated.
--
-- WHAT WAS BROKEN. invite-member hardcoded role='ea' on every invite, so the
-- role picker in the UI decided nothing: every person invited arrived as an
-- employee whatever was chosen. And membership changes had no guard at all
-- beyond "is the caller an admin", so an admin could mint another admin, or
-- demote the only one and leave the workspace unadministerable.
--
-- THE TWO RULES THAT MATTER, and neither is enforceable in the UI alone,
-- because the UI is not where an attacker sends a request from:
--
--   1. Nobody grants a role above their own. An admin cannot create an owner.
--   2. The last owner cannot be demoted or removed. A workspace with no owner
--      has no one who can restore one.

-- Rank, so comparisons are a number rather than a chain of ORs repeated in
-- five places, each free to drift from the others.
create or replace function public.role_rank(r text)
returns int language sql immutable as $$
  select case r
    when 'owner'    then 40
    when 'admin'    then 30
    when 'manager'  then 20
    when 'employee' then 10
    -- The original role, kept because seven live rows carry it. It means
    -- employee, and ranks with employee.
    when 'ea'       then 10
    else 0
  end
$$;

/* Which roles the CURRENT user may hand out. Used by the invite function and by
   the role picker, so the list on screen and the list the server accepts are
   generated from one definition and cannot disagree. */
create or replace function public.grantable_roles()
returns text[] language sql stable security definer set search_path = public, pg_temp as $$
  select array(
    select r from unnest(array['owner','admin','manager','employee']) r
    where public.role_rank(r) <= public.role_rank(public.my_role())
      and public.my_role() in ('owner','admin')
  )
$$;

/* Membership changes, guarded in the database rather than in a page.
   A privilege check that lives only in the UI is a suggestion: the API is
   reachable without it. */
create or replace function public.membership_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  owners_left int;
  actor_rank int := public.role_rank(public.my_role());
begin
  -- Service-role callers (edge functions, migrations) have no JWT and no role.
  -- They are trusted by definition; everything below is about human callers.
  if auth.uid() is null then
    return coalesce(new, old);
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    if public.role_rank(new.role::text) > actor_rank then
      raise exception 'You cannot grant a role above your own (%).', public.my_role();
    end if;
  end if;

  -- Demoting or removing the last owner leaves nobody who can appoint one.
  if tg_op = 'UPDATE' and old.role::text = 'owner' and new.role::text <> 'owner' then
    select count(*) into owners_left from public.memberships
     where workspace_id = old.workspace_id and role::text = 'owner' and user_id <> old.user_id;
    if owners_left = 0 then
      raise exception 'This is the only owner. Appoint another owner before changing this one.';
    end if;
  end if;

  if tg_op = 'DELETE' and old.role::text = 'owner' then
    select count(*) into owners_left from public.memberships
     where workspace_id = old.workspace_id and role::text = 'owner' and user_id <> old.user_id;
    if owners_left = 0 then
      raise exception 'This is the only owner. Appoint another owner before removing this one.';
    end if;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists memberships_guarded on public.memberships;
create trigger memberships_guarded
  before insert or update or delete on public.memberships
  for each row execute function public.membership_guard();

-- Same rule on the invite itself, so an invite cannot smuggle in a role its
-- sender was never allowed to grant.
create or replace function public.invite_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then return new; end if;
  if public.role_rank(new.role::text) > public.role_rank(public.my_role()) then
    raise exception 'You cannot invite someone at a role above your own (%).', public.my_role();
  end if;
  return new;
end;
$$;

drop trigger if exists invites_guarded on public.invites;
create trigger invites_guarded
  before insert or update on public.invites
  for each row execute function public.invite_guard();

/* Every capability, per role, as data. The permissions screen renders straight
   from this, so what an admin is told a role can do is the same source the
   policies enforce, rather than a table in the UI that slowly stops being true.
   Kept in step with can() by construction: both read role_rank. */
create or replace function public.role_capabilities()
returns table (capability text, owner boolean, admin boolean, manager boolean, employee boolean)
language sql stable as $$
  with caps(capability, min_rank) as (values
    ('View your own activity',        10),
    ('View team activity',            20),
    ('View screenshots',              20),
    ('View screencasts',              20),
    ('Review and dismiss flags',      20),
    ('Download screenshots',          30),
    ('Download screencasts',          30),
    ('Delete screenshots',            30),
    ('Delete screencasts',            30),
    ('Correct timesheets',            30),
    ('Configure capture settings',    30),
    ('Configure privacy settings',    30),
    ('Read the audit log',            30),
    ('Invite people',                 30),
    ('Change roles',                  30),
    ('Appoint an owner',              40)
  )
  select capability,
         40 >= min_rank, 30 >= min_rank, 20 >= min_rank, 10 >= min_rank
  from caps
$$;
