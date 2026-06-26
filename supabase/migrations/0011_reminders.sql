-- 0011_reminders.sql — user reminders / follow-ups (isolated table).
-- The frontend degrades gracefully if this isn't applied yet (reminders just
-- don't show), so it can't break the rest of the app.
create table reminders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  workspace_id uuid references workspaces (id) on delete cascade default my_workspace(),
  task_id uuid references tasks (id) on delete cascade,
  label text not null,
  remind_at timestamptz not null,
  dismissed boolean not null default false,
  created_at timestamptz not null default now()
);

alter table reminders enable row level security;
create policy "reminders scoped" on reminders for all
  using (workspace_id = my_workspace() and (is_admin() or owner_id = auth.uid()))
  with check (workspace_id = my_workspace() and (is_admin() or owner_id = auth.uid()));
