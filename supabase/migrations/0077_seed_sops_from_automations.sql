-- Three SOPs, written from the automations in the madeea-complimentary repo.
--
-- WHY SOPS AND NOT A PORT. That repo holds a standalone product -- its own
-- Netlify site, its own Supabase project, its own Google and Microsoft OAuth,
-- its own OpenAI key and a Modal cron -- plus three n8n workflow exports. The
-- product half overlaps what this app already does: MeetingPrepPacket is on the
-- Dashboard, Meeting Preparation is an AI Quick Action, and Gmail and Calendar
-- are already connected per user. Rebuilding it here would duplicate working
-- features and start a second OpenAI bill, which is the one subject the 14 Sep
-- call spent an hour on.
--
-- The n8n exports are the part with nothing equivalent here. Each is a real
-- process somebody runs for a client, and the steps below are read off their
-- actual nodes rather than invented: the calendar pull, the Drive and Gmail
-- lookup, the AI step, the send.
--
-- WHY A HUMAN CHECK SITS BEFORE EVERY SEND. Each of these flows ends by mailing
-- a client. The AI has the context and not the judgement, and the failure is
-- not a bad brief -- it is a bad brief arriving in a client inbox at 7am with
-- the agency name on it. Every one of these has a required read-before-send
-- step for that reason, and it is the step to leave alone if anybody trims
-- these later.
--
-- ai_action values match names in QUICK_ACTION_GROUPS. A step naming an action
-- that does not exist renders a button that opens nothing.
--
-- Idempotent on title, so re-running adds nothing and edits made in the app
-- survive.

insert into sops (workspace_id, title, description, category, steps, success_criteria)
select w.id,
       'Morning meeting brief',
       'Every meeting on the client calendar today, with the email thread and documents behind it, summarised and sent before their first call. From the Meeting Preparation Automation flow.',
       'Executive support',
       '[
         {"id": "cal",    "label": "Confirm the client calendar is still connected in Integrations", "required": true},
         {"id": "pull",   "label": "Pull todays meetings and drop the holds, blocks and all-day markers", "required": true},
         {"id": "gather", "label": "For each real meeting, find the related email thread and any document in Drive", "required": true},
         {"id": "brief",  "label": "Generate the brief", "required": true, "ai_action": "Meeting Preparation"},
         {"id": "read",   "label": "Read it before it goes. The AI has the context, you have the judgement", "required": true},
         {"id": "send",   "label": "Send it to the client ahead of their first meeting", "required": true},
         {"id": "note",   "label": "Note anything the brief missed, so tomorrow is better", "required": false}
       ]'::jsonb,
       '["The client had the brief before their first meeting","Every meeting names who is attending and what it is about","Nothing went out that you had not read"]'::jsonb
from workspaces w
where not exists (select 1 from sops s where s.workspace_id = w.id and s.title = 'Morning meeting brief');

insert into sops (workspace_id, title, description, category, steps, success_criteria)
select w.id,
       'Priority alignment',
       'The next three days of calendar, the flagged mail and the open tasks, reduced to the five things that actually matter. From the Priority Alignment flow.',
       'Executive support',
       '[
         {"id": "cal",    "label": "Pull the next three days from the calendar", "required": true},
         {"id": "mail",   "label": "Pull the flagged and priority email", "required": true},
         {"id": "tasks",  "label": "Pull the open tasks on this account", "required": true},
         {"id": "top5",   "label": "Generate the top five", "required": true, "ai_action": "Plan the Calendar"},
         {"id": "check",  "label": "Sanity-check it against what you know is coming that the data does not show", "required": true},
         {"id": "send",   "label": "Send it, and say what changed since the last one", "required": true},
         {"id": "share",  "label": "Post it to the shared channel if the client uses one", "required": false}
       ]'::jsonb,
       '["Five priorities, not fifteen","Each one names the deadline or the meeting driving it","The client can tell what moved since yesterday"]'::jsonb
from workspaces w
where not exists (select 1 from sops s where s.workspace_id = w.id and s.title = 'Priority alignment');

insert into sops (workspace_id, title, description, category, steps, success_criteria)
select w.id,
       'Executive inbox summary',
       'The last 24 hours of mail, sorted into what needs a decision, what needs a reply, and what is noise. From the Executive Summary Inbox flow.',
       'Executive support',
       '[
         {"id": "pull",   "label": "Pull the last 24 hours of mail", "required": true},
         {"id": "sort",   "label": "Sort into needs a decision, needs a reply, for information, and noise", "required": true},
         {"id": "dedupe", "label": "Collapse duplicates and thread repeats, so one conversation is one line", "required": true},
         {"id": "draft",  "label": "Draft the summary", "required": true, "ai_action": "Triage the Inbox"},
         {"id": "check",  "label": "Check nothing urgent was filed as noise. This is the step that costs you if you skip it", "required": true},
         {"id": "send",   "label": "Send it", "required": true},
         {"id": "clear",  "label": "Answer anything in needs a reply that you can handle yourself", "required": false}
       ]'::jsonb,
       '["The client reads one summary instead of 80 emails","Nothing urgent sat in the noise pile","Anything you could answer yourself was already answered"]'::jsonb
from workspaces w
where not exists (select 1 from sops s where s.workspace_id = w.id and s.title = 'Executive inbox summary');
