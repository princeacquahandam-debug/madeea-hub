-- 0038_completed_at_on_insert.sql
-- A task created already-done never reached anybody's EOD.
--
-- Run once in the Supabase SQL editor, after 0037.
--
-- THE BUG. tasks_touch_completed_at fires BEFORE UPDATE only. Move a card to
-- Done and completed_at is stamped correctly. Create a task that is already
-- done, which the API allows and which the workflow runner and any importer
-- will do, and completed_at stays null.
--
-- The EOD's "Completed today" filters on completed_at, not on status, because
-- status alone cannot tell you WHEN it was finished. So a task created done was
-- done, on the board, in the right column, and absent from the report forever.
--
-- Found by inserting one through the API and reading the row back, not by
-- reading the trigger.

create or replace function touch_completed_at() returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    -- Created already finished. Trust an explicit value if the caller supplied
    -- one, so an importer can backdate history correctly.
    if new.status = 'done' and new.completed_at is null then
      new.completed_at := now();
    end if;
    return new;
  end if;

  -- UPDATE: the original behaviour, unchanged.
  -- `is distinct from` rather than coalesce: status is the task_status enum,
  -- and coalescing an enum with '' is a cast error, not a null check.
  if new.status = 'done' and old.status is distinct from 'done' then
    new.completed_at := coalesce(new.completed_at, now());
  elsif new.status <> 'done' then
    -- Reopened. Clearing this matters: a stale completed_at would keep the task
    -- in an EOD it no longer belongs to.
    new.completed_at := null;
  end if;
  return new;
end $$;

drop trigger if exists tasks_touch_completed_at on tasks;
create trigger tasks_touch_completed_at
  before insert or update on tasks
  for each row execute function touch_completed_at();

-- Anything already created this way is invisible to the EOD. Give those rows a
-- completed_at so they stop being lost. updated_at is the closest honest
-- estimate of when it happened; created_at is the fallback.
update tasks
   set completed_at = coalesce(updated_at, created_at)
 where status = 'done' and completed_at is null;
