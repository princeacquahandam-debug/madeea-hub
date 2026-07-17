-- 0013_followups.sql — follow-up nudges, dead-thread detection, and the reply
-- timestamps the SLA feature also needs. One migration covers both, because both
-- were blocked on the same gap: the app only ever stored INBOUND mail, so it could
-- neither tell how fast we replied nor notice that someone never replied to us.

-- ---------- messages: threads, direction, and reply linkage ----------
alter table messages add column if not exists thread_id text;
alter table messages add column if not exists sender_email text;

-- 'inbound'  = they wrote to us. first_reply_at = when WE answered (null = we owe them).
-- 'outbound' = we wrote to them. reply_received_at = when THEY answered
--              (null = they've gone quiet → a dead thread once it's old enough).
alter table messages add column if not exists direction text not null default 'inbound';
alter table messages add column if not exists first_reply_at timestamptz;
alter table messages add column if not exists reply_received_at timestamptz;

alter table messages drop constraint if exists messages_direction_check;
alter table messages add constraint messages_direction_check
  check (direction in ('inbound', 'outbound'));

create index if not exists messages_thread_idx on messages (workspace_id, thread_id);
create index if not exists messages_direction_idx on messages (workspace_id, direction);

-- ---------- clients: how an email address resolves to a client ----------
alter table clients add column if not exists email text;
alter table clients add column if not exists domains text[] default '{}';

-- ---------- tasks: last-touched, so "stale" means untouched, not merely old ----------
alter table tasks add column if not exists updated_at timestamptz not null default now();

-- Backfill to created_at so nothing looks stale the moment this ships.
update tasks set updated_at = created_at where updated_at is null;

create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tasks_touch_updated_at on tasks;
create trigger tasks_touch_updated_at
  before update on tasks
  for each row execute function touch_updated_at();

-- ---------- snoozes: "stop nagging me about this until…" ----------
create table if not exists snoozes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  workspace_id uuid default my_workspace() references workspaces (id) on delete cascade,
  item_type text not null check (item_type in ('message', 'task')),
  item_id text not null,
  snooze_until timestamptz not null,
  created_at timestamptz not null default now(),
  -- One live snooze per item; re-snoozing just pushes the date out.
  unique (workspace_id, item_type, item_id)
);

alter table snoozes enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'snoozes' and policyname = 'ws shared') then
    create policy "ws shared" on snoozes for all
      using (workspace_id = my_workspace())
      with check (workspace_id = my_workspace());
  end if;
end $$;
