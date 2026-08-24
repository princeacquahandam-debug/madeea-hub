-- Instagram and WhatsApp: the two Meta channels, and the column they both need.
--
-- WHY THESE TWO ARE SHAPED DIFFERENTLY FROM EVERY OTHER CHANNEL.
--
-- Gmail, Outlook, Slack, Discord and Teams all answer the same question: "give
-- me the recent messages". Meta's two do not agree with each other, let alone
-- with those five.
--
--   Instagram  HAS a read API. /{page}/conversations?platform=instagram lists
--              threads and their messages, so it syncs like the others.
--   WhatsApp   has NO endpoint for past messages. None. The Cloud API delivers
--              inbound by webhook and that is the only way a message ever
--              arrives. "Sync WhatsApp" is not a thing that can exist, so the
--              integration is a webhook receiver rather than a puller, and the
--              card says so instead of offering a button that cannot work.
--
-- WHAT A REPLY IS ADDRESSED TO, which is the reason for the new column.
--
-- Every channel so far replies to something already on the row: an email
-- address, a channel id in thread_id, a Graph chat id. Meta's are neither. An
-- Instagram reply goes to an IGSID, a per-app scoped user id that is not the
-- handle and cannot be derived from it. A WhatsApp reply goes to a wa_id, which
-- looks like a phone number and is not one you can dial.
--
-- Neither belongs in sender_email: putting a phone number in a column every
-- other screen treats as an address is how a reply eventually gets composed to
-- "639171234567" in a mail client. So they get their own column, named for what
-- it is for rather than for what it contains.
alter table public.messages add column if not exists instagram_id text;
alter table public.messages add column if not exists whatsapp_id text;
alter table public.messages add column if not exists reply_target text;

comment on column public.messages.instagram_id is
  'Instagram (Messenger API) message id. Upsert key for instagram-sync.';
comment on column public.messages.whatsapp_id is
  'WhatsApp Cloud API message id (wamid.*). Upsert key for the webhook, which is the only way a WhatsApp message ever arrives.';
comment on column public.messages.reply_target is
  'The provider-specific handle a reply is addressed to: an Instagram IGSID, a WhatsApp wa_id. NOT an email address and not interchangeable with sender_email.';

-- NULLs are distinct in Postgres, so rows from every other source coexist under
-- these. Same trick as messages_gmail_uniq (0005) onwards.
create unique index if not exists messages_instagram_uniq
  on public.messages (workspace_id, instagram_id);
create unique index if not exists messages_whatsapp_uniq
  on public.messages (workspace_id, whatsapp_id);

-- ── Where an unauthenticated inbound message lands ───────────────────────
--
-- Every other writer of `messages` runs as a signed-in person, so owner_id and
-- workspace_id fall out of the defaults (auth.uid() and my_workspace(), 0003).
-- A WhatsApp webhook has no signed-in person: Meta's servers POST to it, and it
-- runs as the service role, for which both defaults are null. Something has to
-- decide whose workspace an inbound message belongs to.
--
-- This function is that decision, in one place rather than inlined in a
-- function where nobody would find it. It returns the workspace's oldest admin,
-- which under the single shared workspace this product runs on is the account
-- that set it up. If the deployment ever holds more than one workspace, the
-- webhook must be told which one explicitly (INBOUND_WORKSPACE_ID) rather than
-- guessing, so this returns nothing and the webhook says so out loud.
create or replace function public.inbound_message_owner()
returns table (workspace_id uuid, owner_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select m.workspace_id, m.user_id
  from public.memberships m
  where (select count(*) from public.workspaces) = 1
  order by (m.role = 'admin') desc, m.created_at asc
  limit 1
$$;

comment on function public.inbound_message_owner is
  'Who an unauthenticated inbound message (WhatsApp webhook) is filed under. Returns nothing when the deployment has more than one workspace, so the caller must be told explicitly rather than guessing.';

-- Callable only by the service role: this is for webhooks, and a browser has no
-- business asking who the fallback owner is.
revoke all on function public.inbound_message_owner() from public, anon, authenticated;
