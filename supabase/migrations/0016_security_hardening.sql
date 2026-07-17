-- 0016_security_hardening.sql
-- Must sort AFTER 0015: it rewrites handle_new_user and the storage/credential
-- grants, and the migration runner applies files in filename order. It was
-- briefly numbered 0013, which collides with 0013_followups — a version already
-- recorded in this project's migration history, so `db push` would have skipped
-- this file silently and shipped none of the fixes below.
--
-- Closes the gaps found in the security audit. Keeps the ONE shared workspace
-- model from 0012 (every member sees all workspace data — intentional), but
-- makes *getting into* that workspace invite-only, and stops the browser from
-- ever touching provider tokens.
--
-- Summary:
--   A) signup is invite-gated (was: any signup auto-joined the shared workspace,
--      and workspace_id was read straight from client-controlled signup metadata)
--   B) provider tokens become unreadable from the browser (column grants)
--   C) storage policies get WITH CHECK + membership + mime/size limits
--   D) seed helpers stop being callable over RPC
--   E) OAuth states expire
--   F) AI rate limiting

-- ============ A) invite-gated signup ============

-- Written only by the invite-member Edge Function (service role). No policies →
-- unreachable with the anon key, same pattern as oauth_states.
create table if not exists invites (
  email        text primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  -- member_role enum (0003), not text: memberships.role is that enum and there
  -- is no implicit enum→text cast, so a text column breaks the backfill below.
  role         member_role not null default 'ea',
  invited_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '14 days',
  accepted_at  timestamptz
);
alter table invites enable row level security;  -- no policies: service-role only

-- Backfill: everyone who is already a member stays a member. Without this, an
-- existing user who somehow re-triggers the trigger would lose their seat.
insert into invites (email, workspace_id, role, accepted_at)
  select lower(u.email), m.workspace_id, m.role, now()
  from memberships m join auth.users u on u.id = m.user_id
  where u.email is not null
  on conflict (email) do nothing;

-- The trigger no longer reads raw_user_meta_data at all. That field is whatever
-- the client passed to signUp(), so trusting it let anyone who knew a workspace
-- UUID join it. Membership now requires a row in `invites`, which only the
-- service role can write.
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $newuser$
declare wsid uuid; inv invites%rowtype;
begin
  insert into profiles (id, full_name, initials)
  values (new.id, coalesce(split_part(new.email, '@', 1), 'Elite EA'), upper(left(coalesce(new.email, 'EA'), 2)))
  on conflict (id) do nothing;

  select * into inv from invites
    where email = lower(new.email) and accepted_at is null and expires_at > now();

  if inv.workspace_id is not null then
    insert into memberships (workspace_id, user_id, role)
      values (inv.workspace_id, new.id, inv.role) on conflict do nothing;
    update invites set accepted_at = now() where email = lower(new.email);

  elsif not exists (select 1 from workspaces) then
    -- Bootstrap only: the very first user ever creates the workspace as admin.
    -- Once a workspace exists this branch is dead, so it cannot be used to
    -- self-provision later.
    insert into workspaces (name) values ('MadeEA Workspace') returning id into wsid;
    insert into memberships (workspace_id, user_id, role) values (wsid, new.id, 'admin');
  end if;

  -- No invite and the workspace already exists → the account is created but gets
  -- NO membership. my_workspace() returns null, so every "ws shared" policy
  -- fails and the user sees nothing. Signing up is no longer enough.
  return new;
end $newuser$;

-- ============ B) provider tokens are server-side only ============

-- RLS is row-level and cannot hide a column, so use column privileges. The
-- Integrations page still needs to know a connection EXISTS (and to disconnect),
-- but must never be able to read refresh_token / access_token.
revoke all on google_credentials from anon, authenticated;
grant select (owner_id, connected_at, scopes, token_expiry) on google_credentials to authenticated;
grant delete on google_credentials to authenticated;

drop policy if exists "owner all" on google_credentials;
create policy "read own connection" on google_credentials for select to authenticated
  using (owner_id = auth.uid());
create policy "disconnect own" on google_credentials for delete to authenticated
  using (owner_id = auth.uid());
-- No insert/update policy: only the OAuth callback (service role) writes tokens.

-- Nothing in the app reads this one, so lock it to service-role entirely.
revoke all on slack_credentials from anon, authenticated;
drop policy if exists "owner all" on slack_credentials;

-- ============ C) storage: client-avatars ============

-- Bucket-level limits: the UI's accept="image/*" is only a file-picker hint and
-- the client passes its own contentType, so enforce it here. Public read stays —
-- avatars render from a public URL by design.
update storage.buckets
  set public = true,
      file_size_limit = 2097152,  -- 2 MB
      allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']
  where id = 'client-avatars';

