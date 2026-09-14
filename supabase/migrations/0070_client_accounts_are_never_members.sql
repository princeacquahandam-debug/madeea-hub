-- A client account must never fall through into a membership.
--
-- ═══ HOW TWO CORRECT MIGRATIONS MADE A BREACH BETWEEN THEM ═══════════════
--
-- 0059 admits "a confirmed account with no invite" to the single workspace as
-- an ordinary member, and says why that is defensible: public signup is off, so
-- everybody who confirms an address is staff somebody meant to add.
--
-- 0065 made that assumption false. A client authenticates through the same
-- auth.users table, and is identified by holding NO membership row — "the
-- isolation is the ABSENCE of a row". Its header is explicit that giving a
-- client a membership would be "a data breach on the day it shipped".
--
-- The two meet at the instant a client confirms their email. handle_user_confirmed
-- calls grant_invited_membership (no invite row, so nothing happens), and then
-- grant_membership_fallback, which finds no membership, finds exactly one
-- workspace, and grants an 'ea' seat. my_workspace() starts returning the
-- agency's id, and all thirty-three policies that gate on it open at once:
-- eod_reports, notes, memories, credential_access_log, the staff list.
--
-- No client account had been created yet, so this never fired. Creating the
-- first one is what would have fired it.
--
-- ═══ TWO GUARDS, BECAUSE ONE OF THEM DEPENDS ON ORDERING ═════════════════
--
--   1. The fallback ignores anyone holding a client_users row. Correct only if
--      that row exists BEFORE the client confirms, which is why invite-client
--      writes it in the same request that creates the account.
--
--   2. A trigger refuses the combination outright, in both directions. Guard 1
--      is the rule; guard 2 is what keeps it true when the ordering is not —
--      a hand-written INSERT in the SQL editor, a restored backup, a future
--      function that creates the account first and links it later.

-- ---------------------------------------------------------------------------
-- 1. The fallback stops treating clients as staff who forgot to be invited.
-- ---------------------------------------------------------------------------
create or replace function public.grant_membership_fallback(p_user uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $fallback$
declare ws uuid;
begin
  if exists (select 1 from public.memberships where user_id = p_user) then
    return;
  end if;

  -- Added by 0070. A client is not a member who was missed.
  if exists (select 1 from public.client_users where user_id = p_user) then
    return;
  end if;

  if (select count(*) from public.workspaces) <> 1 then
    return;
  end if;

  select id into ws from public.workspaces;
  insert into public.memberships (workspace_id, user_id, role)
  values (ws, p_user, 'ea')
  on conflict do nothing;
end $fallback$;

revoke all on function public.grant_membership_fallback(uuid) from public, anon, authenticated;

comment on function public.grant_membership_fallback is
  'Admits a confirmed account with no invite to the single workspace, as an ordinary member. Never admits a client (0070). Does nothing when more than one workspace exists. Remove this if public signup is ever enabled.';

-- ---------------------------------------------------------------------------
-- 2. The combination is refused outright, whichever side arrives second.
-- ---------------------------------------------------------------------------
create or replace function public.refuse_staff_and_client()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $excl$
begin
  if tg_table_name = 'memberships' then
    if exists (select 1 from public.client_users where user_id = new.user_id) then
      raise exception
        'user % holds a client account, so cannot also be a workspace member (0070)', new.user_id
        using errcode = 'check_violation';
    end if;
  else
    if exists (select 1 from public.memberships where user_id = new.user_id) then
      raise exception
        'user % is a workspace member, so cannot also hold a client account (0070)', new.user_id
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $excl$;

drop trigger if exists memberships_not_client on public.memberships;
create trigger memberships_not_client
  before insert or update on public.memberships
  for each row execute function public.refuse_staff_and_client();

drop trigger if exists client_users_not_staff on public.client_users;
create trigger client_users_not_staff
  before insert or update on public.client_users
  for each row execute function public.refuse_staff_and_client();

-- ---------------------------------------------------------------------------
-- 3. Nothing to repair, but prove that rather than assume it.
-- ---------------------------------------------------------------------------
do $$
declare bad int;
begin
  select count(*) into bad
  from public.memberships m
  join public.client_users c on c.user_id = m.user_id;

  if bad > 0 then
    raise exception
      '% account(s) hold both a membership and a client account. Resolve before 0070 can be trusted.', bad;
  end if;
end $$;
