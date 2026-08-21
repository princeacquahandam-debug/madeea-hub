-- Removing a member left a permanent block on ever adding them back.
--
-- invite-member refused an address when `invites.accepted_at` was set. That
-- column records that somebody once joined; it says nothing about whether they
-- are here NOW. Deleting a membership never touched it, so the workspace owner
-- removed a member, tried to invite them again, and was told "That person is
-- already a member" about somebody with no membership row at all. There was no
-- route out of that state from inside the product.
--
-- Two changes: give the function a way to resolve an address to an account, and
-- stop the invite row outliving the membership it produced.

-- 1. Resolve an email to its auth user, for the invite function only.
--    auth.users is not exposed through PostgREST, and listUsers() paginates the
--    entire directory to answer one question.
create or replace function public.auth_user_id_by_email(addr text)
returns uuid
language sql
security definer
set search_path = public, auth
as $$
  select id from auth.users where lower(email) = lower(trim(addr)) limit 1;
$$;

-- Never reachable from a browser. It answers "does this person have an
-- account", which would otherwise let any signed-in user enumerate addresses.
revoke all on function public.auth_user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.auth_user_id_by_email(text) to service_role;

-- 2. An invite is spent once accepted, and meaningless once the seat is gone.
--    Removing a member now clears it, so the record cannot contradict the
--    membership table again.
create or replace function public.clear_invite_on_removal()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare addr text;
begin
  select u.email into addr from auth.users u where u.id = old.user_id;
  if addr is not null then
    delete from public.invites
     where lower(email) = lower(addr)
       and workspace_id = old.workspace_id;
  end if;
  return old;
end;
$$;

drop trigger if exists memberships_clear_invite on public.memberships;
create trigger memberships_clear_invite
  after delete on public.memberships
  for each row execute function public.clear_invite_on_removal();

-- 3. Repair what has already rotted: invites marked accepted for people who
--    hold no membership in that workspace. Each one is an address that cannot
--    currently be invited.
delete from public.invites i
 where i.accepted_at is not null
   and not exists (
     select 1
       from public.memberships m
       join auth.users u on u.id = m.user_id
      where m.workspace_id = i.workspace_id
        and lower(u.email) = lower(i.email)
   );
