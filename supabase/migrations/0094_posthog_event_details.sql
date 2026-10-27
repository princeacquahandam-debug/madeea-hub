-- 0094 · PostHog: the event details only the app knows (tracking plan, slides 9–10)
--
-- Three server events in 0093 were missing a property the plan asks for,
-- because the database can't see it on its own:
--   task_stage_changed    method          drag / menu / ai (and automation)
--   eod_report_submitted  ai_items_count  items kept from the prefilled draft
--                         ai_items_edited prefilled items removed or reworded
--   message_sent          ai_drafted      the reply started from an AI draft
--
-- HOW THEY ARRIVE. The app adds a header, x-madeea-ph, to the one request that
-- makes the change, holding a small JSON object of these details. PostgREST
-- hands every request header to the database as request.headers, so the
-- trigger reads it from there. No new columns, nothing stored: the header lives
-- only as long as the request. A request without it (an older browser tab, an
-- n8n job) still sends the event, just without the detail.
--
-- Only these keys are read, and each is checked for type, so nothing else a
-- caller puts in the header reaches PostHog.
--
-- Also: days_in_stage now comes from the stage history (task_activity, 0029)
-- rather than the task's last edit, which any typo fix used to reset.
--
-- Safe to run more than once.

-- ── The header, as JSON. {} when absent or not JSON. ──────────────────────
create or replace function public.ph_hint()
returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare
  v jsonb;
begin
  begin
    v := (coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb ->> 'x-madeea-ph')::jsonb;
  exception when others then
    return '{}'::jsonb;
  end;
  return case when jsonb_typeof(v) = 'object' then v else '{}'::jsonb end;
end $$;

revoke all on function public.ph_hint() from public;

-- ── task_stage_changed + method, and days_in_stage from the stage history ──
create or replace function public.ph_tasks_event()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_method text;
  v_since timestamptz;
begin
  begin
    if tg_op = 'INSERT' then
      -- restore_task (0090) re-inserts a deleted task; that is not a new one.
      if coalesce(current_setting('madeea.restoring', true), '') = 'on' then
        perform public.ph_capture(coalesce(auth.uid(), new.owner_id), 'task_restored',
          jsonb_build_object('task_id', new.id));
        return null;
      end if;
      perform public.ph_capture(coalesce(auth.uid(), new.owner_id), 'task_created', jsonb_build_object(
        'task_id', new.id,
        'source', case
          when new.routine_id is not null then 'routine'
          when new.source_meeting_id is not null then 'meeting'
          when new.requested_by_client then 'client'
          else 'app' end,
        'priority', new.priority::text,
        'has_due_date', new.due_at is not null,
        'has_client', new.client_id is not null,
        'is_assigned', new.assignee_id is not null and new.assignee_id <> new.owner_id
      ));
    elsif new.status is distinct from old.status then
      -- Drag and AI say so; any other move by a person is the menu or the
      -- task form; no person at all is an automation.
      v_method := public.ph_hint() ->> 'method';
      if v_method is null or v_method not in ('drag', 'menu', 'ai') then
        v_method := case when auth.uid() is null then 'automation' else 'menu' end;
      end if;
      -- When it entered the stage it is leaving. This move's own history row is
      -- already written (same transaction, so created_at = now()); skip it.
      select max(a.created_at) into v_since
        from public.task_activity a
       where a.task_id = new.id and a.verb in ('status', 'created') and a.created_at < now();
      perform public.ph_capture(coalesce(auth.uid(), new.owner_id), 'task_stage_changed', jsonb_build_object(
        'task_id', new.id,
        'from_stage', old.status::text,
        'to_stage', new.status::text,
        'method', v_method,
        'days_in_stage', greatest(0, floor(extract(epoch from (now() - coalesce(v_since, old.updated_at))) / 86400))::int,
        'is_overdue', new.due_at is not null and new.due_at < now()
      ));
    end if;
  exception when others then
    null;
  end;
  return null;
end $$;

-- ── eod_report_submitted + ai_items_count, ai_items_edited ─────────────────
create or replace function public.ph_eod_event()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ended timestamptz;
  v_hint jsonb;
begin
  begin
    if new.imported or new.owner_id is null then
      return null;
    end if;
    if tg_op = 'UPDATE' and auth.uid() is distinct from new.owner_id then
      return null;
    end if;
    select max(t.ended_at) into v_ended
      from public.time_entries t
     where t.owner_id = new.owner_id and t.work_date = new.report_date and t.ended_at is not null;
    v_hint := public.ph_hint();
    perform public.ph_capture(new.owner_id, 'eod_report_submitted', jsonb_build_object(
      'report_id', new.id,
      'report_date', new.report_date,
      'completed_count', coalesce(cardinality(new.done), 0),
      'blockers_count', coalesce(cardinality(new.blockers), 0),
      'plan_count', coalesce(cardinality(new.plans), 0),
      'has_notes', coalesce(btrim(new.notes), '') <> '',
      'is_update', tg_op = 'UPDATE',
      'ai_items_count', case when jsonb_typeof(v_hint -> 'ai_items_count') = 'number' then (v_hint ->> 'ai_items_count')::numeric::int end,
      'ai_items_edited', case when jsonb_typeof(v_hint -> 'ai_items_edited') = 'number' then (v_hint ->> 'ai_items_edited')::numeric::int end,
      'minutes_after_shift_end',
        case when v_ended is null then null
             else floor(extract(epoch from (now() - v_ended)) / 60)::int end
    ));
  exception when others then
    null;
  end;
  return null;
end $$;

-- ── message_sent + ai_drafted ──────────────────────────────────────────────
create or replace function public.ph_messages_event()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_hint jsonb;
begin
  begin
    if new.direction = 'outbound' and auth.uid() is not null then
      v_hint := public.ph_hint();
      perform public.ph_capture(new.owner_id, 'message_sent', jsonb_build_object(
        'message_id', new.id,
        'channel', new.source,
        'is_reply', new.thread_id is not null or new.reply_target is not null,
        'has_client', new.client_id is not null,
        'ai_drafted', coalesce((v_hint ->> 'ai_drafted') = 'true', false)
      ));
    end if;
  exception when others then
    null;
  end;
  return null;
end $$;
