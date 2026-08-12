-- 0007_sops.sql. Working SOPs (Playbooks): executable checklists + success criteria.

create table sops (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces (id) on delete cascade default my_workspace(),
  title text not null,
  description text,
  category text,
  steps jsonb not null default '[]',            -- [{id,label,required,ai_action?}]
  success_criteria jsonb not null default '[]', -- [string]
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table sop_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces (id) on delete cascade default my_workspace(),
  owner_id uuid references auth.users (id) on delete cascade default auth.uid(),
  sop_id uuid not null references sops (id) on delete cascade,
  client_id uuid references clients (id) on delete set null,
  checked jsonb not null default '[]',          -- [stepId]
  status text not null default 'in_progress',   -- in_progress | completed
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table sops enable row level security;
alter table sop_runs enable row level security;

-- SOPs: global templates (workspace_id null) are readable by everyone; workspace
-- custom SOPs readable by members; only admins write workspace SOPs.
create policy "sops read" on sops for select using (workspace_id is null or workspace_id = my_workspace());
create policy "sops admin write" on sops for all
  using (workspace_id = my_workspace() and is_admin())
  with check (workspace_id = my_workspace() and is_admin());

-- Runs: per-EA inbox-view model (admin sees all in the workspace).
create policy "sop_runs scoped" on sop_runs for all
  using (workspace_id = my_workspace() and (is_admin() or owner_id = auth.uid()))
  with check (workspace_id = my_workspace() and (is_admin() or owner_id = auth.uid()));

-- ---------- seeded default SOPs (global) ----------
insert into sops (workspace_id, title, description, category, steps, success_criteria) values
(null, 'Inbox Triage', 'Acknowledge, assess and action an incoming request to standard.', 'Communication',
 '[{"id":"ack","label":"Request acknowledged within 15 minutes","required":true},
   {"id":"urgency","label":"Urgency assigned (Urgent / Standard / Low)","required":true},
   {"id":"profile","label":"Client profile reviewed","required":true},
   {"id":"ai","label":"AI support used (if applicable)","required":false,"ai_action":"Run Inbox Triage"},
   {"id":"review","label":"Output reviewed against quality standards","required":true},
   {"id":"deliver","label":"Response / action delivered","required":true},
   {"id":"prefs","label":"Client preferences updated (if applicable)","required":false}]'::jsonb,
 '["Client has received a response","Required action has been completed","CRM / system has been updated","Client profile updated with any new preferences"]'::jsonb),

(null, 'Meeting Preparation', 'Prepare an executive for an upcoming meeting.', 'Scheduling',
 '[{"id":"profiles","label":"Attendee profiles compiled","required":true},
   {"id":"agenda","label":"Agenda drafted","required":true},
   {"id":"docs","label":"Relevant documents attached","required":true},
   {"id":"brief","label":"AI meeting brief generated","required":false,"ai_action":"Generate Meeting Brief"},
   {"id":"reminder","label":"Pre-meeting reminder sent to participants","required":true}]'::jsonb,
 '["Meeting brief delivered to executive","Reminders sent to all participants","Documents shared"]'::jsonb),

(null, 'Executive Priority Alignment', 'Produce the prioritised daily briefing for the executive.', 'Operations',
 '[{"id":"calendar","label":"Calendar reviewed","required":true},
   {"id":"inbox","label":"Emails and tasks reviewed","required":true},
   {"id":"flags","label":"Conflicts and urgent items flagged","required":true},
   {"id":"brief","label":"Daily brief generated","required":true},
   {"id":"deliver","label":"Brief delivered to executive","required":true}]'::jsonb,
 '["Prioritised daily brief delivered before 8 AM","Conflicts surfaced and resolved or flagged"]'::jsonb),

(null, 'Expense & Bookkeeping', 'Compile and submit an expense report.', 'Finance',
 '[{"id":"receipts","label":"Receipts collected","required":true},
   {"id":"categorise","label":"Expenses categorised","required":true},
   {"id":"report","label":"Expense report generated","required":true,"ai_action":"Create Expense Report"},
   {"id":"submit","label":"Submitted for approval","required":true},
   {"id":"log","label":"Logged / filed in system","required":true}]'::jsonb,
 '["Expense report generated","Submitted to finance","Logged and filed"]'::jsonb),

(null, 'Client Onboarding', 'Bring a new client into the Vault and kick off the relationship.', 'Clients',
 '[{"id":"discovery","label":"Discovery call completed","required":true},
   {"id":"vault","label":"Client profile created in Client Vault","required":true},
   {"id":"prefs","label":"Communication preferences captured","required":true},
   {"id":"kickoff","label":"Kickoff / welcome sent","required":true},
   {"id":"checkin","label":"30-day check-in scheduled","required":true}]'::jsonb,
 '["Client profile complete in Vault","Welcome / kickoff delivered","Check-in on the calendar"]'::jsonb);
