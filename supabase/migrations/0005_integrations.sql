-- 0005_integrations.sql. Google (Gmail + Calendar) OAuth + sync support.

-- short-lived OAuth state (written/read by Edge Functions via service role)
create table oauth_states (
  state uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  redirect_to text,
  created_at timestamptz not null default now()
);
alter table oauth_states enable row level security;  -- no policies: service-role only

-- cache the live access token alongside the refresh token
alter table google_credentials add column access_token text;
alter table google_credentials add column token_expiry timestamptz;
-- a reconnect may not return a fresh refresh_token; keep the old one
alter table google_credentials alter column refresh_token drop not null;

-- upsert keys for idempotent syncs (NULLs are distinct in PG, so manual rows
-- without an external id still coexist freely)
create unique index messages_gmail_uniq on messages (workspace_id, gmail_id);
create unique index meetings_gcal_uniq on meetings (workspace_id, gcal_event_id);
