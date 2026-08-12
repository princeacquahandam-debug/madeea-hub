-- 0033_credentials.sql. The credential vault.
--
-- Run once in the Supabase SQL editor, after 0032.
--
-- §5.4 of the 10 Aug audit (Rowena 1:02:07: clients should be able to share
-- logins with their EA without LastPass or plaintext chat), built to
-- PROJECT_PLAN §5.8.
--
-- ── The one thing to understand about this table ──────────────────────────
-- It stores CIPHERTEXT. The key is derived in the browser from a workspace
-- passphrase that is never sent here. Nothing in this database, and nothing in
-- an environment variable beside it, can decrypt these rows.
--
-- That is deliberate. §5.8 asks for envelope encryption with a KMS master key;
-- Supabase has no KMS, and a master key in an env var next to the data is not
-- envelope encryption, it is a second copy of the password. See lib/vault.ts.
--
-- Consequence worth stating plainly: if the passphrase is lost, these rows are
-- unrecoverable. That is the correct behaviour for a vault and the UI says so
-- before anyone stores anything.

-- Salt and verifier live on the workspace: one passphrase per workspace, and
-- the verifier lets a wrong one be rejected at unlock instead of rendering
-- garbage where a password should be.
alter table workspaces add column if not exists vault_salt text;
alter table workspaces add column if not exists vault_verifier jsonb;

create table if not exists credentials (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid default my_workspace() references workspaces (id) on delete cascade,

  label text not null,
  url text,
  username text,
  category text,
  notes text,                       -- non-secret context, deliberately plain

  -- The secret. Base64 AES-GCM ciphertext plus its nonce.
  secret_ciphertext text not null,
  secret_nonce text not null,
  key_version integer not null default 1,

  client_id uuid references clients (id) on delete set null,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  rotated_at timestamptz,
  created_at timestamptz not null default now()
);

alter table credentials enable row level security;

create index if not exists credentials_ws_idx on credentials (workspace_id, label);

-- ---------- grants ----------
-- Who may fetch a given credential's ciphertext. Revocable instantly.
create table if not exists credential_grants (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid default my_workspace() references workspaces (id) on delete cascade,
  credential_id uuid not null references credentials (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  granted_by uuid default auth.uid() references auth.users (id) on delete set null,
  granted_at timestamptz not null default now(),
  unique (credential_id, user_id)
);

alter table credential_grants enable row level security;

-- ---------- access log ----------
-- Every reveal, appended. §5.8: show the client that log.
create table if not exists credential_access_log (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid default my_workspace() references workspaces (id) on delete cascade,
  credential_id uuid not null references credentials (id) on delete cascade,
  user_id uuid default auth.uid() references auth.users (id) on delete set null,
  action text not null check (action in ('view', 'copy', 'reveal')),
  at timestamptz not null default now()
);

alter table credential_access_log enable row level security;

create index if not exists credential_log_idx on credential_access_log (workspace_id, credential_id, at desc);

-- ---------- policies ----------
-- Admins manage the vault. An EA sees only what has been granted to them.
drop policy if exists "credentials read" on credentials;
create policy "credentials read" on credentials for select to authenticated
  using (
    workspace_id = my_workspace()
    and (
      is_admin()
      or exists (select 1 from credential_grants g where g.credential_id = credentials.id and g.user_id = auth.uid())
    )
  );

drop policy if exists "credentials write" on credentials;
create policy "credentials write" on credentials for all to authenticated
  using (workspace_id = my_workspace() and is_admin())
  with check (workspace_id = my_workspace() and is_admin());

drop policy if exists "grants read" on credential_grants;
create policy "grants read" on credential_grants for select to authenticated
  using (workspace_id = my_workspace() and (is_admin() or user_id = auth.uid()));

drop policy if exists "grants write" on credential_grants;
create policy "grants write" on credential_grants for all to authenticated
  using (workspace_id = my_workspace() and is_admin())
  with check (workspace_id = my_workspace() and is_admin());

-- Append-only, and enforced: insert and select policies exist, update and
-- delete do not. With RLS on, absent means denied, so nobody can edit away
-- the record of having looked at a client's password.
drop policy if exists "log read" on credential_access_log;
create policy "log read" on credential_access_log for select to authenticated
  using (workspace_id = my_workspace());

drop policy if exists "log append" on credential_access_log;
create policy "log append" on credential_access_log for insert to authenticated
  with check (workspace_id = my_workspace() and user_id = auth.uid());

-- Revoking an assignment must revoke the grants with it. Not wired to
-- assignments yet (that table does not exist here), so it is a function an
-- admin can call and the offboarding checklist can point at.
create or replace function revoke_all_credential_grants(p_user uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $rv$
declare n integer;
begin
  if not is_admin() then raise exception 'Only an admin may revoke grants.'; end if;
  delete from credential_grants where user_id = p_user and workspace_id = my_workspace();
  get diagnostics n = row_count;
  -- Everything they could open should now be rotated. Flagged, not assumed:
  -- revoking access cannot un-know a password they already read.
  update credentials set rotated_at = null
   where workspace_id = my_workspace()
     and id in (select credential_id from credential_access_log where user_id = p_user);
  return n;
end $rv$;

comment on table credentials is
  'Ciphertext only. The key is derived in the browser from a workspace passphrase and never reaches this database. Losing the passphrase means losing these rows.';
