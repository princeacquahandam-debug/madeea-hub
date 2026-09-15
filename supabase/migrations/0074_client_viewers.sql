-- A client may bring colleagues, and they may only look.
--
-- === THIS REVERSES A DECISION, ON PURPOSE ================================
--
-- The 14 Sep call ruled client-side people out: "hindi po sila pwede magpasok
-- ng team members nila at the moment, kasi exclusive lang po ito for MadeEA"
-- (15:18). That was a commercial line, not a technical one -- a client who can
-- seat their own staff gets more of the product without hiring more assistants.
--
-- What lands here keeps that line and answers the need behind it. A viewer can
-- SEE the account. A viewer cannot ask the assistant for anything. So a founder
-- can put their operations lead in front of the work without a second person
-- queueing jobs for one EA, which is the thing the agency sells by the hour.
--
-- === WHY VIEWERS ARE SHUT OUT OF THE CHANNELS ENTIRELY ===================
--
-- Not a permissions detail, the whole point of there being two channels. The
-- escalation channel is where a client raises something about their assistant
-- that they would not say to their face (0065). A colleague reading that is
-- worse than a colleague reading nothing, and a colleague reading the private
-- client_ea channel sees a working relationship that is not theirs.
--
-- So the tabs do not exist for a viewer, and can_see_conversation refuses them
-- underneath, because a tab that is merely not rendered is not a rule.
--
-- EXISTING ROWS BECOME 'primary'. Everyone who holds a portal login today is
-- the client themselves, and the default keeps them exactly as they are.

-- ---------------------------------------------------------------------------
-- 1. The role.
-- ---------------------------------------------------------------------------

alter table public.client_users
  add column if not exists role text not null default 'primary';

do $rolecheck$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'client_users_role_check'
  ) then
    alter table public.client_users
      add constraint client_users_role_check check (role in ('primary', 'viewer'));
  end if;
end $rolecheck$;

comment on column public.client_users.role is
  'primary is the client themselves and may act. viewer is a colleague they added, who may read the account and nothing else.';

-- ---------------------------------------------------------------------------
-- 2. Which one is asking.
-- ---------------------------------------------------------------------------
--
-- Returns NULL for staff, exactly as my_client() does, so a member calling any
-- of the checks below is neither a primary nor a viewer and falls through to
-- the staff rules rather than accidentally matching one of these.

create or replace function public.my_client_role() returns text
  language sql stable security definer set search_path = public, pg_temp as $$
  select role from client_users where user_id = auth.uid() limit 1
$$;

comment on function public.my_client_role is
  'The calling client account role, or NULL for staff. Paired with my_client(), never used instead of it.';

-- ---------------------------------------------------------------------------
-- 3. The channels close to viewers.
-- ---------------------------------------------------------------------------
--
-- One function still gates both conversations and conversation_messages, which
-- is why it was written this way in 0065: the two cannot drift apart, and this
-- change lands on both by editing one clause.

create or replace function public.can_see_conversation(conv uuid) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from conversations c
    join clients cl on cl.id = c.client_id
    where c.id = conv
      and (
        -- The client, on both of their own channels. A viewer is not the
        -- client for this purpose: see the header.
        (c.client_id = public.my_client() and public.my_client_role() = 'primary')

        -- Their assistant, on the private channel only.
        or (c.kind = 'client_ea'
            and c.workspace_id = my_workspace()
            and cl.lead_ea_id = auth.uid())

        -- Agency leads, on the escalation channel only.
        or (c.kind = 'escalation'
            and c.workspace_id = my_workspace()
            and public.is_agency_lead())
      )
  )
$$;

-- ---------------------------------------------------------------------------
-- 4. The two writes close to viewers.
-- ---------------------------------------------------------------------------
--
-- Checked here rather than in the page for the reason 0072 gives about every
-- other client write: the browser is not where a request comes from.

