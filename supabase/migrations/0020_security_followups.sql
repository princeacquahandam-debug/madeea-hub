-- 0020_security_followups.sql
-- Follow-ups from the second security audit. 0016 closed the big holes; these are
-- the ones that survived it. Additive and idempotent — no row data changes.
--
-- Summary:
--   A) membership requires a CONFIRMED email  (closes invite squatting)
--   B) AI budget requires workspace membership (closes the cost-drain path)
--   C) the AI rate limiter stops being racy
--   D) task_events becomes a real audit trail (read-only to members)
--   E) owner_id can no longer be spoofed or rewritten
--   F) anon can no longer enumerate the avatar bucket
--   G) my_workspace()/is_admin() made deterministic + search_path hardened

-- ============ A) membership requires a confirmed email ============
--
-- The bug: on_auth_user_created fires on INSERT into auth.users, which happens
-- BEFORE the address is proven. Any signup whose email matched a pending invite
-- consumed it and got a full seat. Invite addresses are often guessable
-- (firstname@clientdomain), so an attacker who signed up first took the seat —
-- and with it read/write over every client, task and message in the workspace.
-- The only thing standing in the way was the Supabase "allow new signups" toggle,
-- a dashboard setting with no enforcement in this repo.
--
-- The fix is NOT "require email_confirmed_at on INSERT". Supabase's
-- inviteUserByEmail creates the auth.users row unconfirmed and the invitee
-- confirms later, so that would grant nobody a membership and break invites
-- entirely. Membership instead moves to whenever the address becomes confirmed:
-- at INSERT for auto-confirm/admin-created accounts, at UPDATE otherwise.

-- Shared grant logic, called from both triggers.
-- SECURITY DEFINER with a caller-supplied user id, so EXECUTE is revoked below —
-- if this were reachable over /rest/v1/rpc it would hand out workspace seats.
create or replace function grant_invited_membership(p_user uuid, p_email text)
returns void language plpgsql security definer set search_path = public, pg_temp as $grant$
declare wsid uuid; inv invites%rowtype;
begin
  -- Already seated: nothing to do, and never consume a second invite.
  if exists (select 1 from memberships where user_id = p_user) then return; end if;
  if p_email is null then return; end if;

  select * into inv from invites
    where email = lower(p_email) and accepted_at is null and expires_at > now();

  if inv.workspace_id is not null then
    insert into memberships (workspace_id, user_id, role)
      values (inv.workspace_id, p_user, inv.role) on conflict do nothing;
    update invites set accepted_at = now() where email = lower(p_email);

  elsif not exists (select 1 from workspaces) then
    -- Bootstrap only: the very first confirmed user creates the workspace as
    -- admin. Dead once a workspace exists, so it can't self-provision later.
    insert into workspaces (name) values ('MadeEA Workspace') returning id into wsid;
    insert into memberships (workspace_id, user_id, role) values (wsid, p_user, 'admin');
  end if;
end $grant$;

revoke execute on function grant_invited_membership(uuid, text) from public, anon, authenticated;

create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $newuser$
begin
  insert into profiles (id, full_name, initials)
  values (new.id, coalesce(split_part(new.email, '@', 1), 'Elite EA'), upper(left(coalesce(new.email, 'EA'), 2)))
  on conflict (id) do nothing;

  -- Only a proven address gets a seat. An unconfirmed signup that happens to
  -- match a pending invite now leaves that invite untouched for its real owner.
  if new.email_confirmed_at is not null then
    perform grant_invited_membership(new.id, new.email);
  end if;

  return new;
end $newuser$;

-- The normal invite path lands here: the invitee clicks the link, sets a
-- password, email_confirmed_at flips null → not null, and the seat is granted.
create or replace function handle_user_confirmed()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $conf$
begin
  if old.email_confirmed_at is null and new.email_confirmed_at is not null then
    perform grant_invited_membership(new.id, new.email);
  end if;
  return new;
end $conf$;

drop trigger if exists on_auth_user_confirmed on auth.users;
create trigger on_auth_user_confirmed
  after update of email_confirmed_at on auth.users
  for each row execute function handle_user_confirmed();

