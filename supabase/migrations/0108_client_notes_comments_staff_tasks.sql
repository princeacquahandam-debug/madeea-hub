-- 0108_client_notes_comments_staff_tasks.sql. QA write test, batch 2.
--
-- Run in the Supabase SQL editor (madeea-hub project). Safe to run twice.
--
--   1. Clients edit and delete the notes THEY wrote (WA-12). They could only
--      create them; a typo was permanent unless the agency deleted the note.
--   2. Task comments a client can see and write (WA-11). Task cards in the
--      portal did not open, and a client never saw a word of discussion.
--   3. Removing a staff member no longer strands their open tasks (WA-17).
--
-- ── WHY COMMENTS NEED A FLAG ──────────────────────────────────────────────
-- task_comments has always been the AGENCY's thread: an EA asking the owner
-- about a client, a manager's note on how the client is to work with. Showing
-- that thread to the client would publish all of it. So a comment is visible
-- to the client only when it says so: every comment the client writes, and
-- the agency comments written with "Visible to client" ticked. Every comment
-- that exists today stays internal.

-- ── 1. Client notes: edit and delete their own ───────────────────────────
create or replace function public.client_update_note(p_id uuid, p_title text, p_body text)
returns boolean
language plpgsql security definer set search_path = public, pg_temp as $updnote$
declare cid uuid;
begin
  cid := public.my_client();
  if cid is null or public.my_client_role() <> 'primary' then
    raise exception 'Your access to this account is view only.' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(btrim(p_body), '') = '' then
    raise exception 'A note needs something in it.' using errcode = 'check_violation';
  end if;
  if length(p_body) > 10000 or length(coalesce(p_title, '')) > 200 then
    raise exception 'That note is too long.' using errcode = 'check_violation';
  end if;
  update public.notes
     set title = coalesce(nullif(btrim(coalesce(p_title, '')), ''), 'Note from client'),
         body = btrim(p_body),
         updated_at = now()
   where id = p_id and client_id = cid and author_is_client;
  if not found then
    raise exception 'You can only edit notes you wrote.' using errcode = 'no_data_found';
  end if;
  return true;
end $updnote$;

create or replace function public.client_delete_note(p_id uuid)
returns boolean
language plpgsql security definer set search_path = public, pg_temp as $delnote$
declare cid uuid;
begin
  cid := public.my_client();
  if cid is null or public.my_client_role() <> 'primary' then
    raise exception 'Your access to this account is view only.' using errcode = 'insufficient_privilege';
  end if;
  delete from public.notes where id = p_id and client_id = cid and author_is_client;
  if not found then
    raise exception 'You can only delete notes you wrote.' using errcode = 'no_data_found';
  end if;
  return true;
end $delnote$;

revoke execute on function public.client_update_note(uuid, text, text) from public, anon;
revoke execute on function public.client_delete_note(uuid) from public, anon;
grant execute on function public.client_update_note(uuid, text, text) to authenticated;
grant execute on function public.client_delete_note(uuid) to authenticated;

-- ── 2. Task comments a client may see ────────────────────────────────────
alter table public.task_comments
  add column if not exists client_visible boolean not null default false;

comment on column public.task_comments.client_visible is
  'Shown in the client portal. True for everything a client writes, and for agency comments written with "Visible to client". Default false: the thread is the agency''s own.';

/* The comments on the tasks this person can see in the portal (client_tasks
   already decides that: staff see only their own), and only the visible ones.
   Who wrote it is a display name, never an id or an address. */
create or replace view public.client_task_comments as
select
  c.id,
  c.task_id,
  c.body,
  c.created_at,
  (c.author_id = auth.uid()) as mine,
  exists (select 1 from public.client_users cu where cu.user_id = c.author_id) as from_client,
  coalesce(p.full_name, 'MadeEA') as author_name
from public.task_comments c
join public.client_tasks t on t.id = c.task_id
left join public.profiles p on p.id = c.author_id
where c.client_visible;

grant select on public.client_task_comments to authenticated;

create or replace function public.client_add_task_comment(p_task_id uuid, p_body text)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $addcmt$
declare ws uuid; new_id uuid; body text := btrim(coalesce(p_body, ''));
begin
  if public.my_client() is null or public.my_client_role() = 'viewer' then
    raise exception 'Your access to this account is view only.' using errcode = 'insufficient_privilege';
  end if;
  if body = '' then
    raise exception 'Write a comment first.' using errcode = 'check_violation';
  end if;
  if length(body) > 4000 then
    raise exception 'Keep it under 4,000 characters.' using errcode = 'check_violation';
  end if;
  -- Only on a task this person can see in their portal.
  if not exists (select 1 from public.client_tasks where id = p_task_id) then
    raise exception 'That task is not on your account.' using errcode = 'no_data_found';
  end if;
  select workspace_id into ws from public.tasks where id = p_task_id;
  insert into public.task_comments (task_id, workspace_id, author_id, body, client_visible)
  values (p_task_id, ws, auth.uid(), body, true)
  returning id into new_id;
  return new_id;
end $addcmt$;

revoke execute on function public.client_add_task_comment(uuid, text) from public, anon;
grant execute on function public.client_add_task_comment(uuid, text) to authenticated;

-- ── 3. Removing a staff member hands their open work back ────────────────
/* Same function as 0074, plus one step: the member's unfinished tasks go to
   the primary who removed them, instead of pointing at somebody who can no
   longer open the account (they vanished from the staff board and sat on the
   agency's board with nobody on them). */
create or replace function public.client_remove_viewer(p_email text)
returns boolean
language plpgsql security definer set search_path = public, pg_temp as $rmviewer$
declare cid uuid; target uuid; target_role text;
begin
  cid := public.my_client();
  if cid is null then
    raise exception 'Only a client may manage this account.' using errcode = 'insufficient_privilege';
  end if;

  if public.my_client_role() <> 'primary' then
    raise exception 'Your access to this account is view only.' using errcode = 'insufficient_privilege';
  end if;

  select cu.user_id, cu.role into target, target_role
  from public.client_users cu
  join auth.users u on u.id = cu.user_id
  where cu.client_id = cid and lower(u.email) = lower(btrim(p_email))
  limit 1;

  if target is null then
    raise exception 'Nobody on this account uses that address.' using errcode = 'no_data_found';
  end if;

  if target_role = 'primary' then
    raise exception 'That is an account owner. Ask the agency to change who owns this account.'
      using errcode = 'insufficient_privilege';
  end if;

  update public.tasks
     set assignee_id = auth.uid()
   where client_id = cid and assignee_id = target and status <> 'done';

  delete from public.client_users where user_id = target and client_id = cid;
  return true;
end $rmviewer$;

revoke execute on function public.client_remove_viewer(text) from public, anon;
grant execute on function public.client_remove_viewer(text) to authenticated;
