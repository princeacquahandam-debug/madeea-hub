-- Every connection belongs to the person who authorised it.
--
-- ── WHAT WAS WRONG ───────────────────────────────────────────────────────
--
-- Two architectures had grown side by side.
--
--   google_credentials, microsoft_credentials   keyed on owner_id. Per person,
--     which is correct: your Gmail is yours. These already did the right thing.
--
--   workspace_integrations (0056)               keyed on workspace + provider.
--     One Slack for the whole team, one Instagram, one WhatsApp. That is the
--     shape this migration exists to remove: it means the second person to
--     press Connect overwrites the first, and every member sends through
--     whichever account happened to be attached last.
--
-- The rule now, for every provider without exception: a connection is
-- identified by the workspace, the person, the provider AND the third-party
-- account. Four columns, because three of them are not enough — one person may
-- legitimately hold two Slack accounts, and two people may hold the same one.
--
-- ── WHAT THIS IS NOT ─────────────────────────────────────────────────────
--
-- Not a second auth system. Workspaces are `workspaces`, membership is
-- `memberships`, identity is auth.users, and this reuses all three rather than
-- inventing workspace_members beside the memberships table that already exists.
--
-- ── TOKENS ARE ENCRYPTED AT REST ─────────────────────────────────────────
--
-- 0016 hid tokens from the browser with column privileges, which is real but
-- partial: anything holding the service role, and anything that can read a
-- backup, still read them in the clear. They are now AES-256-GCM ciphertext
-- with the key in a server-only environment variable, so the database alone is
-- not enough to use them.

