-- 0102: the Delegation Coach for the founder (11 Nov 2026 call: Prince, Abder,
-- Rowena, Bryan).
--
-- What the call decided:
--   * The coach is for the founder: "four things the founder should be focused
--     on every single day ... everything else needs to be correctly delegated
--     to the correct members of that particular team" (Prince).
--   * It needs the organisation: "think of it as a tree ... the founder on the
--     top, then the EA, and directors below" and "anyone reporting to the
--     client needs to be there" (Abder), filled in "before they're able to start
--     using the delegation coach" (Rowena).
--   * Where a function does not exist yet (no finance person, say), the coach
--     says which part the EA can take until it does (Rowena). That is prompt
--     work, in generate/quickActions.ts.
--   * Inside the platform it flags what to delegate and does it "with one
--     action", after which the item shows as assigned (Abder): a task is
--     created for the right person straight from the suggestion.
--
-- So this adds:
--   1. client_users.focus_areas and desk_items: the founder's up-to-4 focus
--      areas and what is on their desk, so the coach can run without retyping.
--   2. client_org_people: the people who report to the founder.
--   3. client_quick_delegate: one action, one task, for the assistant or a team
--      member on MadeEA, with the coach's reason as its notes.
--   4. client_hand_off_plan_to_member and client_mark_plan_sent: a full plan can
--      go to a team member, or to someone outside MadeEA.
--
-- And fixes a regression: 0101's daily AI budget refused every client account
-- (it checked my_workspace() only, which is NULL for clients by design, 0065),
-- undoing 0082. Since 7 Nov a client asking Madeline in the portal got "You've
-- reached today's AI limit". Both limiters accept a client account again.
--
-- Safe to run twice.

-- ---------------------------------------------------------------------------
-- 0. The AI budget lets client accounts in again (0082, undone by 0101).
-- ---------------------------------------------------------------------------
create or replace function check_ai_daily_budget(
  p_fn text,
  p_max_calls int default 150,
  p_max_usd numeric default 0.50
)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $budget$
declare uid uuid; used int; spent numeric;
begin
  uid := auth.uid();
  if uid is null then return false; end if;
  -- No workspace and no client account, no AI budget.
  if my_workspace() is null and my_client() is null then return false; end if;

  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));

  delete from ai_usage where created_at < now() - interval '2 days';

  select count(*) into used from ai_usage
    where user_id = uid and created_at >= date_trunc('day', now());
  if used >= greatest(p_max_calls, 1) then return false; end if;

  select coalesce(sum(cost_usd), 0) into spent from ai_spend
    where owner_id = uid and created_at >= date_trunc('day', now());
  if spent >= p_max_usd then return false; end if;

  insert into ai_usage (user_id, fn) values (uid, p_fn);
  return true;
end $budget$;

revoke all on function check_ai_daily_budget(text, int, numeric) from public;
grant execute on function check_ai_daily_budget(text, int, numeric) to authenticated;

create or replace function check_ai_rate_limit(p_fn text, p_max int default 60)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $ratelimit$
declare uid uuid; used int;
begin
  uid := auth.uid();
  if uid is null then return false; end if;
  if my_workspace() is null and my_client() is null then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));
  delete from ai_usage where created_at < now() - interval '2 days';
  select count(*) into used from ai_usage
    where user_id = uid and created_at > now() - interval '1 hour';
  if used >= greatest(p_max, 1) then return false; end if;
  insert into ai_usage (user_id, fn) values (uid, p_fn);
  return true;
end $ratelimit$;

-- ---------------------------------------------------------------------------
-- 1. The founder's focus and desk.
-- ---------------------------------------------------------------------------
alter table public.client_users
  add column if not exists focus_areas text[] not null default '{}',
  add column if not exists desk_items  text[] not null default '{}';

comment on column public.client_users.focus_areas is
  'Up to 4 things only this founder should spend their days on (11 Nov 2026 call). The Delegation Coach sorts everything else against them.';
comment on column public.client_users.desk_items is
  'What is on the founder''s desk, for the Delegation Coach to sort. Up to 25 lines.';

/* The caller's own row only; client_users stays service-role for every other
   write (0065). */
