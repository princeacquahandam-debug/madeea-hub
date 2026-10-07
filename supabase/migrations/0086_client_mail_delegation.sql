-- A client lets their lead EA handle their Outlook mail (Phase 2). 7 Oct 2026.
--
-- === WHY A SEPARATE TABLE, NOT `messages` ================================
--
-- Everything in the Hub reads `messages` with no owner filter and trusts RLS:
-- the Inbox, Dashboard, briefings, search, Madeline's list_emails tool, the
-- n8n triage, and run-automation, which bulk-UPDATEs rows to archive
-- newsletters. Widening messages RLS to show a client's mail to their EA
-- would pour it into every one of those, and let an automation rewrite it.
-- So the client's mail lives here, in its own table, read through one view
-- by one surface (the Client mailbox in the Hub Inbox). Nothing else in the
-- product can see it. Same reasoning as 0078's parallel tables.
--
-- === WHO ==================================================================
--
-- The client grants it to the EA who is their lead at the moment they say
-- yes (granted_to). If MadeEA changes their lead EA, access does NOT pass to
-- the new one: it stops until the client grants it again. A client agreed to
-- a person, not to a role. Admins are not included either; mail is narrower
-- than the calendar (0083).
--
-- === WHAT IS KEPT =========================================================
--
-- Headers and Graph's own preview, like outlook-sync. Full bodies are fetched
-- live when the EA opens a message and are never stored. Every send is
-- written to client_mail_audit, which the client reads: they can see exactly
-- what went out in their name.
--
-- Safe to run twice.

create table if not exists public.client_mail_grants (
  id uuid primary key default gen_random_uuid(),
  client_id  uuid not null references public.clients (id) on delete cascade,
  owner_id   uuid not null references auth.users (id) on delete cascade,
  provider   text not null check (provider in ('microsoft')),
  granted_to uuid not null references auth.users (id) on delete cascade,
  granted_at timestamptz not null default now(),
  unique (client_id, provider)
);

create table if not exists public.client_mail_messages (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  owner_id  uuid not null references auth.users (id) on delete cascade,
  provider  text not null,
  -- The provider's message id. Null for a send recorded before Graph lists it.
  external_id text,
  thread_id   text,
  direction   text not null default 'inbound' check (direction in ('inbound', 'outbound')),
  sender_name  text,
  sender_email text,
  to_emails text[] not null default '{}',
  cc_emails text[] not null default '{}',
  subject  text,
  preview  text,
  received_at timestamptz not null default now(),
  is_read boolean not null default false,
  -- For outbound rows sent from MadeEA: which EA sent it.
  sent_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (owner_id, provider, external_id)
);
create index if not exists client_mail_messages_list on public.client_mail_messages (client_id, received_at desc);

create table if not exists public.client_mail_audit (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  owner_id  uuid not null references auth.users (id) on delete cascade,
  actor_id  uuid references auth.users (id) on delete set null,
  action text not null check (action in ('sent', 'replied')),
  to_emails text[] not null default '{}',
  subject text,
  at timestamptz not null default now()
);
create index if not exists client_mail_audit_client on public.client_mail_audit (client_id, at desc);

alter table public.client_mail_grants   enable row level security;
alter table public.client_mail_messages enable row level security;
alter table public.client_mail_audit    enable row level security;
-- No policies on any of the three. Read through the views below; written by
-- client-mail (service role) and the grant/revoke functions.

-- ── The EA's side ──────────────────────────────────────────────────────────

/* The mailboxes this EA may open right now: they are the client's lead, AND
   the client granted it to them. */
create or replace view public.ea_client_mailboxes as
select
  g.client_id,
  c.name as client_name,
  g.provider,
  mc.account_email,
  g.granted_at
from public.client_mail_grants g
join public.clients c on c.id = g.client_id
left join public.microsoft_credentials mc on mc.owner_id = g.owner_id
where g.granted_to = auth.uid()
  and c.lead_ea_id = auth.uid();

create or replace view public.ea_client_mail as
select
  m.id, m.client_id, m.provider, m.external_id, m.thread_id, m.direction,
  m.sender_name, m.sender_email, m.to_emails, m.cc_emails, m.subject, m.preview,
  m.received_at, m.is_read
from public.client_mail_messages m
join public.client_mail_grants g on g.client_id = m.client_id and g.provider = m.provider
join public.clients c on c.id = m.client_id
where g.granted_to = auth.uid()
  and c.lead_ea_id = auth.uid();

