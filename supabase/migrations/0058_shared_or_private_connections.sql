-- Let the member decide whose connection it is.
--
-- 0056 made every social connection workspace-wide, on the reasoning that a
-- Slack workspace belongs to the agency. That is true of the agency's Slack and
-- false of everything else somebody might connect: an EA who links their own
-- Instagram, or a client's Page they manage personally, has just published it
-- to the whole team without being asked.
--
-- The two are not distinguishable from the outside. Only the person pressing
-- Connect knows which one they are attaching, so they are the one asked.
--
--   owner_id null   shared. The agency's account: everyone sees it, everyone
--                   can work it, and it survives the person who installed it
--                   leaving.
--   owner_id set    private. Theirs, visible to them, exactly like their
--                   mailbox already is.
--
-- WHY NOT DEFAULT EVERYTHING TO PRIVATE AND BE SAFE. Because a shared inbox is
-- the product. A client's Slack that only one EA can see is a client nobody
-- covers when that EA is off, which is the failure this app exists to prevent.
-- Neither answer is right by default, which is precisely why it is a question.

alter table public.workspace_integrations
  add column if not exists owner_id uuid references auth.users (id) on delete cascade;

comment on column public.workspace_integrations.owner_id is
  'Null means shared with the workspace. Set means private to that person, like a mailbox. Chosen when the account is connected.';

/* The identity of an account now includes whose it is: the same Slack workspace
   can legitimately be attached once by the agency and once privately by
   somebody who wants it in their own view.

   NULLS NOT DISTINCT matters here. Without it Postgres treats every null
   owner_id as unique, so re-connecting the SHARED account would insert a second
   shared row instead of updating the first, and the team would end up with the
   same workspace listed twice and only one of them receiving. */
drop index if exists workspace_integrations_account_uniq;
create unique index if not exists workspace_integrations_account_uniq
  on public.workspace_integrations (workspace_id, provider, external_id, owner_id)
  nulls not distinct;

/* One default per provider PER OWNER, rather than per workspace. The shared
   accounts have one default between them; each person's private accounts have
   their own. A single workspace-wide default would mean connecting a private
   account could silently take over where the team's replies go. */
drop index if exists workspace_integrations_one_default;
create unique index if not exists workspace_integrations_one_default
  on public.workspace_integrations (workspace_id, provider, owner_id)
  nulls not distinct
  where is_default;

-- ── Who may see which ────────────────────────────────────────────────────
drop policy if exists "read workspace integrations" on public.workspace_integrations;
create policy "read workspace integrations" on public.workspace_integrations for select to authenticated
  using (
    workspace_id = my_workspace()
    and (owner_id is null or owner_id = auth.uid())
  );

/* Disconnecting: anyone may detach a SHARED account, because if the person who
   installed it has left the team must still be able to; nobody but its owner
   may detach a private one. */
drop policy if exists "disconnect workspace integrations" on public.workspace_integrations;
create policy "disconnect workspace integrations" on public.workspace_integrations for delete to authenticated
  using (
    workspace_id = my_workspace()
    and (owner_id is null or owner_id = auth.uid())
  );

drop policy if exists "set default integration" on public.workspace_integrations;
create policy "set default integration" on public.workspace_integrations for update to authenticated
  using (
    workspace_id = my_workspace()
    and (owner_id is null or owner_id = auth.uid())
  )
  with check (
    workspace_id = my_workspace()
    and (owner_id is null or owner_id = auth.uid())
  );

grant select (owner_id) on public.workspace_integrations to authenticated;

-- ── The messages that arrive through a private connection ────────────────
--
-- 0040 made privacy follow the SOURCE: gmail is personal, slack/discord/
-- whatsapp/instagram are shared channels the whole team should see. That was
-- right when a channel could only ever be the agency's. It stops being right
-- the moment somebody connects their own Instagram, because the source says
-- "instagram" and the rule says "show everyone", and the promise the connect
-- dialog just made is broken by the sync that follows it.
--
-- So the row carries the answer rather than the source implying it. The sync
-- functions set this when the connection they used was private, and a message
-- that came in through somebody's own account stays theirs.
alter table public.messages add column if not exists private boolean not null default false;

comment on column public.messages.private is
  'True when this arrived through a connection private to its owner. Shared-source messages (slack, discord, instagram, whatsapp) are team-readable only when this is false.';

drop policy if exists "messages readable by owner or whole team if shared" on public.messages;
create policy "messages readable by owner or whole team if shared"
  on public.messages for select
  using (
    workspace_id = my_workspace()
    and (
      owner_id = auth.uid()
      or (source in ('slack', 'discord', 'whatsapp', 'instagram') and not private)
    )
  );

drop policy if exists "messages update what you can read" on public.messages;
create policy "messages update what you can read"
  on public.messages for update
  using (
    workspace_id = my_workspace()
    and (
      owner_id = auth.uid()
      or (source in ('slack', 'discord', 'whatsapp', 'instagram') and not private)
    )
  );

-- ── The OAuth state carries the choice through the round trip ────────────
/* Decided when the flow starts, because that is when the person was asked, and
   the callback has no way to ask. */
alter table public.oauth_states add column if not exists private boolean not null default false;