create or replace function public.client_set_delegation_context(p_focus text[], p_desk text[])
returns boolean
language plpgsql security definer set search_path = public, pg_temp as $ctx$
declare f text[]; d text[];
begin
  if public.my_client() is null or public.my_client_role() <> 'primary' then
    raise exception 'Only the account owner sets their focus.' using errcode = 'insufficient_privilege';
  end if;

  select coalesce(array_agg(left(btrim(x), 120) order by ord), '{}') into f
  from unnest(coalesce(p_focus, '{}')) with ordinality as t(x, ord)
  where coalesce(btrim(x), '') <> '';
  if coalesce(array_length(f, 1), 0) > 4 then
    raise exception 'Keep it to 4 focus areas.' using errcode = 'check_violation';
  end if;

  select coalesce(array_agg(left(btrim(x), 200) order by ord), '{}') into d
  from unnest(coalesce(p_desk, '{}')) with ordinality as t(x, ord)
  where coalesce(btrim(x), '') <> '' and ord <= 25;

  update public.client_users set focus_areas = f, desk_items = d where user_id = auth.uid();
  return true;
end $ctx$;

-- ---------------------------------------------------------------------------
-- 2. Who reports to the founder.
-- ---------------------------------------------------------------------------
create table if not exists public.client_org_people (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  client_id    uuid not null references public.clients (id) on delete cascade,
  name         text not null check (char_length(btrim(name)) between 1 and 80),
  title        text check (char_length(title) <= 80),
  area         text check (char_length(area) <= 40),
  handles      text check (char_length(handles) <= 300),
  -- Their MadeEA login, when they are one of the client's members (0078).
  member_email text,
  position     int not null default 0,
  created_at   timestamptz not null default now()
);

create index if not exists client_org_people_client_idx on public.client_org_people (client_id, position);

comment on table public.client_org_people is
  'The people reporting directly to a client (11 Nov 2026 call). The Delegation Coach routes work to them. Written only through client_save_org.';

alter table public.client_org_people enable row level security;

-- The agency reads it so the assistant knows who is who. Clients read it
-- through client_org below; nobody writes it except client_save_org.
drop policy if exists "client org staff read" on public.client_org_people;
create policy "client org staff read" on public.client_org_people for select to authenticated
  using (workspace_id = my_workspace());

create or replace view public.client_org as
select
  o.id, o.name, o.title, o.area, o.handles,
  -- Addresses are the primary's only (0074).
  case when public.my_client_role() = 'primary' then o.member_email end as member_email,
  o.position
from public.client_org_people o
where o.client_id = public.my_client();

grant select on public.client_org to authenticated;

/* The whole list, replaced in one call: the editor saves what is on screen. */
create or replace function public.client_save_org(p_people jsonb)
returns int
language plpgsql security definer set search_path = public, pg_temp as $org$
declare cid uuid; ws uuid; n int := 0; r jsonb; em text;
begin
  cid := public.my_client();
  if cid is null or public.my_client_role() <> 'primary' then
    raise exception 'Only the account owner may edit their organisation.' using errcode = 'insufficient_privilege';
  end if;
  if jsonb_typeof(coalesce(p_people, '[]'::jsonb)) <> 'array' then
    raise exception 'Expected a list of people.' using errcode = 'invalid_parameter_value';
  end if;
  if jsonb_array_length(coalesce(p_people, '[]'::jsonb)) > 30 then
    raise exception 'Up to 30 people.' using errcode = 'check_violation';
  end if;

  select cu.workspace_id into ws from public.client_users cu where cu.user_id = auth.uid() limit 1;

  delete from public.client_org_people where client_id = cid;

  for r in select value from jsonb_array_elements(coalesce(p_people, '[]'::jsonb)) loop
    continue when coalesce(btrim(r ->> 'name'), '') = '';
    -- A login named here must be one of this account's members.
    em := nullif(lower(btrim(coalesce(r ->> 'member_email', ''))), '');
    if em is not null and not exists (
      select 1 from public.client_users cu join auth.users u on u.id = cu.user_id
      where cu.client_id = cid and cu.role = 'member' and lower(u.email) = em
    ) then
      em := null;
    end if;
    insert into public.client_org_people (workspace_id, client_id, name, title, area, handles, member_email, position)
    values (
      ws, cid,
      left(btrim(r ->> 'name'), 80),
      nullif(left(btrim(coalesce(r ->> 'title', '')), 80), ''),
      nullif(left(btrim(coalesce(r ->> 'area', '')), 40), ''),
      nullif(left(btrim(coalesce(r ->> 'handles', '')), 300), ''),
      em,
      n
    );
    n := n + 1;
  end loop;

  return n;
end $org$;

