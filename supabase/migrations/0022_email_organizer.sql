-- 0022_email_organizer.sql. Team-wide email organizer, driven by n8n.
--
-- What this enables: a scheduled n8n workflow walks EVERY member who has
-- connected Google, pulls their new inbox mail into `messages`, and files each
-- one under an existing `message_category` (urgent | reply | delegate | archive).
-- Nothing is written back to Gmail, the real inbox is untouched, so the
-- read-only OAuth scopes already in google-oauth-url stay sufficient.
--
-- Three things were missing for that:
--   A) somewhere to record WHY a message was filed, and a way for a human's
--      decision to outrank the robot's for good,
--   B) a per-mailbox sync cursor so each run picks up where the last stopped
--      (the existing gmail-sync just re-reads the newest 15 every time),
--   C) team-editable triage rules, so tuning the organizer doesn't mean editing
--      a workflow node.
--
-- Additive and idempotent. No enum change: adding a value to message_category
-- inside a migration transaction is a foot-gun, and the four existing values
-- cover the triage outcomes.

-- ============ A) triage metadata on messages ============
alter table messages add column if not exists triage_reason text;
alter table messages add column if not exists triage_source text;
alter table messages add column if not exists triage_confidence real;
alter table messages add column if not exists triaged_at timestamptz;

-- Bulk-mail signal (List-Unsubscribe header, or a Gmail CATEGORY_PROMOTIONS /
-- UPDATES / FORUMS label). Captured at fetch time and stored, because it comes
-- from Gmail rather than from the row. Without persisting it, any message that
-- gets retried on a later run would be judged without it.
alter table messages add column if not exists is_bulk boolean not null default false;

-- Set the moment a signed-in human re-files a message. The organizer treats a
-- locked row as untouchable, so a correction survives every later run.
alter table messages add column if not exists category_locked boolean not null default false;

alter table messages drop constraint if exists messages_triage_source_check;
alter table messages add constraint messages_triage_source_check
  check (triage_source is null or triage_source in ('rules', 'ai', 'manual'));

-- Belt to the Edge Function's braces. The function already skips locked rows,
-- but the lock is only trustworthy if the DB is what sets it: auth.uid() is
-- non-null exactly when a real member is driving, and null for every
-- service-role write, which is how the organizer's updates stay unlocked.
create or replace function lock_manual_category()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $lock$
begin
  if auth.uid() is not null and new.category is distinct from old.category then
    new.category_locked := true;
    new.triage_source := 'manual';
    new.triage_reason := 'Re-filed by a team member';
    new.triaged_at := now();
  end if;
  return new;
end $lock$;

drop trigger if exists messages_lock_manual_category on messages;
create trigger messages_lock_manual_category
  before update on messages
  for each row execute function lock_manual_category();

-- The organizer's hot path: "untriaged inbound mail for this mailbox".
create index if not exists messages_triage_queue_idx
  on messages (workspace_id, owner_id, triaged_at, received_at desc);

-- ============ B) per-mailbox sync cursor ============
--
-- One row per member with a Google connection. `last_internal_date` is Gmail's
-- own internalDate in epoch MILLIseconds for the newest message already pulled;
-- the fetch step turns it into an `after:` query term. Starting at 0 would drag
-- in years of backlog on first run, so a fresh row is seeded to "now" by the
-- Edge Function rather than defaulted here.
create table if not exists gmail_sync_state (
  owner_id uuid primary key references auth.users (id) on delete cascade,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  last_internal_date bigint not null default 0,
  last_synced_at timestamptz,
  last_status text,          -- 'ok' | 'error'
  last_error text,
  messages_seen int not null default 0,
  messages_triaged int not null default 0
);

alter table gmail_sync_state enable row level security;

-- Members can see the team's sync health (no tokens live here). Writes are
-- service-role only. There is deliberately no insert/update/delete policy, so
-- a member cannot rewind another member's cursor and force a re-pull.
drop policy if exists "ws read sync state" on gmail_sync_state;
create policy "ws read sync state" on gmail_sync_state for select
  using (workspace_id = my_workspace());

-- ============ C) team-editable triage rules ============
--
-- Rules run before the AI step: they are free, instant, and predictable, and
-- every message they catch is one the model never sees. `mailbox_owner_id` is
-- NOT authorship, it scopes a rule to one person's mailbox (null = whole team).
create table if not exists triage_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade default my_workspace(),
  mailbox_owner_id uuid references auth.users (id) on delete cascade,
  name text not null,
  match_type text not null,
  match_value text,
  category message_category not null,
  priority int not null default 100,   -- lower wins; first match stops evaluation
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

alter table triage_rules drop constraint if exists triage_rules_match_type_check;
alter table triage_rules add constraint triage_rules_match_type_check
  check (match_type in (
    'sender_email',           -- exact address, case-insensitive
    'sender_email_contains',  -- substring of the address
    'sender_domain',          -- everything after the @
    'subject_contains',       -- substring of the subject
    'is_newsletter',          -- bulk mail: List-Unsubscribe or a Gmail category label
    'is_client'               -- sender resolved to a row in `clients`
  ));

-- Rules that need a value must have one; the two predicate types must not.
alter table triage_rules drop constraint if exists triage_rules_match_value_check;
alter table triage_rules add constraint triage_rules_match_value_check
  check (
    case when match_type in ('is_newsletter', 'is_client')
      then match_value is null
      else match_value is not null and length(trim(match_value)) > 0
    end
  );

create index if not exists triage_rules_lookup_idx
  on triage_rules (workspace_id, enabled, priority);

alter table triage_rules enable row level security;
drop policy if exists "ws shared" on triage_rules;
create policy "ws shared" on triage_rules for all
  using (workspace_id = my_workspace())
  with check (workspace_id = my_workspace());

-- ---------- starter rule set ----------
-- Ordering is the whole design here. `is_client` sits ABOVE the archive rules on
-- purpose: if a client's address also trips the newsletter heuristic, the safe
-- failure is a needless "reply", never a buried client email.
do $seed$
declare w record;
begin
  for w in select id from workspaces loop
    if exists (select 1 from triage_rules where workspace_id = w.id) then
      continue;
    end if;
    insert into triage_rules (workspace_id, name, match_type, match_value, category, priority) values
      (w.id, 'Subject says urgent',      'subject_contains',      'urgent',    'urgent',  10),
      (w.id, 'Subject says ASAP',        'subject_contains',      'asap',      'urgent',  15),
      (w.id, 'Known client',             'is_client',             null,        'reply',   30),
      (w.id, 'Bulk / newsletter',        'is_newsletter',         null,        'archive', 40),
      (w.id, 'noreply sender',           'sender_email_contains', 'noreply',   'archive', 50),
      (w.id, 'no-reply sender',          'sender_email_contains', 'no-reply',  'archive', 55),
      (w.id, 'Automated notifications',  'sender_email_contains', 'notifications@', 'archive', 60);
  end loop;
end $seed$;
