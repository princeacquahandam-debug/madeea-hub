-- 0105_no_plaintext_oauth_tokens.sql. Wipe the plain-text OAuth tokens.
--
-- Run in the Supabase SQL editor (madeea-hub project) ONLY AFTER the updated
-- Edge Functions are deployed (integration-oauth-callback, gmail-send,
-- calendar-sync, calendar-create-event, client-mail, n8n-inbox-triage,
-- outlook-calendar-sync, outlook-send, outlook-sync, teams-send, teams-sync).
-- Run before them, and the old code would still be reading these columns.
-- Safe to run again.
--
-- Found in the 19 Nov 2026 security pre-check for Google's CASA assessment.
-- Since 0058, Google and Microsoft tokens are stored in `integrations` as
-- AES-256-GCM ciphertext with the key outside the database. But the sign-in
-- also kept writing a PLAIN-TEXT copy of the refresh and access tokens into
-- google_credentials and microsoft_credentials, and ten functions still read
-- that copy. Those functions now read the encrypted row. On 19 Nov there were
-- 6 Google plain-text copies, all of them also present encrypted, so nobody
-- has to reconnect.
--
-- The rows stay: the app reads their non-secret columns (connected_at, scopes,
-- account_email) for the connection cards, and 0093's PostHog trigger listens
-- to them. Only the token columns are emptied, and a CHECK makes sure nothing
-- (including the retired google-oauth-callback / microsoft-oauth-claim
-- functions, if anything ever called them) can put a token back.

update public.google_credentials
   set refresh_token = null, access_token = null, token_expiry = null
 where refresh_token is not null or access_token is not null;

update public.microsoft_credentials
   set refresh_token = null, access_token = null, token_expiry = null
 where refresh_token is not null or access_token is not null;

alter table public.google_credentials drop constraint if exists google_credentials_no_plaintext_tokens;
alter table public.google_credentials add constraint google_credentials_no_plaintext_tokens
  check (refresh_token is null and access_token is null);

alter table public.microsoft_credentials drop constraint if exists microsoft_credentials_no_plaintext_tokens;
alter table public.microsoft_credentials add constraint microsoft_credentials_no_plaintext_tokens
  check (refresh_token is null and access_token is null);

-- What is left (should be 0 and 0):
select (select count(*) from public.google_credentials where refresh_token is not null or access_token is not null) as google_plain_text,
       (select count(*) from public.microsoft_credentials where refresh_token is not null or access_token is not null) as microsoft_plain_text;