create or replace function public.client_create_task(p_title text, p_due_label text default null)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $newtask$
declare cid uuid; ws uuid; ea uuid; open_count int; new_id uuid;
begin
  cid := public.my_client();
  if cid is null then
    raise exception 'Only a client may request a task.' using errcode = 'insufficient_privilege';
  end if;

  if public.my_client_role() <> 'primary' then
    raise exception 'Your access to this account is view only. Ask the account owner to request this.'
      using errcode = 'insufficient_privilege';
  end if;

  if coalesce(btrim(p_title), '') = '' then
    raise exception 'A task needs a title.' using errcode = 'check_violation';
  end if;

  select cu.workspace_id into ws from public.client_users cu where cu.user_id = auth.uid() limit 1;
  select c.lead_ea_id  into ea from public.clients c where c.id = cid;

  select count(*) into open_count
  from public.tasks
  where client_id = cid and requested_by_client and status <> 'done';

  if open_count >= 50 then
    raise exception 'You have 50 open requests already. Talk to your assistant before adding more.'
      using errcode = 'check_violation';
  end if;

  insert into public.tasks (workspace_id, client_id, title, due_label, assignee_id, requested_by_client)
  values (ws, cid, btrim(p_title), nullif(btrim(coalesce(p_due_label, '')), ''), ea, true)
  returning id into new_id;

  return new_id;
end $newtask$;

create or replace function public.client_create_note(p_title text, p_body text)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $newnote$
declare cid uuid; ws uuid; note_count int; new_id uuid;
begin
  cid := public.my_client();
  if cid is null then
    raise exception 'Only a client may write a note here.' using errcode = 'insufficient_privilege';
  end if;

  if public.my_client_role() <> 'primary' then
    raise exception 'Your access to this account is view only.'
      using errcode = 'insufficient_privilege';
  end if;

  if coalesce(btrim(p_body), '') = '' then
    raise exception 'A note needs something in it.' using errcode = 'check_violation';
  end if;

  select cu.workspace_id into ws from public.client_users cu where cu.user_id = auth.uid() limit 1;

  select count(*) into note_count
  from public.notes
  where client_id = cid and author_is_client;

  if note_count >= 200 then
    raise exception 'That is 200 notes. Ask your assistant to clear some before adding more.'
      using errcode = 'check_violation';
  end if;

  insert into public.notes (workspace_id, client_id, title, body, shared_with_client, author_is_client)
  values (
    ws,
    cid,
    coalesce(nullif(btrim(coalesce(p_title, '')), ''), 'Note from client'),
    btrim(p_body),
    true,
    true
  )
  returning id into new_id;

  return new_id;
end $newnote$;

-- ---------------------------------------------------------------------------
-- 5. Who else is on this account.
-- ---------------------------------------------------------------------------
--
-- So the portal can say "you and two colleagues can see this" rather than
-- leaving the client guessing who is looking. Emails are NOT published: a
-- viewer list that leaks addresses is a mailing list for whoever gets in.

-- The email is shown to the PRIMARY only. They chose these people and need to
-- know who is looking, so withholding it from them would be secrecy for its own
-- sake. A viewer sees roles and dates and no addresses: a colleague does not
-- need the account owner's list of contacts, and a viewer list that hands out
-- addresses is a mailing list for whoever gets in.

create view public.client_people as
select
  cu.role,
  cu.created_at,
  cu.user_id = auth.uid() as is_you,
  case when public.my_client_role() = 'primary' then u.email end as email
from public.client_users cu
join auth.users u on u.id = cu.user_id
where cu.client_id = public.my_client();

comment on view public.client_people is
  'Everyone holding a login to this client account. Addresses are visible to the primary only. user_id is never published: removal is keyed by email.';

grant select on public.client_people to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Taking a colleague back off the account.
-- ---------------------------------------------------------------------------
--
-- Keyed by email rather than user_id, so the view never has to publish an auth
-- id to a browser. The account itself is left alone: this removes their access
-- to THIS client, not their login, because the same person may be a viewer
-- somewhere else later and deleting auth users from a client-facing call is a
-- much bigger hammer than anybody asked for.

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

  /* A primary cannot remove a primary, themselves included. Losing the last
     acting account would leave a client who can read their own portal and do
     nothing in it, recoverable only by the agency. */
  if target_role = 'primary' then
    raise exception 'That is an account owner. Ask the agency to change who owns this account.'
      using errcode = 'insufficient_privilege';
  end if;

  delete from public.client_users where user_id = target and client_id = cid;
  return true;
end $rmviewer$;

revoke execute on function public.client_remove_viewer(text) from public, anon;
grant execute on function public.client_remove_viewer(text) to authenticated;

comment on function public.client_remove_viewer is
  'Removes a colleague from this client account. Primary only, viewers only, and it never touches the auth account itself.';
