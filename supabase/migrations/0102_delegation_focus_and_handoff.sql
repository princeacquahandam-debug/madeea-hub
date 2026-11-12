-- 0102: the Delegation Coach for the founder (11 Nov 2026 call, Prince and Abder).
--
-- What the call asked for:
--   "There's four things the founder should be focused on every single day ...
--    everything else needs to be correctly delegated to the correct members of
--    that particular team." And: "it can also delegate things to other members
--    of their team as well ... because of course the EA can't do everything."
--
-- So this adds:
--   1. The founder's focus areas (up to 4), kept on their own login, which the
--      coach's "keep or delegate" sort measures every item against.
--   2. Handing a plan to one of the client's OWN team members (0078), as a real
--      task on that person's board, not only to the assistant.
--   3. Marking a plan handed over to someone who has no Hub login: the founder
--      sends the message themselves; the plan still moves to "handed over".
--
-- And fixes a regression: 0101's daily AI budget refused every client account
-- (it checked my_workspace() only, which is NULL for clients by design, 0065),
-- undoing 0082. Since 7 Nov a client asking Madeline in the portal got "You've
-- reached today's AI limit". Both limiters now accept a client account again.
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
-- 1. The founder's focus areas.
-- ---------------------------------------------------------------------------
alter table public.client_users
  add column if not exists focus_areas text[] not null default '{}';

comment on column public.client_users.focus_areas is
  'Up to 4 things only this founder should spend their days on (11 Nov 2026 call). The Delegation Coach sorts everything else against them.';

/* The caller's own row only; client_users stays service-role for every other
   write (0065). */
create or replace function public.client_set_focus(p_focus text[])
returns text[]
language plpgsql security definer set search_path = public, pg_temp as $focus$
declare clean text[];
begin
  if public.my_client() is null or public.my_client_role() <> 'primary' then
    raise exception 'Only the account owner sets their focus.' using errcode = 'insufficient_privilege';
  end if;

  select coalesce(array_agg(left(btrim(f), 120) order by ord), '{}') into clean
  from unnest(coalesce(p_focus, '{}')) with ordinality as x(f, ord)
  where coalesce(btrim(f), '') <> '';

  if array_length(clean, 1) > 4 then
    raise exception 'Keep it to 4 focus areas.' using errcode = 'check_violation';
  end if;

  update public.client_users set focus_areas = clean where user_id = auth.uid();
  return clean;
end $focus$;

-- ---------------------------------------------------------------------------
-- 2. Hand a plan to one of the client's own team members.
-- ---------------------------------------------------------------------------
create or replace function public.client_hand_off_plan_to_member(p_plan_id uuid, p_email text)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $tomember$
declare cid uuid; ws uuid; target uuid; p record; new_task uuid; open_count int;
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

  -- Resolved against THIS account's members, as client_create_team_task (0078).
  select cu.user_id into target
  from public.client_users cu
  join auth.users u on u.id = cu.user_id
  where cu.client_id = cid and cu.role = 'member'
    and lower(u.email) = lower(btrim(p_email))
  limit 1;
  if target is null then
    raise exception 'Nobody on your team uses that address.' using errcode = 'no_data_found';
  end if;

  select count(*) into open_count
  from public.tasks where client_id = cid and assignee_id = target and status <> 'done';
  if open_count >= 100 then
    raise exception 'That person already has 100 open tasks.' using errcode = 'check_violation';
  end if;

  select cu.workspace_id into ws from public.client_users cu where cu.user_id = auth.uid() limit 1;

  insert into public.tasks (workspace_id, client_id, title, assignee_id, requested_by_client, notes)
  values (ws, cid, p.task_name, target, true, p.handoff_message)
  returning id into new_task;

  update public.delegation_plans
     set task_id = new_task, status = 'active', updated_at = now()
   where id = p.id;

  return new_task;
end $tomember$;

-- ---------------------------------------------------------------------------
-- 3. Handed over outside the Hub: the founder sent the message themselves.
-- ---------------------------------------------------------------------------
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

revoke all on function public.client_set_focus(text[])                       from public;
revoke all on function public.client_hand_off_plan_to_member(uuid, text)     from public;
revoke all on function public.client_mark_plan_sent(uuid)                    from public;
grant execute on function public.client_set_focus(text[])                    to authenticated;
grant execute on function public.client_hand_off_plan_to_member(uuid, text)  to authenticated;
grant execute on function public.client_mark_plan_sent(uuid)                 to authenticated;
