-- 0014_activity_log.sql — the two things a per-client timeline needs and the app
-- doesn't have: a "when was this actually done" timestamp on tasks, and a way to
-- link a calendar meeting to a client.

-- ---------- tasks: when did we finish it ----------
-- due_at is when a task is DUE, not when anything happened. A task due next Friday
-- is not an activity. Without completed_at the timeline can never answer "what did
-- we deliver for this client last month", which is the whole question.
alter table tasks add column if not exists completed_at timestamptz;

create or replace function touch_completed_at() returns trigger
language plpgsql as $$
begin
  if new.status = 'done' and (old.status is distinct from 'done') then
    new.completed_at = now();
  elsif new.status <> 'done' then
    -- Moved back out of Done: it isn't complete any more, so drop the claim
    -- rather than leaving a stale completion sitting in the audit trail.
    new.completed_at = null;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_touch_completed_at on tasks;
create trigger tasks_touch_completed_at
  before update on tasks
  for each row execute function touch_completed_at();

-- Backfill: tasks already done have no record of WHEN. created_at is the only
-- timestamp they have, so it's the honest floor — the UI marks these entries as
-- approximate rather than presenting a guess as fact.
update tasks set completed_at = created_at
 where status = 'done' and completed_at is null;

-- ---------- meetings: who was actually in the room ----------
-- calendar-sync never set client_id, so in live mode no meeting is linked to any
-- client. Storing attendee emails lets the sync match them the same way gmail-sync
-- matches senders (clients.email / clients.domains, added in 0013).
alter table meetings add column if not exists attendee_emails text[] default '{}';

create index if not exists tasks_completed_idx on tasks (workspace_id, completed_at desc);
create index if not exists meetings_client_idx on meetings (workspace_id, client_id, starts_at desc);
