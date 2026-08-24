-- 0024_dm_setter.sql — DM Setter: the outbound mirror of the Ads Setter.
--
-- Ads Setter is inbound (they clicked, then we qualify). DM Setter is outbound
-- (we open cold, then we qualify). Everything after the first message is
-- identical — score, thread, book or release — so this extends 0023's tables
-- rather than standing up a parallel set. One pipeline means one board, one set
-- of stages, and one conversation UI instead of two that drift apart.
--
-- Safe to run: 0023 shipped hours ago with no rows, so the dedupe key can be
-- rebuilt rather than migrated around.

-- ---------- campaigns become "outreach programs" ----------
-- The table keeps its name: renaming would churn every reference in freshly
-- shipped code for a cosmetic gain. `kind` is what actually distinguishes them.
alter table ad_campaigns add column if not exists kind text not null default 'ads';
alter table ad_campaigns add column if not exists channel text;
alter table ad_campaigns add column if not exists openers jsonb not null default '[]'::jsonb;
alter table ad_campaigns add column if not exists follow_ups jsonb not null default '[]'::jsonb;

alter table ad_campaigns drop constraint if exists ad_campaigns_kind_check;
alter table ad_campaigns add constraint ad_campaigns_kind_check
  check (kind in ('ads', 'dm'));

-- A DM program has a channel and no ad platform; an ads campaign is the reverse.
-- Left nullable rather than defaulted, so "not set" stays distinguishable.
alter table ad_campaigns drop constraint if exists ad_campaigns_channel_check;
alter table ad_campaigns add constraint ad_campaigns_channel_check
  check (channel is null or channel in ('instagram', 'linkedin', 'x', 'facebook'));

create index if not exists ad_campaigns_kind_idx on ad_campaigns (workspace_id, kind, created_at desc);

-- ---------- leads gain a social identity ----------
alter table ad_leads add column if not exists handle text;
alter table ad_leads add column if not exists channel text;

alter table ad_leads drop constraint if exists ad_leads_channel_check;
alter table ad_leads add constraint ad_leads_channel_check
  check (channel is null or channel in ('instagram', 'linkedin', 'x', 'facebook'));

-- Rebuild the dedupe key to know about handles.
--
-- This is the load-bearing change. The 0023 key fell back to the NAME when there
-- was no email or phone — which is every DM prospect. Two different people called
-- "John Smith" would have collided into one row and one merged conversation, and
-- `ignoreDuplicates` would have silently dropped the second person. A handle is a
-- real unique identity, so it belongs above the name in the fallback chain.
alter table ad_leads drop column if exists dedupe_key;
alter table ad_leads add column dedupe_key text
  generated always as (
    lower(coalesce(
      nullif(trim(email), ''),
      nullif(trim(phone), ''),
      nullif(trim(handle), ''),
      name
    ))
  ) stored;

create unique index if not exists ad_leads_dedupe_uniq on ad_leads (workspace_id, dedupe_key);
