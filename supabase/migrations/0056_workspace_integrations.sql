-- Connect by signing in, not by pasting a token into a dashboard.
--
-- WHAT WAS WRONG WITH THE OLD MODEL. Slack, Discord, Instagram and WhatsApp
-- were configured by putting a bot token or a Page token into Supabase secrets.
-- That works, and it is the wrong shape for a product: it means the only person
-- who can connect a channel is whoever has the Supabase dashboard, the token is
-- copied through a chat window on its way there, rotating it is a deploy, and
-- the app can never say WHICH workspace or page it is attached to because a
-- secret is an opaque string.
--
-- These providers all publish an OAuth install flow. Pressing Connect and
-- signing in does the same job, and does it better: the person authorising is
-- the person who owns the account, the token arrives over TLS instead of
-- through a chat, it carries the workspace and account names with it, and
-- revoking is a click on their side rather than a deploy on ours.
--
-- ── WHY THIS IS PER WORKSPACE AND NOT PER PERSON ─────────────────────────
--
-- google_credentials and microsoft_credentials are per person, because a
-- mailbox belongs to a person: your Gmail is yours and nobody else should read
-- it. A Slack workspace, a Discord server and an Instagram business account are
-- the opposite. They belong to the agency, everyone works them, and a
-- connection that only its installer could use would go cold the day they are
-- off. So one row per provider per workspace, and any member can use it.
--
-- That is also why the messages from these channels are readable by the whole
-- team under 0040/0051, and the mail is not.
create table if not exists public.workspace_integrations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default my_workspace() references public.workspaces (id) on delete cascade,
  /* 'meta' is one row covering Instagram and WhatsApp, because it is one
     Facebook login: the same token carries the Page, the Instagram account
     attached to it and the WhatsApp number. Splitting them would mean signing
     in twice for one consent. */
  provider text not null check (provider in ('slack', 'discord', 'meta', 'linkedin')),

  access_token text,
  refresh_token text,
  token_expiry timestamptz,
  scopes text,

  /* What the person sees on the card. The whole point of an install flow over
     a pasted secret: a token cannot tell you which workspace it belongs to,
     and this can. */
  account_label text,
  /* The provider's own id for the thing installed: a Slack team, a Discord
     guild, a Facebook Page. */
  external_id text,
  /* Non-secret extras a provider needs at call time: the Instagram business
     account id, the WhatsApp phone number id, the bot user id. Readable by the
     browser, so NOTHING that can be used as a credential goes in here. */
  details jsonb not null default '{}'::jsonb,

  connected_by uuid references auth.users (id) on delete set null,
  connected_at timestamptz not null default now(),

  unique (workspace_id, provider)
);

alter table public.workspace_integrations enable row level security;

/* Column privileges, the same trick as 0016 and 0048: RLS is row-level and
   cannot hide a column, so the browser is granted select on everything EXCEPT
   the three token columns. The card can say "connected as @madeea" and can
   never read what makes that work. */
revoke all on public.workspace_integrations from anon, authenticated;
grant select (id, workspace_id, provider, account_label, external_id, details, connected_by, connected_at, scopes)
  on public.workspace_integrations to authenticated;
grant delete on public.workspace_integrations to authenticated;

drop policy if exists "read workspace integrations" on public.workspace_integrations;
create policy "read workspace integrations" on public.workspace_integrations for select to authenticated
  using (workspace_id = my_workspace());

/* Disconnect is any member, deliberately. These are shared channels: if the
   person who installed Slack has left, the team must still be able to detach
   it, and an admin-only rule would make that a support request. */
drop policy if exists "disconnect workspace integrations" on public.workspace_integrations;
create policy "disconnect workspace integrations" on public.workspace_integrations for delete to authenticated
  using (workspace_id = my_workspace());

-- No insert/update policy. Only the OAuth callback (service role) writes tokens.

-- ── The OAuth state learns the other four providers ──────────────────────
alter table public.oauth_states drop constraint if exists oauth_states_provider_check;
alter table public.oauth_states add constraint oauth_states_provider_check
  check (provider in ('google', 'microsoft', 'slack', 'discord', 'meta', 'linkedin'));

/* Which workspace the install belongs to, decided when the flow STARTS, while
   the caller is still authenticated. The callback runs as the service role with
   no session, so my_workspace() returns null there: without this column it
   would have to guess, and a shared channel filed into the wrong workspace is
   one agency reading another's messages. */
alter table public.oauth_states add column if not exists workspace_id uuid references public.workspaces (id) on delete cascade;

/* Whether the browser is in a popup. A popup callback must answer with a page
   that talks to its opener and closes; a full-page one must answer with a 302.
   Sending the wrong one strands the user on a blank tab, so the flow records
   which it is rather than the callback guessing from a header. */
alter table public.oauth_states add column if not exists popup boolean not null default false;