-- ── The client's side ─────────────────────────────────────────────────────

create or replace view public.client_mail_status as
select
  g.provider,
  g.granted_at,
  coalesce(p.full_name, 'your assistant') as granted_to_name,
  -- False once MadeEA has moved them to a different lead EA: access has stopped.
  (c.lead_ea_id = g.granted_to) as active
from public.client_mail_grants g
join public.clients c on c.id = g.client_id
left join public.profiles p on p.id = g.granted_to
where g.client_id = public.my_client()
  and public.my_client_role() = 'primary';

create or replace view public.client_mail_activity as
select
  a.id, a.action, a.to_emails, a.subject, a.at,
  coalesce(p.full_name, 'Your assistant') as actor_name
from public.client_mail_audit a
left join public.profiles p on p.id = a.actor_id
where a.client_id = public.my_client()
  and public.my_client_role() = 'primary';

grant select on public.ea_client_mailboxes, public.ea_client_mail,
                public.client_mail_status, public.client_mail_activity to authenticated;

-- ── Grant and revoke (the client only) ───────────────────────────────────

create or replace function public.client_grant_mail(p_provider text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $grant$
declare cid uuid; lead uuid; sc text;
begin
  cid := public.my_client();
  if cid is null or public.my_client_role() <> 'primary' then
    raise exception 'Only the account''s primary contact can share their mail.' using errcode = 'insufficient_privilege';
  end if;
  if p_provider <> 'microsoft' then
    raise exception 'Only Outlook mail can be shared for now.' using errcode = 'check_violation';
  end if;
  select c.lead_ea_id into lead from public.clients c where c.id = cid;
  if lead is null then
    raise exception 'No assistant is assigned to your account yet.' using errcode = 'no_data_found';
  end if;
  /* Granted in Microsoft first. A yes here without the mail permission would
     show "shared" while every read and send failed. */
  select mc.scopes into sc from public.microsoft_credentials mc where mc.owner_id = auth.uid();
  if sc is null or sc not ilike '%Mail.ReadWrite%' or sc not ilike '%Mail.Send%' then
    raise exception 'Microsoft has not given MadeEA access to your mail yet. Connect again and allow mail.' using errcode = 'check_violation';
  end if;

  insert into public.client_mail_grants (client_id, owner_id, provider, granted_to)
  values (cid, auth.uid(), p_provider, lead)
  on conflict (client_id, provider) do update
    set owner_id = excluded.owner_id, granted_to = excluded.granted_to, granted_at = now();
end $grant$;

create or replace function public.client_revoke_mail(p_provider text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $revoke$
declare cid uuid;
begin
  cid := public.my_client();
  if cid is null or public.my_client_role() <> 'primary' then
    raise exception 'Only the account''s primary contact can do this.' using errcode = 'insufficient_privilege';
  end if;
  delete from public.client_mail_grants   where client_id = cid and provider = p_provider;
  delete from public.client_mail_messages where client_id = cid and provider = p_provider;
  -- The audit stays: it is the client's record of what was sent in their name.
end $revoke$;

/* Disconnecting Microsoft (0084) now also ends mail sharing. */
create or replace function public.client_disconnect_microsoft()
returns void
language plpgsql security definer set search_path = public, pg_temp as $disc$
declare uid uuid := auth.uid(); cid uuid := public.my_client();
begin
  if uid is null or cid is null then
    raise exception 'Only a client account can use this.' using errcode = 'insufficient_privilege';
  end if;
  delete from public.meetings where owner_id = uid and source = 'outlook-client';
  delete from public.client_mail_grants   where client_id = cid and provider = 'microsoft' and owner_id = uid;
  delete from public.client_mail_messages where client_id = cid and provider = 'microsoft' and owner_id = uid;
  delete from public.integrations where user_id = uid and provider = 'microsoft';
  delete from public.microsoft_credentials where owner_id = uid;
end $disc$;

revoke all on function public.client_grant_mail(text)  from public, anon;
revoke all on function public.client_revoke_mail(text) from public, anon;
revoke all on function public.client_disconnect_microsoft() from public, anon;
grant execute on function public.client_grant_mail(text)  to authenticated;
grant execute on function public.client_revoke_mail(text) to authenticated;
grant execute on function public.client_disconnect_microsoft() to authenticated;
