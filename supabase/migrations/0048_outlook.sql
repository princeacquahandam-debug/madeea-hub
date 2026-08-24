-- Outlook, the second mailbox. Same shape as Gmail, one deliberate difference.
--
-- WHY NOW. lib/channels.ts has said for months that Outlook is "the nearest to
-- being possible: the same shape as Gmail, which already works". Half the
-- people this product is sold to run Microsoft 365, and until this migration
-- the honest answer to "can I connect my work email" was no unless it was
-- Gmail. Everything downstream of the mailbox (Inbox, triage, follow-up SLA,
-- the EOD) is already source-agnostic, so what was missing was the plumbing,
-- not the product.
--
-- ── THE ONE DELIBERATE DIFFERENCE FROM GOOGLE ────────────────────────────
-- google-oauth-callback files tokens under the user named by the OAuth state
-- row, and defends the obvious attack on that (mint a state, send the link to
-- a victim, receive the victim's tokens under your own owner_id) by demanding
-- that the consenting Google address EQUAL the MadeEA login email.
--
-- That check cannot be reused here, because it would make the feature useless.
-- People log into MadeEA with one address and read mail at another: a Gmail
-- login and an Outlook work mailbox is the normal case, not the exception, and
-- an integration that only connects a mailbox whose address you already sign in
-- with connects almost nobody.
--
-- So Microsoft closes the same hole from the other end. The callback cannot
-- authenticate anyone (Microsoft sends the browser here with no bearer token),
-- so it does not decide ownership at all: it parks the tokens in
-- microsoft_oauth_pending and hands the browser a claim code. The app, where
-- the user IS authenticated, exchanges that code, and microsoft-oauth-claim
-- files the tokens only if the caller is the same user who started the flow.
--
--   normal flow      same person both ends            -> connected, any address
--   lure attack      victim consents, attacker claims -> refused, tokens dropped
--   leaked code      anyone else presents it          -> refused, tokens dropped
--
-- The result is strictly tighter than the email match (a stolen code is useless
-- rather than merely inconvenient) and it drops the address restriction. Google
-- could be moved onto this later; it is not moved here, because rewriting a
-- working auth path is a separate change with its own blast radius.

-- ── 1. Where Microsoft tokens live ───────────────────────────────────────
-- Mirrors google_credentials, including the column-privilege trick from 0016:
-- RLS is row-level and cannot hide a column, so the browser is granted select
-- on the non-secret columns only and never sees a token.
create table if not exists public.microsoft_credentials (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users (id) on delete cascade,
  -- Nullable for the same reason as Google's: a reconnect does not always
  -- return a fresh refresh_token, and the old one must survive that.
  refresh_token text,
  access_token text,
  token_expiry timestamptz,
  scopes text,
  /* WHICH MAILBOX THIS IS. google_credentials has no equivalent column and does
     not need one: there, the connected account is by definition the login
     email. Here the two routinely differ, so without this the Integrations page
     could say "connected" but not say connected to WHAT, and an EA with two
     Microsoft accounts would have no way to tell which one they authorised. */
  account_email text,
  connected_at timestamptz not null default now()
);

alter table public.microsoft_credentials enable row level security;

revoke all on public.microsoft_credentials from anon, authenticated;
grant select (owner_id, connected_at, scopes, token_expiry, account_email)
  on public.microsoft_credentials to authenticated;
grant delete on public.microsoft_credentials to authenticated;

drop policy if exists "read own connection" on public.microsoft_credentials;
create policy "read own connection" on public.microsoft_credentials for select to authenticated
  using (owner_id = auth.uid());
drop policy if exists "disconnect own" on public.microsoft_credentials;
create policy "disconnect own" on public.microsoft_credentials for delete to authenticated
  using (owner_id = auth.uid());
-- No insert/update policy. Only microsoft-oauth-claim (service role) writes tokens.

-- ── 2. The parking bay between consent and ownership ─────────────────────
-- Short-lived, single-use, service-role only. A row here is a set of tokens
-- that nobody owns yet. It is deleted the moment it is claimed, refused, or
-- swept, so the window in which an unowned token exists is minutes.
create table if not exists public.microsoft_oauth_pending (
  claim uuid primary key default gen_random_uuid(),
  /* Who STARTED the flow. The claim is checked against this, which is the
     whole security property: consenting does not decide ownership, and neither
     does holding the code. Both must agree. */
  user_id uuid not null references auth.users (id) on delete cascade,
  refresh_token text,
  access_token text,
  token_expiry timestamptz,
  scopes text,
  account_email text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes'
);
alter table public.microsoft_oauth_pending enable row level security;  -- no policies: service-role only
revoke all on public.microsoft_oauth_pending from anon, authenticated;

-- ── 3. oauth_states learns which provider it belongs to ──────────────────
-- The two callbacks are separate endpoints, so this is not what keeps them
-- apart; it is what stops a state minted for one provider being spent at the
-- other. Defaulting to 'google' leaves every existing row correct.
alter table public.oauth_states add column if not exists provider text not null default 'google';
alter table public.oauth_states drop constraint if exists oauth_states_provider_check;
alter table public.oauth_states add constraint oauth_states_provider_check
  check (provider in ('google', 'microsoft'));

comment on column public.oauth_states.expected_email is
  'Google only: the callback requires the consenting address to equal this. Null for Microsoft, which binds identity at claim time instead (see 0048).';

-- ── 4. Messages gain Outlook's id ───────────────────────────────────────
-- Not reusing gmail_id. They are different namespaces from different servers,
-- and one column holding either would make "which mailbox is this from" a
-- question about the source column rather than a fact about the id. It is also
-- what a reply needs: Graph threads a reply by replying to a message BY ID.
alter table public.messages add column if not exists outlook_id text;

comment on column public.messages.outlook_id is
  'Microsoft Graph message id. Used to upsert idempotently and to reply in-thread via /messages/{id}/createReply. Not interchangeable with gmail_id or rfc_message_id.';

-- NULLs are distinct in Postgres, so manual and Gmail rows (outlook_id null)
-- coexist freely under this. Same trick as messages_gmail_uniq in 0005.
create unique index if not exists messages_outlook_uniq
  on public.messages (workspace_id, outlook_id);
