-- 0010_task_depth.sql. Task Manager depth: checklists, recurrence, dependencies.
alter table tasks add column subtasks jsonb not null default '[]';   -- [{id,label,done}]
alter table tasks add column recurrence text not null default 'none'; -- none | daily | weekly | monthly
alter table tasks add column depends_on uuid references tasks (id) on delete set null;
