-- What a reply needs, and none of which was being kept.
--
-- The Communication Center could compose a new email but not reply to one, and
-- the missing pieces were in the data rather than the screen.
--
-- THREADING. A reply threads in Gmail only if it carries the original's
-- Message-ID in its In-Reply-To and References headers. That id was never read
-- off the incoming message, so any reply we sent would have landed in the
-- recipient's inbox as a brand new conversation with "Re:" in the subject: it
-- looks like a reply to a person and is a separate thread to every mail client,
-- which is how a conversation gets split in half.
--
-- Note this is the RFC 2822 Message-ID (a global string like
-- <CAB...@mail.gmail.com>), not `gmail_id`, which is Gmail's own per-mailbox
-- identifier and is meaningless to anyone else's mail server. Both are needed
-- and they are not interchangeable.
--
-- REPLY ALL. You cannot reply to everyone if you never recorded who everyone
-- was. gmail-sync asked Gmail for the From, Subject and Date headers only, so
-- the other recipients were discarded on the way in.
--
-- Stored as arrays, parsed once at sync time. The alternative is re-parsing a
-- raw header string in the browser every render, and address lists are exactly
-- the kind of thing that looks trivial to split on commas until a display name
-- contains one: `"Petran, Rowena" <r@x.com>`.

alter table public.messages
  add column if not exists rfc_message_id text,
  add column if not exists to_emails text[],
  add column if not exists cc_emails text[];

comment on column public.messages.rfc_message_id is
  'RFC 2822 Message-ID of the original. Goes into In-Reply-To/References so a reply threads. Not the same as gmail_id.';

-- Looking a reply up by what it answers, when a thread is reassembled.
create index if not exists messages_rfc_message_id_idx
  on public.messages (rfc_message_id)
  where rfc_message_id is not null;

-- thread_id already existed and was never populated. Worth an index now that
-- the reading pane groups by it.
create index if not exists messages_thread_id_idx
  on public.messages (thread_id)
  where thread_id is not null;
