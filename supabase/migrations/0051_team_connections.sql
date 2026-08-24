-- Two things a second teammate needs, and one bug the new channels introduced.
--
-- ── 1. Instagram is a SHARED channel, and 0040 does not know that yet ────
--
-- 0040 made message privacy follow the source, which was the right call: a
-- personal mailbox belongs to its owner, a channel belongs to the team. It
-- listed the shared sources explicitly so that anything unrecognised fails
-- closed, and said "by extension whatsapp and discord when they arrive".
--
-- Instagram arrived and is not in that list, so it is currently failing closed
-- exactly as designed. That is the wrong answer for it, and in two ways:
--
--   a. Instagram DMs arrive at the BUSINESS account. Whoever pressed Sync is
--      incidental, and under the current policy they become the only person who
--      can see a client's message. The next EA to look sees an empty channel.
--   b. Worse, the second person to sync gets an ERROR. instagram-sync upserts
--      on (workspace_id, instagram_id); the row already exists, so the upsert
--      becomes an update, and the update policy refuses it because they are not
--      the owner. The first syncer wins the channel permanently.
--
-- Outlook and Teams are deliberately NOT added. They are personal: one person's
-- mailbox and one person's chats, exactly like Gmail, and they are private for
-- the same reason Gmail is. The rule stays "shared by nature, not shared by
-- convenience".
drop policy if exists "messages readable by owner or whole team if shared" on public.messages;
create policy "messages readable by owner or whole team if shared"
  on public.messages for select
  using (
    workspace_id = my_workspace()
    and (
      owner_id = auth.uid()
      or source in ('slack', 'discord', 'whatsapp', 'instagram')
    )
  );

drop policy if exists "messages update what you can read" on public.messages;
create policy "messages update what you can read"
  on public.messages for update
  using (
    workspace_id = my_workspace()
    and (
      owner_id = auth.uid()
      or source in ('slack', 'discord', 'whatsapp', 'instagram')
    )
  );

-- ── 2. Who on the team has connected what ────────────────────────────────
--
-- Every mailbox connection is per person and always has been: RLS on
-- google_credentials and microsoft_credentials scopes both to owner_id =
-- auth.uid(), so each EA connects their own and cannot see anyone else's. That
-- part already worked.
--
-- What did not exist is any way to SEE it. An admin asking "has Rowena
-- connected her mail yet?" had no answer anywhere in the product: her
-- credential row is invisible to them by design, and the only team-wide view is
-- gmail_sync_state, which reports the n8n organiser's health and stays empty
-- until that schedule has run. So "connected but not yet organised" and "never
-- connected" looked identical, which is precisely the question being asked.
--
-- This function answers it and nothing more. It is SECURITY DEFINER because it
-- has to read past the per-owner RLS above, so what it may return matters:
--
--   returned      who the person is, which providers they connected, when, and
--                 the Outlook address (which differs from their login, so
--                 without it "connected" does not say connected to what)
--   NOT returned  refresh_token, access_token, or anything a token could be
--                 derived from. Not readable by the browser under 0016/0048
--                 either, and this does not become a way around that.
--
-- Scoped to the caller's own workspace, so it cannot enumerate another tenant.
create or replace function public.team_mail_connections()
returns table (
  user_id uuid,
  name text,
  login_email text,
  gmail_connected boolean,
  gmail_connected_at timestamptz,
  outlook_connected boolean,
  outlook_account text,
  outlook_connected_at timestamptz,
  teams_ready boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    m.user_id,
    coalesce(nullif(p.full_name, ''), split_part(u.email, '@', 1), 'Team member') as name,
    u.email as login_email,
    g.owner_id is not null as gmail_connected,
    g.connected_at as gmail_connected_at,
    ms.owner_id is not null as outlook_connected,
    ms.account_email as outlook_account,
    ms.connected_at as outlook_connected_at,
    /* Teams rides on the Microsoft consent, so "ready" is a question about the
       granted scopes rather than about a second connection. An account
       connected before Teams shipped shows Outlook yes, Teams no, which is the
       true state and the one that tells them to reconnect. */
    coalesce(ms.scopes like '%Chat.Read%', false) as teams_ready
  from public.memberships m
  join auth.users u on u.id = m.user_id
  left join public.profiles p on p.id = m.user_id
  left join public.google_credentials g on g.owner_id = m.user_id
  left join public.microsoft_credentials ms on ms.owner_id = m.user_id
  where m.workspace_id = public.my_workspace()
  order by 2
$$;

comment on function public.team_mail_connections is
  'Which teammates have connected which mailbox. Reads past per-owner RLS on purpose, and returns no token or anything a token can be derived from. Scoped to the caller''s workspace.';

-- Any member, not just admins. Knowing whether a colleague''s mail is connected
-- is the same class of fact as gmail_sync_state, which the whole team already
-- reads: it is about whether the tooling is set up, not about the contents of
-- anybody''s inbox. The messages themselves stay private under the policies
-- above, which this does not touch.
revoke all on function public.team_mail_connections() from public, anon;
grant execute on function public.team_mail_connections() to authenticated;
