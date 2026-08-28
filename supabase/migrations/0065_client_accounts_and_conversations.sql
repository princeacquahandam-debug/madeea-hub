-- Clients get accounts, and two channels: one the agency cannot read.
--
-- ═══ THE MISTAKE THIS MIGRATION EXISTS TO NOT MAKE ═══════════════════════
--
-- The obvious way to give a client a login is to invite them like anybody else:
-- a row in `memberships` with a new 'client' role. That would be a data breach
-- on the day it shipped, and it is worth spelling out why, because the next
-- person to read this will have the same instinct.
--
-- my_workspace() is `select workspace_id from memberships where user_id =
-- auth.uid()`. Thirty-three policies across twenty-seven tables are gated on
-- nothing but `workspace_id = my_workspace()`. A membership row is therefore
-- not "an account in the workspace"; it is a key to eod_reports, notes,
-- memories, files, projects, task_comments, credential_access_log, the staff
-- list in memberships, sla_settings and workspace_integrations, among others.
--
-- So a client is NOT a member. They authenticate through the same Supabase auth
-- and hold no membership row at all, which makes my_workspace() return NULL for
-- them, which makes every one of those thirty-three policies compare
-- `workspace_id = NULL` and deny. The isolation is the ABSENCE of a row rather
-- than a rule somebody has to maintain, and it fails closed for every table
-- added later that follows the same pattern.
--
-- npm run check:access proves it, against a real Postgres, table by table.
--
-- ═══ TWO CHANNELS, AND THE POINT IS THAT THEY DIFFER ═════════════════════
--
--   client_ea    the client and the assistant accountable for them.
--                NOT readable by admins, owners or managers. This is the
--                confidentiality promise, and it is enforceable here in a way
--                it never was for synced mail: the conversation lives in this
--                table rather than in somebody's Gmail.
--
--   escalation   the client and the agency's leads. This channel is the reason
--                the first one can be private: when the agency needs to reach a
--                client over the assistant's head, there is a door, and it is a
--                different door with its own name on it.
--
-- An EA cannot read the escalation channel either. That is deliberate and
-- symmetric: a client raising a problem about their assistant must not be
-- writing it where that assistant reads it.
--
-- ═══ WHAT THIS STILL DOES NOT PROTECT AGAINST ════════════════════════════
--
-- Screenshots. Capture photographs the whole monitor every ten minutes and
-- reviewers can see the images, so a client_ea conversation open on screen is
-- captured like anything else. No row-level rule reaches a picture. Turning
-- blur on, or exempting an assistant from capture, are the only two levers, and
-- both are settings rather than schema. Said here so nobody reads this file as
-- a guarantee it cannot make.
--
-- And the agency operates this database. These policies bind the application,
-- not whoever holds the service role key.

-- ---------------------------------------------------------------------------
-- 1. A client's login. Deliberately not a membership.
-- ---------------------------------------------------------------------------
create table if not exists client_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  client_id uuid not null references clients (id) on delete cascade,
  -- Which agency they belong to. Read by the policies below; never by
  -- my_workspace(), which only ever looks at memberships.
  workspace_id uuid not null references workspaces (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists client_users_client_idx on client_users (client_id);

alter table client_users enable row level security;

-- A client may confirm their own link and nothing else. Staff read the mapping
-- for their own workspace so the app can show who has an account.
drop policy if exists "client_users self read" on client_users;
create policy "client_users self read" on client_users for select to authenticated
  using (user_id = auth.uid() or workspace_id = my_workspace());

-- Writes are service-role only: handing a client account out is an agency act,
-- performed by the invite function, not something any signed-in party may do.

-- ---------------------------------------------------------------------------
-- 2. Helpers. security definer, because they read tables the caller cannot.
-- ---------------------------------------------------------------------------

/* The client this account speaks for, or NULL for staff. */
create or replace function public.my_client() returns uuid
  language sql stable security definer set search_path = public, pg_temp as $$
  select client_id from client_users where user_id = auth.uid() limit 1
$$;

/* Agency leadership: who may hold an escalation. Not every member — an EA is a
   member too, and the escalation channel is the one place they must not be. */
create or replace function public.is_agency_lead() returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select role in ('owner', 'admin', 'manager')
    from memberships where user_id = auth.uid() limit 1
  ), false)
