-- 0035_workflow_task_link.sql. Make a workflow run count for something.
--
-- Run once in the Supabase SQL editor, after 0034.
--
-- THE PROBLEM. Finishing a workflow produced a row in sop_runs and nothing
-- else. The EOD is built by draftFromTasks() from tasks and reads nothing else,
-- so an EA could run four procedures end to end and their EOD would show an
-- empty day. The work was done, recorded, and invisible.
--
-- WHY NOT JUST HAVE THE EOD READ sop_runs TOO. Because R-4.7.6 says tasks stay
-- the source of truth feeding the EOD, and a second feed double-counts: the
-- task "Inbox triage for Vantage" and the run "Inbox Triage" are the same work,
-- and the client would see both. So a run attaches to a task, and the EOD picks
-- it up through the path that already works. No change to the EOD at all.

alter table sop_runs add column if not exists task_id uuid references tasks (id) on delete set null;

comment on column sop_runs.task_id is
  'The task this run is doing. How a completed workflow reaches the EOD: the task is what the EOD reads, not this table.';

create index if not exists sop_runs_task_idx on sop_runs (task_id) where task_id is not null;

-- ---------- one open run per procedure per client ----------
-- The UI resumed a run by looking up sop_id alone. An EA running Inbox Triage
-- for two clients got whichever row came back first, so ticks for one client
-- appeared under the other. Reichelle at 56:04 makes the point that managing
-- several clients at once is the normal case, not the edge case.
--
-- The client fix is to match on client too. This index is the guarantee behind
-- it, so two open runs for the same pair cannot exist even if something else
-- writes the table later. coalesce, because null client_id means "no client"
-- and two of those are still a collision, whereas null <> null in a plain
-- unique index would let them both through.
create unique index if not exists sop_runs_one_open_per_client
  on sop_runs (owner_id, sop_id, coalesce(client_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status = 'in_progress';

-- ---------- stale AI step names ----------
-- Three seeded steps offer an AI action by name, and the §5.1 consolidation
-- retired all three names. The string is passed straight to the generate
-- function as its format, so a retired name falls through to the generic
-- prompt instead of the one written for that job, and the panel header shows
-- the EA a name that no longer exists anywhere else in the app.
update sops set steps = (
  select jsonb_agg(
    case s ->> 'ai_action'
      when 'Run Inbox Triage'      then jsonb_set(s, '{ai_action}', '"Triage the Inbox"')
      when 'Generate Meeting Brief' then jsonb_set(s, '{ai_action}', '"Meeting Prep"')
      when 'Create Expense Report'  then jsonb_set(s, '{ai_action}', '"Expense Report"')
      else s
    end
    order by ord
  )
  from jsonb_array_elements(sops.steps) with ordinality as t(s, ord)
)
where steps @> '[{"ai_action": "Run Inbox Triage"}]'
   or steps @> '[{"ai_action": "Generate Meeting Brief"}]'
   or steps @> '[{"ai_action": "Create Expense Report"}]';

-- ---------- who may write a workflow ----------
-- The policy from 0007 already allows admin writes, so authoring needs no new
-- grant. Noted here because it is a product decision worth seeing: EAs run
-- workflows, admins define them. That is what "standardised output" means
-- (Rowena 54:55). If the team decides the EA doing the work should be able to
-- draft one, this is the line to change:
--
--   create policy "sops admin write" on sops for all
--     using (workspace_id = my_workspace() and is_admin())
--     with check (workspace_id = my_workspace() and is_admin());