-- ── 1. The provider registry ─────────────────────────────────────────────
-- Which integrations exist and whether they are switched on, separate from
-- anybody's credentials. Nothing customer-specific lives here.
create table if not exists public.integration_providers (
  slug text primary key,
  name text not null,
  auth_type text not null default 'oauth2' check (auth_type in ('oauth2', 'api_key', 'bot_token')),
  /* False means the app knows about it and cannot connect it. LinkedIn's
     messaging is the case this exists for: a card that says "not available" is
     the truth, and a Connect button that fails after the login screen is not. */
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.integration_providers (slug, name, auth_type, enabled) values
  ('google',    'Google',    'oauth2', true),
  ('microsoft', 'Microsoft', 'oauth2', true),
  ('slack',     'Slack',     'oauth2', true),
  ('discord',   'Discord',   'oauth2', true),
  ('meta',      'Meta',      'oauth2', true),
  ('linkedin',  'LinkedIn',  'oauth2', true)
on conflict (slug) do nothing;

grant select on public.integration_providers to authenticated;
alter table public.integration_providers enable row level security;
drop policy if exists "read providers" on public.integration_providers;
create policy "read providers" on public.integration_providers for select to authenticated using (true);

-- ── 2. The connections ───────────────────────────────────────────────────
create table if not exists public.integrations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  /* The person who authorised it. Not nullable, and there is deliberately no
     "shared" value: a connection nobody owns is a connection nobody can be
     asked about when it breaks, and it is exactly the model this replaces. */
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null references public.integration_providers (slug),

  /* The third-party account's own id. Part of the identity, so one person may
     hold two Slack workspaces without the second overwriting the first. */
  provider_account_id text not null,
  provider_account_name text,
  provider_email text,

  status text not null default 'connected'
    check (status in ('connected', 'disconnected', 'error', 'reauth_required', 'pending')),

  /* Ciphertext, not tokens. AES-256-GCM, base64(iv || ciphertext || tag), with
     the key in INTEGRATION_ENCRYPTION_KEY and never in the database. */
  access_token_encrypted text,
  refresh_token_encrypted text,
  token_expires_at timestamptz,
  scopes text,

  /* Non-secret things a provider needs at call time: a Facebook page id, a
     WhatsApp phone number id, a Slack team id. Readable by the browser, so
     nothing that functions as a credential goes in here. */
  metadata jsonb not null default '{}'::jsonb,

  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

/* THE CONSTRAINT THIS MIGRATION EXISTS FOR.
   Four columns. workspace_id + provider alone would be the old bug; adding
   user_id alone would stop one person holding two accounts with the same
   provider, which is a real thing an EA covering two clients does. */
create unique index if not exists integrations_identity_uniq
  on public.integrations (workspace_id, user_id, provider, provider_account_id);

create index if not exists integrations_workspace_idx on public.integrations (workspace_id);
create index if not exists integrations_user_idx on public.integrations (user_id);
create index if not exists integrations_provider_idx on public.integrations (provider);
create index if not exists integrations_scope_idx on public.integrations (workspace_id, user_id, provider);
create index if not exists integrations_status_idx on public.integrations (status);

alter table public.integrations enable row level security;

/* Column privileges as well as row policies, because RLS cannot hide a column.
   The browser may read what a card needs to render and is not granted select
   on the three token columns at all: not "policy-protected", unreachable. */
revoke all on public.integrations from anon, authenticated;
grant select (
  id, workspace_id, user_id, provider,
  provider_account_id, provider_account_name, provider_email,
  status, scopes, metadata, last_sync_at, last_error, created_at, updated_at
) on public.integrations to authenticated;
grant delete on public.integrations to authenticated;

/* YOUR OWN, IN YOUR OWN WORKSPACE. Both halves are required: workspace alone
   would let a colleague read your tokens' metadata, and user alone would let a
   connection follow you into a workspace you have left. */
drop policy if exists "read own integrations" on public.integrations;
create policy "read own integrations" on public.integrations for select to authenticated
  using (workspace_id = my_workspace() and user_id = auth.uid());

drop policy if exists "disconnect own integrations" on public.integrations;
create policy "disconnect own integrations" on public.integrations for delete to authenticated
  using (workspace_id = my_workspace() and user_id = auth.uid());

-- No insert/update policy: only the OAuth callback (service role) writes these.

-- ── 3. What happened, and to whom ────────────────────────────────────────
create table if not exists public.integration_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  integration_id uuid references public.integrations (id) on delete set null,
  action text not null,
  status text not null default 'success' check (status in ('success', 'failure')),
  /* A reason, never a credential. The functions that write this log an error
     code and a provider message; tokens and authorization codes never reach it. */
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists integration_logs_scope_idx
  on public.integration_logs (workspace_id, user_id, created_at desc);

alter table public.integration_logs enable row level security;
revoke all on public.integration_logs from anon, authenticated;
grant select on public.integration_logs to authenticated;

/* Your own history. An admin debugging somebody else's failed connection reads
   it through a service-role path with the person's knowledge, not by browsing
   the table: "who connected what and when" is a question about a person. */
drop policy if exists "read own integration logs" on public.integration_logs;
create policy "read own integration logs" on public.integration_logs for select to authenticated
  using (workspace_id = my_workspace() and user_id = auth.uid());

-- ── 4. The OAuth handshake ───────────────────────────────────────────────
/* The state is stored HASHED. The row is looked up by the hash of what the
   provider hands back, so a database read does not yield a usable state value,
   the same reasoning as never storing a password. */
alter table public.oauth_states add column if not exists state_hash text;
create index if not exists oauth_states_hash_idx on public.oauth_states (state_hash);
create index if not exists oauth_states_expiry_idx on public.oauth_states (expires_at);

/* PKCE. The verifier is encrypted with the same key as the tokens: it is a
   short-lived secret whose disclosure would let somebody else complete a
   half-finished authorisation. */
alter table public.oauth_states add column if not exists code_verifier_encrypted text;
alter table public.oauth_states add column if not exists redirect_after text;

-- ── 5. Carry the existing connections across ─────────────────────────────
--
-- Nothing is destroyed and nothing is left behind. The three old tables keep
-- working (ten Edge Functions still read them, and they are migrated in a later
-- step), and their rows are copied here so the new page shows the truth from
-- the moment it deploys.
--
-- Tokens are copied as NULL rather than as plaintext: this migration cannot
-- encrypt, having no access to the key, and writing a plaintext token into a
-- column whose contract says ciphertext would be a lie that a later reader acts
-- on. The rows arrive as reauth_required, which is honest: pressing Reconnect
-- once mints an encrypted credential.
insert into public.integrations
  (workspace_id, user_id, provider, provider_account_id, provider_email, status, scopes, created_at)
select
  m.workspace_id,
  g.owner_id,
  'google',
  coalesce(u.email, g.owner_id::text),
  u.email,
  'reauth_required',
  g.scopes,
  g.connected_at
from public.google_credentials g
join public.memberships m on m.user_id = g.owner_id
join auth.users u on u.id = g.owner_id
on conflict do nothing;

insert into public.integrations
  (workspace_id, user_id, provider, provider_account_id, provider_email, status, scopes, created_at)
select
  m.workspace_id,
  ms.owner_id,
  'microsoft',
  coalesce(ms.account_email, ms.owner_id::text),
  ms.account_email,
  'reauth_required',
  ms.scopes,
  ms.connected_at
from public.microsoft_credentials ms
join public.memberships m on m.user_id = ms.owner_id
on conflict do nothing;

/* The workspace-level rows become the connection of whoever installed them,
   which is the only honest answer available: nobody else authorised anything.
   A row with no connected_by is skipped rather than assigned to an arbitrary
   member. */
insert into public.integrations
  (workspace_id, user_id, provider, provider_account_id, provider_account_name, status, scopes, metadata, created_at)
select
  wi.workspace_id,
  wi.connected_by,
  wi.provider,
  coalesce(wi.external_id, wi.provider),
  wi.account_label,
  'reauth_required',
  wi.scopes,
  wi.details,
  wi.connected_at
from public.workspace_integrations wi
where wi.connected_by is not null
on conflict do nothing;

comment on table public.integrations is
  'One row per (workspace, person, provider, third-party account). Tokens are AES-256-GCM ciphertext; the key lives only in INTEGRATION_ENCRYPTION_KEY. Never keyed on workspace alone: see 0058.';