$$;

-- ---------------------------------------------------------------------------
-- 3. The channels themselves.
-- ---------------------------------------------------------------------------
do $$ begin
  create type conversation_kind as enum ('client_ea', 'escalation');
exception when duplicate_object then null; end $$;

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  client_id uuid not null references clients (id) on delete cascade,
  kind conversation_kind not null,
  created_at timestamptz not null default now(),
  -- One of each per client. Threads within a channel are a later problem; a
  -- second escalation channel for the same client is only ever a bug.
  unique (client_id, kind)
);

create table if not exists conversation_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations (id) on delete cascade,
  -- Nullable so a departed account does not take the conversation with it. The
  -- record of what was said outlives the account that said it.
  sender_id uuid references auth.users (id) on delete set null default auth.uid(),
  body text not null check (length(btrim(body)) > 0),
  sent_at timestamptz not null default now()
);

create index if not exists conv_messages_conv_idx
  on conversation_messages (conversation_id, sent_at desc);

alter table conversations enable row level security;
alter table conversation_messages enable row level security;

-- ---------------------------------------------------------------------------
-- 4. Who may see a conversation. One function, so the two tables cannot drift.
-- ---------------------------------------------------------------------------
create or replace function public.can_see_conversation(conv uuid) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from conversations c
    join clients cl on cl.id = c.client_id
    where c.id = conv
      and (
        -- The client, on both of their own channels.
        (c.client_id = public.my_client())

        -- Their assistant, on the private channel only. lead_ea_id is "the EA
        -- accountable for this client" (0015). Reassigning a client therefore
        -- moves the history with the accountability, which is the behaviour the
        -- agency already expects everywhere else that field is used.
        or (c.kind = 'client_ea'
            and c.workspace_id = my_workspace()
            and cl.lead_ea_id = auth.uid())

        -- Agency leads, on the escalation channel only. Explicitly NOT on
        -- client_ea: that is the whole point of there being two.
        or (c.kind = 'escalation'
            and c.workspace_id = my_workspace()
            and public.is_agency_lead())
      )
  )
$$;

drop policy if exists "conversations visible to their parties" on conversations;
create policy "conversations visible to their parties" on conversations
  for select to authenticated
  using (public.can_see_conversation(id));

drop policy if exists "conversation messages follow the conversation" on conversation_messages;
create policy "conversation messages follow the conversation" on conversation_messages
  for select to authenticated
  using (public.can_see_conversation(conversation_id));

/* Write where you may read, and only as yourself. Sending as somebody else is
   the one forgery this schema can actually prevent, so it does. */
drop policy if exists "conversation messages sent as self" on conversation_messages;
create policy "conversation messages sent as self" on conversation_messages
  for insert to authenticated
  with check (public.can_see_conversation(conversation_id) and sender_id = auth.uid());

/* No update and no delete policy, so neither exists. A message that can be
   edited after the fact is not a record of what was said, and an escalation is
   exactly the conversation somebody would want to revise later. */

-- ---------------------------------------------------------------------------
-- 5. Both channels exist for every client, without anybody creating them.
-- ---------------------------------------------------------------------------
insert into conversations (workspace_id, client_id, kind)
select c.workspace_id, c.id, k.kind
from clients c
cross join (select unnest(enum_range(null::conversation_kind)) as kind) k
on conflict (client_id, kind) do nothing;

create or replace function public.seed_client_conversations() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into conversations (workspace_id, client_id, kind)
  select new.workspace_id, new.id, k.kind
  from (select unnest(enum_range(null::conversation_kind)) as kind) k
  on conflict (client_id, kind) do nothing;
  return new;
end $$;

drop trigger if exists clients_seed_conversations on clients;
create trigger clients_seed_conversations
  after insert on clients
  for each row execute function public.seed_client_conversations();