-- ============ B+C) AI budget: membership required, and no longer racy ============
--
-- B) getUser() was the only gate on the AI endpoints, but since 0016 an account
--    can exist with NO membership. Such an account saw no data (RLS returns
--    nothing) but could still spend ~100 gpt-4o calls/hour, unbounded in the
--    number of accounts. Fixing it here rather than in each Edge Function covers
--    generate, assistant-chat and run-automation at once, and keeps working even
--    if a function is redeployed from an older checkout.
--
-- C) The limiter read the count, then inserted, with no lock. Under READ
--    COMMITTED a burst of concurrent requests all observed the same pre-insert
--    count and every one of them passed. The cap only ever held against
--    sequential traffic. An advisory lock keyed on the user serialises the
--    check-and-insert; it is transaction-scoped, so it releases automatically.
create or replace function check_ai_rate_limit(p_fn text, p_max int default 60)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $ratelimit$
declare uid uuid; used int;
begin
  uid := auth.uid();
  if uid is null then return false; end if;

  -- No workspace, no AI budget.
  if my_workspace() is null then return false; end if;

  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));

  delete from ai_usage where created_at < now() - interval '2 hours';

  select count(*) into used from ai_usage
    where user_id = uid and created_at > now() - interval '1 hour';
  if used >= greatest(p_max, 1) then return false; end if;

  insert into ai_usage (user_id, fn) values (uid, p_fn);
  return true;
end $ratelimit$;

-- ============ D) task_events is an audit trail, so make it one ============
--
-- 0015 gave it `for all`, which means every member had INSERT and DELETE on the
-- log of who reassigned what. An EA could move a task off their plate and then
-- delete the record, or post a row with actor_id set to a colleague to fabricate
-- one. The writing trigger (log_task_assignment) is SECURITY DEFINER, so it
-- still writes fine with no INSERT policy.
drop policy if exists "ws shared" on task_events;
drop policy if exists "task events read" on task_events;
create policy "task events read" on task_events for select to authenticated
  using (workspace_id = my_workspace());

-- ============ E) owner_id can no longer be spoofed or rewritten ============
--
-- Every "ws shared" policy validates workspace_id only. owner_id is a DEFAULT,
-- not a constraint, so a hand-rolled POST could attribute a row to any member,
-- and an UPDATE could rewrite authorship after the fact. Low severity under a
-- shared workspace — but the UI shows "who wrote this", and a field that can be
-- forged shouldn't be displayed as fact.
--
-- Service-role writes (the Edge Functions) run with auth.uid() null and are left
-- alone, which is what gmail-sync/calendar-sync need.
create or replace function force_owner_id()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $owner$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.owner_id := auth.uid(); end if;
  else
    new.owner_id := old.owner_id;  -- attribution is immutable
  end if;
  return new;
end $owner$;

do $$
declare t text;
begin
  foreach t in array array[
    'notes', 'memories', 'reminders', 'snoozes', 'sop_runs',
    'tasks', 'clients', 'ai_generations', 'automations', 'assistant_threads'
  ] loop
    -- Only attach where the table AND an owner_id column actually exist, so this
    -- stays safe against a database that skipped an optional migration.
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'owner_id'
    ) then
      execute format('drop trigger if exists %I on public.%I', t || '_force_owner', t);
      execute format(
        'create trigger %I before insert or update on public.%I
           for each row execute function force_owner_id()',
        t || '_force_owner', t
      );
    end if;
  end loop;
end $$;

-- ============ F) anon can no longer enumerate the avatar bucket ============
--
-- `to public` on storage.objects let the anon key (which ships in the frontend
-- bundle) list every object in client-avatars. Paths are randomised and the URLs
-- live only in the private clients table, so listing was the ONLY way an outsider
-- could discover them — and the result was every executive client's photo,
-- unauthenticated. The bucket stays public=true, so avatars still render from
-- their public CDN URL; only discovery is removed.
drop policy if exists "client avatars read" on storage.objects;
create policy "client avatars read" on storage.objects for select to authenticated
  using (bucket_id = 'client-avatars');

-- ============ G) deterministic identity helpers + search_path ============
--
-- Both used `limit 1` with no ORDER BY and no workspace correlation: a user who
-- is `ea` in one workspace and `admin` in another could be handed admin in the
-- wrong one, depending on which row Postgres returned. Unreachable while 0012
-- keeps everything in a single workspace, but it is a trapdoor under any future
-- multi-workspace work.
--
-- Both also omitted pg_temp from search_path. pg_temp is searched before the
-- listed schemas for relation names, so a session that could create a temp table
-- named `memberships` would redirect these SECURITY DEFINER lookups and defeat
-- every RLS policy at once. Not reachable today (no DDL path through PostgREST),
-- but these functions are superuser-owned, so it costs nothing to close.
create or replace function my_workspace()
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select workspace_id from memberships
   where user_id = auth.uid()
   order by created_at asc
   limit 1
$$;

create or replace function is_admin()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select role = 'admin' from memberships
     where user_id = auth.uid() and workspace_id = my_workspace()
     order by created_at asc
     limit 1
  ), false)
$$;
