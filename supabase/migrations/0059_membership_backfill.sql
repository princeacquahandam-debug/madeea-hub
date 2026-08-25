-- Nobody can see anything without a membership, and five people do not have one.
--
-- WHAT ACTUALLY BROKE. Every policy in this schema reads
-- `workspace_id = my_workspace()`, and my_workspace() is "the workspace this
-- person is a member of". A user with no membership row therefore matches
-- nothing, anywhere: no EOD reports, no tasks, no messages, no clients. They
-- can sign in perfectly well and see an app with every number at zero, which
-- reads as "the product is broken" rather than "you were never let in".
--
-- Memberships are granted when an invited person CONFIRMS their email
-- (grant_invited_membership, 0020). Anyone who was invited but has not clicked
-- the link, or whose account was deleted and recreated, is outside. Deleting a
-- user cascades their membership away; recreating the account does not bring it
-- back, because the new account is a different auth id.
--
-- ── WHY THIS BACKFILL IS SAFE, AND WHERE IT REFUSES ──────────────────────
--
-- It only acts when the deployment has EXACTLY ONE workspace. That is the shape
-- this product actually runs in: one agency, one shared workspace, invite-only.
-- With one workspace there is no question about which one somebody belongs to,
-- so filling the gap cannot put a person in the wrong place.
--
-- With two or more it does nothing at all. Guessing there would mean putting
-- one agency's EA into another agency's data, which is the worst mistake this
-- schema can make, and a repair that can make it is not a repair.
--
-- It also only admits CONFIRMED accounts. An unconfirmed signup is an address
-- nobody has proved they own, and 0020 removed exactly that hole.
do $$
declare
  ws uuid;
  added int;
begin
  if (select count(*) from public.workspaces) <> 1 then
    raise notice 'More than one workspace, or none. Nothing was changed: which workspace somebody belongs to is not something this migration may guess.';
    return;
  end if;

  select id into ws from public.workspaces;

  insert into public.memberships (workspace_id, user_id, role)
  select ws, u.id, 'ea'
  from auth.users u
  where u.email_confirmed_at is not null
    and not exists (select 1 from public.memberships m where m.user_id = u.id)
  on conflict do nothing;

  get diagnostics added = row_count;
  raise notice 'Added % membership(s) to workspace %.', added, ws;
end $$;

-- ── Stop it happening again ──────────────────────────────────────────────
--
-- The invite path stays exactly as it was: a seat is granted when a pending
-- invite matches a confirmed address. What changes is the case that produced
-- this mess — a confirmed account with no invite and no membership, in a
-- deployment that has only one workspace to be a member of.
--
-- Before, that person silently had access to nothing. Now they are admitted to
-- the single workspace as an ordinary member. Deliberately NOT an admin: being
-- let in is not the same as being trusted to remove people.
--
-- This is only defensible because public signup is off for this project. If
-- signup is ever opened, DROP THIS FUNCTION'S FALLBACK: with open signup it
-- would mean anybody who registers joins the agency's workspace and reads its
-- clients' mail.
create or replace function public.grant_membership_fallback(p_user uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare ws uuid;
begin
  if exists (select 1 from public.memberships where user_id = p_user) then
    return;
  end if;
  if (select count(*) from public.workspaces) <> 1 then
    return;
  end if;
  select id into ws from public.workspaces;
  insert into public.memberships (workspace_id, user_id, role)
  values (ws, p_user, 'ea')
  on conflict do nothing;
end $$;

revoke all on function public.grant_membership_fallback(uuid) from public, anon, authenticated;

create or replace function public.handle_user_confirmed()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $conf$
begin
  if old.email_confirmed_at is null and new.email_confirmed_at is not null then
    -- The invite is still the primary path and still decides the role.
    perform grant_invited_membership(new.id, new.email);
    -- And if no invite matched, a confirmed person in a single-workspace
    -- deployment gets a seat rather than an app full of zeros.
    perform grant_membership_fallback(new.id);
  end if;
  return new;
end $conf$;

drop trigger if exists on_auth_user_confirmed on auth.users;
create trigger on_auth_user_confirmed
  after update of email_confirmed_at on auth.users
  for each row execute function handle_user_confirmed();

comment on function public.grant_membership_fallback is
  'Admits a confirmed account with no invite to the single workspace, as an ordinary member. Does nothing when more than one workspace exists. Remove this if public signup is ever enabled.';