-- ---------------------------------------------------------------------------
-- 3. One action: delegate an item as a task, to the assistant or a member.
-- ---------------------------------------------------------------------------
create or replace function public.client_quick_delegate(
  p_title text, p_notes text default null, p_member_email text default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $quick$
declare cid uuid; ws uuid; target uuid; open_count int; new_id uuid;
begin
  cid := public.my_client();
  if cid is null or public.my_client_role() <> 'primary' then
    raise exception 'Only the account owner may delegate work.' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(btrim(p_title), '') = '' then
    raise exception 'A task needs a title.' using errcode = 'check_violation';
  end if;

  if coalesce(btrim(p_member_email), '') = '' then
    select c.lead_ea_id into target from public.clients c where c.id = cid;
    if target is null then
      raise exception 'No assistant is assigned to your account yet.' using errcode = 'no_data_found';
    end if;
  else
    select cu.user_id into target
    from public.client_users cu join auth.users u on u.id = cu.user_id
    where cu.client_id = cid and cu.role = 'member' and lower(u.email) = lower(btrim(p_member_email))
    limit 1;
    if target is null then
      raise exception 'Nobody on your team uses that address.' using errcode = 'no_data_found';
    end if;
  end if;

  select count(*) into open_count
  from public.tasks where client_id = cid and assignee_id = target and status <> 'done';
  if open_count >= 100 then
    raise exception 'That person already has 100 open tasks.' using errcode = 'check_violation';
  end if;

  select cu.workspace_id into ws from public.client_users cu where cu.user_id = auth.uid() limit 1;

  insert into public.tasks (workspace_id, client_id, title, assignee_id, requested_by_client, notes)
  values (ws, cid, left(btrim(p_title), 200), target, true, nullif(left(btrim(coalesce(p_notes, '')), 2000), ''))
  returning id into new_id;

  return new_id;
end $quick$;

-- ---------------------------------------------------------------------------
-- 4. A full plan to a team member, or marked sent outside MadeEA.
-- ---------------------------------------------------------------------------
create or replace function public.client_hand_off_plan_to_member(p_plan_id uuid, p_email text)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $tomember$
declare cid uuid; p record; new_task uuid;
begin
  cid := public.my_client();
  if cid is null or public.my_client_role() <> 'primary' then
    raise exception 'Only the account owner may hand work to the team.' using errcode = 'insufficient_privilege';
  end if;

  select * into p from public.delegation_plans where id = p_plan_id and client_id = cid;
  if p.id is null then
    raise exception 'No such plan on this account.' using errcode = 'no_data_found';
  end if;
  if p.task_id is not null or p.status <> 'draft' then
    raise exception 'That plan has already been handed over.' using errcode = 'check_violation';
  end if;

  new_task := public.client_quick_delegate(p.task_name, p.handoff_message, p_email);

  update public.delegation_plans
     set task_id = new_task, status = 'active', updated_at = now()
   where id = p.id;

  return new_task;
end $tomember$;

create or replace function public.client_mark_plan_sent(p_plan_id uuid)
returns boolean
language plpgsql security definer set search_path = public, pg_temp as $sent$
declare cid uuid;
begin
  cid := public.my_client();
  if cid is null or public.my_client_role() <> 'primary' then
    raise exception 'Your access to this account is view only.' using errcode = 'insufficient_privilege';
  end if;

  update public.delegation_plans
     set status = 'active', updated_at = now()
   where id = p_plan_id and client_id = cid and status = 'draft' and task_id is null;
  if not found then
    raise exception 'That plan is not a draft on this account.' using errcode = 'no_data_found';
  end if;
  return true;
end $sent$;

-- The first draft of this migration (never run) named it client_set_focus.
drop function if exists public.client_set_focus(text[]);

revoke all on function public.client_set_delegation_context(text[], text[])  from public;
revoke all on function public.client_save_org(jsonb)                          from public;
revoke all on function public.client_quick_delegate(text, text, text)         from public;
revoke all on function public.client_hand_off_plan_to_member(uuid, text)      from public;
revoke all on function public.client_mark_plan_sent(uuid)                     from public;
grant execute on function public.client_set_delegation_context(text[], text[]) to authenticated;
grant execute on function public.client_save_org(jsonb)                        to authenticated;
grant execute on function public.client_quick_delegate(text, text, text)       to authenticated;
grant execute on function public.client_hand_off_plan_to_member(uuid, text)    to authenticated;
grant execute on function public.client_mark_plan_sent(uuid)                   to authenticated;
