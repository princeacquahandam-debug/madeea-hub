-- One do-not-contact list that every system checks before it sends.
--
-- ── THE PROBLEM ──────────────────────────────────────────────────────────
--
-- An opt-out lived only where it was said. "STOP" to the Sendblue SMS put a
-- tag and an SMS-only DND on the GoHighLevel contact, and that stopped SMS:
-- the same nurture kept emailing and calling, the Instagram follow-ups never
-- looked at the contact at all (day 3/7 emails people regardless), a fresh
-- form fill restarted the sequence, a STOP from a number GHL didn't know was
-- dropped, and the Hub's own Instagram / WhatsApp / email sends had no idea
-- any of it had happened. This is the one review item with a legal edge.
--
-- ── WHAT THIS IS ─────────────────────────────────────────────────────────
--
-- The list. One row per identifier the person can be reached on: an email,
-- a phone (which is also their WhatsApp number), an Instagram id, a GHL
-- contact id. When someone opts out, every identifier known at that moment
-- goes in, so whichever route reaches for them next finds them.
--
-- Read and written by:
--   - the Hub's send functions (instagram-send, whatsapp-send, gmail-send,
--     outlook-send), which refuse to send to a match;
--   - the Hub's inbound handlers, which add anyone who replies with an opt-out
--     keyword;
--   - n8n, through the do-not-contact function (shared secret, like the
--     email organizer), which checks before every automated touch and adds
--     STOPs, and mirrors them into GHL as full Do-Not-Disturb.
--
-- ── NEVER DELETED ────────────────────────────────────────────────────────
--
-- An opt-out is evidence. Lifting one (the person opted back in) stamps
-- lifted_at / lifted_by / lift_reason and leaves the row, so "when did they
-- say stop, and who reversed it" always has an answer. Only an admin can lift,
-- through do_not_contact_lift().
--
-- One list for the whole business, not per workspace: a person who said stop
-- said it to MadeEA.

create table if not exists public.do_not_contact (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('email', 'phone', 'instagram', 'ghl_contact')),
  value text not null,
  -- Where the opt-out came from.
  source text not null default 'manual'
    check (source in ('sms', 'instagram', 'whatsapp', 'email', 'manual')),
  -- The words they used, when they used words. Kept as evidence.
  message text,
  reason text,
  /* The message that caused it ("whatsapp:wamid…", "instagram:…", "sms:…").
     Inbox syncs re-read old messages every run; without this, a "stop" from
     March would re-add someone an admin deliberately lifted in June. */
  evidence_id text,
  /* Rows written together for one opt-out share a batch, so lifting it lifts
     every identifier at once rather than leaving the phone blocked after the
     email was cleared. */
  batch uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  lifted_at timestamptz,
  lifted_by uuid references auth.users (id) on delete set null,
  lift_reason text
);

-- One ACTIVE row per identifier. A lifted row stays, and a later opt-out by
-- the same person makes a new one.
create unique index if not exists do_not_contact_active_uidx
  on public.do_not_contact (kind, value) where lifted_at is null;
create unique index if not exists do_not_contact_evidence_uidx
  on public.do_not_contact (kind, evidence_id) where evidence_id is not null;
create index if not exists do_not_contact_created_idx on public.do_not_contact (created_at desc);

comment on table public.do_not_contact is
  'People who asked not to be contacted, by every identifier known when they asked. Checked before every send by the Hub and n8n. Lifted, never deleted.';

