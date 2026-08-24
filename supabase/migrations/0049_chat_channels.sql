-- Discord and Teams: the two chat channels that were actually reachable.
--
-- WHAT THIS IS AND IS NOT. The Integrations grid listed five channels as
-- "Coming later". They are not one job wearing five names, and this migration
-- covers the two that a person can switch on this week:
--
--   Discord   a bot token and an invite. The same shape as Slack, which works.
--   Teams     Microsoft Graph, on the credential 0048 already stores. Chats
--             read and reply with ordinary user consent.
--
-- The other three are not here, and not because they were forgotten:
--
--   Instagram  needs a Meta app with instagram_manage_messages and Meta App
--              Review for Advanced Access. Code cannot grant that.
--   WhatsApp   needs a verified Meta Business, a dedicated number, and Cloud
--              API approval. It also has NO history endpoint: inbound arrives
--              by webhook only, so "sync" is the wrong shape for it entirely.
--   LinkedIn   publishes no messaging API. Partner Program access is
--              invite-only and routinely refused. There is no route to build.
--
-- Recording that here rather than in a ticket, because the next person to ask
-- "why are only two of the five done" deserves the real answer.

-- ── Message ids, one namespace per provider ──────────────────────────────
-- Same reasoning as outlook_id in 0048: these come from different servers and
-- cannot be pooled into one column without making "which service is this from"
-- a question about `source` rather than a fact about the id. Each is also the
-- upsert key that makes a re-sync idempotent instead of duplicating a channel.
alter table public.messages add column if not exists discord_id text;
alter table public.messages add column if not exists teams_id text;

comment on column public.messages.discord_id is
  'Discord snowflake message id. Upsert key for discord-sync. thread_id holds the channel id, which is what a reply is posted back to.';
comment on column public.messages.teams_id is
  'Microsoft Graph chatMessage id. Upsert key for teams-sync. thread_id holds the chat id, which is what a reply is posted back to.';

-- NULLs are distinct in Postgres, so every row from another source coexists
-- freely under these. Same trick as messages_gmail_uniq (0005) and
-- messages_outlook_uniq (0048).
create unique index if not exists messages_discord_uniq
  on public.messages (workspace_id, discord_id);
create unique index if not exists messages_teams_uniq
  on public.messages (workspace_id, teams_id);
