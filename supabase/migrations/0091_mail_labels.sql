-- 0091: personal email labels (Reich's testing, 20 Oct 2026).
--
-- The tester asked for labels or folders to organise email by category,
-- priority or client. Labels, not folders: a message can be "Acme" and
-- "Invoices" at once, and the inbox views (Needs reply, Waiting on others,
-- Done) are already the one-place-per-message axis.
--
-- Labels are PERSONAL. Each person sees and manages only their own. The ids
-- are stored on the message itself (messages.label_ids), which is safe because
-- mail in a personal inbox is owner-only under the 0040/0051 policies. Shared
-- channel messages (Slack and friends) are team-editable already, so a
-- teammate's label id can sit on one; the app ignores ids that are not in the
-- viewer's own label list, so nobody sees a label they do not own.
--
-- Idempotent: safe to run twice.

-- ── 1. The labels ─────────────────────────────────────────────────────────
create table if not exists public.mail_labels (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade default my_workspace(),
  owner_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  name text not null check (length(trim(name)) between 1 and 40),
  -- A fixed palette, so every label reads in both the light and dark theme.
  -- The app maps each name to its theme classes (src/data/mailLabels.ts).
  color text not null default 'slate'
    check (color in ('slate', 'red', 'amber', 'green', 'blue', 'violet', 'pink')),
  created_at timestamptz not null default now()
);

-- One "Invoices" per person, whatever the capitalisation.
create unique index if not exists mail_labels_owner_name_key
  on public.mail_labels (owner_id, lower(trim(name)));

alter table public.mail_labels enable row level security;

drop policy if exists "mail labels are personal" on public.mail_labels;
create policy "mail labels are personal"
  on public.mail_labels for all
  using (owner_id = auth.uid() and workspace_id = my_workspace())
  with check (owner_id = auth.uid() and workspace_id = my_workspace());

grant select, insert, update, delete on public.mail_labels to authenticated;

-- ── 2. Labels on a message ────────────────────────────────────────────────
alter table public.messages add column if not exists label_ids uuid[] not null default '{}';
create index if not exists messages_label_ids_idx on public.messages using gin (label_ids);

-- ── 3. Deleting a label takes it off every message ────────────────────────
-- Security definer because a label can sit on a shared-channel message the
-- deleting person can no longer update (a channel they left). It only ever
-- removes the deleted label's own id, so it cannot be used to touch anything
-- else.
create or replace function public.mail_labels_forget()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.messages
     set label_ids = array_remove(label_ids, old.id)
   where old.id = any (label_ids);
  return old;
end;
$$;

drop trigger if exists mail_labels_forget on public.mail_labels;
create trigger mail_labels_forget
  after delete on public.mail_labels
  for each row execute function public.mail_labels_forget();

-- ── 4. Applying a label, atomically ───────────────────────────────────────
-- Adding or removing ONE id in place, rather than the app writing the whole
-- array back. On a shared Slack message two people can label at once, and a
-- read-modify-write from the browser would quietly drop the other person's
-- label. Security invoker, so the messages update policy still decides which
-- rows it can touch; the label itself must be the caller's own.
create or replace function public.set_message_label(p_message_ids uuid[], p_label_id uuid, p_on boolean)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  n integer;
begin
  if not exists (select 1 from public.mail_labels where id = p_label_id and owner_id = auth.uid()) then
    raise exception 'Label not found' using errcode = '42501';
  end if;
  update public.messages
     set label_ids = case
           when p_on then array_append(array_remove(label_ids, p_label_id), p_label_id)
           else array_remove(label_ids, p_label_id)
         end
   where id = any (p_message_ids);
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.set_message_label(uuid[], uuid, boolean) from public;
grant execute on function public.set_message_label(uuid[], uuid, boolean) to authenticated;

-- ── 5. Unread count ───────────────────────────────────────────────────────
-- The sidebar asks "how many unread" every minute. A partial index on just
-- the unread inbound rows keeps that a cheap count however large the mailbox.
create index if not exists messages_unread_idx
  on public.messages (workspace_id, owner_id)
  where is_read = false and direction = 'inbound';