-- ── Normalising, so "+44 7700 900123", "447700900123" and "0044 7700…" are
-- the same phone, and "Ann@X.com " is the same email as "ann@x.com". ──────
create or replace function public.dnc_normalize(p_kind text, p_value text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select nullif(case p_kind
    when 'email' then lower(trim(p_value))
    -- Digits only, international form. A WhatsApp wa_id is already this.
    when 'phone' then regexp_replace(regexp_replace(trim(p_value), '^(\+|00)', ''), '[^0-9]', '', 'g')
    else trim(p_value)
  end, '')
$$;

create or replace function public.do_not_contact_normalize()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  new.value := dnc_normalize(new.kind, new.value);
  if new.value is null then raise exception 'do_not_contact: empty % value', new.kind; end if;
  -- A phone this short is a typo or a shortcode, and would match strangers.
  if new.kind = 'phone' and length(new.value) < 7 then
    raise exception 'do_not_contact: "%" is too short to be a phone number', new.value;
  end if;
  if new.kind = 'email' and new.value !~ '^[^@\s]+@[^@\s]+$' then
    raise exception 'do_not_contact: "%" is not an email address', new.value;
  end if;
  return new;
end $$;

drop trigger if exists do_not_contact_normalize on public.do_not_contact;
create trigger do_not_contact_normalize before insert or update of kind, value on public.do_not_contact
  for each row execute function public.do_not_contact_normalize();

-- ── Who may do what ──────────────────────────────────────────────────────
alter table public.do_not_contact enable row level security;

drop policy if exists "dnc members read" on public.do_not_contact;
create policy "dnc members read" on public.do_not_contact for select to authenticated
  using (my_workspace() is not null);

-- Any team member can add someone: adding is always the safe direction.
drop policy if exists "dnc members add" on public.do_not_contact;
create policy "dnc members add" on public.do_not_contact for insert to authenticated
  with check (my_workspace() is not null and created_by = auth.uid() and lifted_at is null);

-- No update or delete policy. Lifting goes through do_not_contact_lift(),
-- which checks the caller is an admin and records who and why.

grant select, insert on public.do_not_contact to authenticated;

-- ── The check every sender makes ─────────────────────────────────────────
-- Pass whatever identifiers you have for the recipient; any match blocks.
create or replace function public.do_not_contact_match(
  p_emails text[] default '{}',
  p_phones text[] default '{}',
  p_instagram text[] default '{}',
  p_ghl text[] default '{}'
)
returns table (id uuid, batch uuid, kind text, value text, source text, message text, created_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select d.id, d.batch, d.kind, d.value, d.source, d.message, d.created_at
  from do_not_contact d
  where d.lifted_at is null
    -- Team members and the service role (the Hub's functions, n8n's endpoint).
    and (my_workspace() is not null or coalesce(auth.role(), '') = 'service_role')
    and (
         (d.kind = 'email'       and d.value in (select dnc_normalize('email', x)       from unnest(coalesce(p_emails, '{}')) x))
      or (d.kind = 'phone'       and d.value in (select dnc_normalize('phone', x)       from unnest(coalesce(p_phones, '{}')) x))
      or (d.kind = 'instagram'   and d.value in (select dnc_normalize('instagram', x)   from unnest(coalesce(p_instagram, '{}')) x))
      or (d.kind = 'ghl_contact' and d.value in (select dnc_normalize('ghl_contact', x) from unnest(coalesce(p_ghl, '{}')) x))
    )
  order by d.created_at
$$;

revoke all on function public.do_not_contact_match(text[], text[], text[], text[]) from public, anon;
grant execute on function public.do_not_contact_match(text[], text[], text[], text[]) to authenticated, service_role;

-- ── Lifting an opt-out: admins only, with a reason ───────────────────────
create or replace function public.do_not_contact_lift(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not is_admin() then raise exception 'Only an admin can lift an opt-out.'; end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Say why: for example "Opted back in by email on 3 Oct".';
  end if;
  -- The whole opt-out: every identifier recorded with it.
  update do_not_contact
     set lifted_at = now(), lifted_by = auth.uid(), lift_reason = trim(p_reason)
   where batch = (select batch from do_not_contact where id = p_id)
     and lifted_at is null;
  if not found then raise exception 'That opt-out was not found, or is already lifted.'; end if;
end $$;

revoke all on function public.do_not_contact_lift(uuid, text) from public, anon;
grant execute on function public.do_not_contact_lift(uuid, text) to authenticated;