-- Previous policies checked only bucket_id: ANY authenticated account — member
-- or not — could overwrite or delete every avatar and upload any file type, and
-- update had USING with no WITH CHECK (so a row could be mutated out of the
-- bucket entirely). Honest scope of the fix: the file_size_limit/mime allowlist
-- above and the WITH CHECK below are the real wins. A workspace MEMBER can still
-- overwrite any avatar — under the shared-workspace model that is in scope by
-- design, the same as every other table.
drop policy if exists "client avatars read" on storage.objects;
drop policy if exists "client avatars write" on storage.objects;
drop policy if exists "client avatars update" on storage.objects;
drop policy if exists "client avatars delete" on storage.objects;

-- my_workspace() is schema-qualified: these policies live in the storage schema,
-- where an unqualified name resolves against whatever search_path is in effect.
-- "is not null" means "is a member of the workspace" — non-members can't write.
create policy "client avatars read" on storage.objects for select to public
  using (bucket_id = 'client-avatars');
create policy "client avatars write" on storage.objects for insert to authenticated
  with check (bucket_id = 'client-avatars' and public.my_workspace() is not null);
create policy "client avatars update" on storage.objects for update to authenticated
  using      (bucket_id = 'client-avatars' and public.my_workspace() is not null)
  with check (bucket_id = 'client-avatars' and public.my_workspace() is not null);
create policy "client avatars delete" on storage.objects for delete to authenticated
  using (bucket_id = 'client-avatars' and public.my_workspace() is not null);

-- ============ D) seed helpers are not an RPC surface ============

-- Postgres grants EXECUTE to PUBLIC by default and PostgREST exposes every
-- public-schema function at /rest/v1/rpc/<name>. seed_core_automations took
-- caller-supplied (wsid, uid) and is SECURITY DEFINER → it wrote rows into any
-- workspace, attributed to any user, bypassing RLS.
revoke execute on function seed_core_automations(uuid, uuid) from public, anon, authenticated;

-- The 1-arg version from 0002 was never dropped: 0003/0004 only replaced the
-- 2-arg overload, so the SECURITY DEFINER original survived the "clean slate".
drop function if exists seed_demo_data(uuid);
drop function if exists seed_demo_data(uuid, uuid);  -- no-op since 0004; nothing calls it now

-- NOTE: my_workspace() and is_admin() keep their default PUBLIC execute grant on
-- purpose. RLS policy expressions are evaluated with the *querying user's*
-- privileges, so revoking EXECUTE would make every "ws shared" policy throw
-- permission denied and lock users out of their own data. Exposing them over RPC
-- is harmless: each only ever reports the caller's own workspace/admin status.

-- ============ D2) global SOPs require membership ============

-- 0007's policy was `workspace_id is null or workspace_id = my_workspace()`. The
-- first branch never checks membership, so any account with no workspace at all
-- could still read every global SOP template. Now that an account can exist
-- without a membership (see A), make that explicit.
drop policy if exists "sops read" on sops;
create policy "sops read" on sops for select to authenticated
  using (my_workspace() is not null and (workspace_id is null or workspace_id = my_workspace()));

-- ============ E) OAuth state expiry + identity binding ============

-- created_at existed but nothing ever read it, so a state stayed valid forever.
alter table oauth_states add column if not exists expires_at timestamptz not null default now() + interval '10 minutes';
delete from oauth_states where created_at < now() - interval '10 minutes';

-- Which Google account is allowed to complete this flow. Written at initiation
-- from the *authenticated initiator's* own email, so an attacker can only ever
-- pin their own address. The callback compares it to the id_token, which stops
-- the classic account-linking CSRF: a victim who consents on an attacker's link
-- produces a different email and is rejected, so the victim's Gmail tokens can
-- never be filed under the attacker's account.
alter table oauth_states add column if not exists expected_email text;

-- ============ F) AI rate limiting ============

create table if not exists ai_usage (
  id         bigserial primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  fn         text not null,
  created_at timestamptz not null default now()
);
alter table ai_usage enable row level security;  -- no policies: reached only via the definer fn below
create index if not exists ai_usage_user_time on ai_usage (user_id, created_at desc);

-- Returns false when the caller is over budget. Identity comes from auth.uid(),
-- never from an argument, so a caller cannot rate-limit (or impersonate) anyone
-- else. Edge Functions call this with the user's own token before hitting OpenAI.
create or replace function check_ai_rate_limit(p_fn text, p_max int default 60)
returns boolean language plpgsql security definer set search_path = public as $$
declare uid uuid; used int;
begin
  uid := auth.uid();
  if uid is null then return false; end if;

  delete from ai_usage where created_at < now() - interval '2 hours';

  select count(*) into used from ai_usage
    where user_id = uid and created_at > now() - interval '1 hour';
  if used >= greatest(p_max, 1) then return false; end if;

  insert into ai_usage (user_id, fn) values (uid, p_fn);
  return true;
end $$;
revoke execute on function check_ai_rate_limit(text, int) from public, anon;
grant execute on function check_ai_rate_limit(text, int) to authenticated;
