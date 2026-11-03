-- 0095_made_ready_curriculum.sql. The Made Ready Academy, to the HR outline.
--
-- Run once in the Supabase SQL editor, after 0094.
--
-- "Made Ready Academy: MadeEA AI-Powered Executive Assistant Foundations"
-- (course outline, Nov 2026) replaces the three-module draft from 0034:
--   Day 1  modules 1-3   The MadeEA Standard, EA essentials, Google Workspace
--   Day 2  modules 4-7   AI foundations, prompting, the AI toolkit, workflows
--   Day 3  modules 8-10  client tech stack, integration, communication
-- A quiz per module (80% to pass, as the outline asks), and four practical
-- assessments: the Module 3 mini exercise, prompt writing, the Day 2 practical
-- and the 90-minute final client simulation.
--
-- ── Practical assessments ─────────────────────────────────────────────────
-- The outline's certificate needs "pass all practical assessments", which a
-- multiple-choice grader cannot do. So a practical lesson takes a submission
-- (text, or links to the learner's Docs/Slides) and an admin marks it passed
-- or sends it back with feedback.
--
-- Same principle as the answer key in 0034: the person being assessed cannot
-- mark themselves. A learner can only ever write status 'submitted' (the
-- trigger forces it), and only an admin reviewing SOMEONE ELSE's work can set
-- 'passed' or 'needs_work'. An admin taking the course is reviewed by another
-- admin like everyone else.
--
-- Made Ready (academy_status) now means: every published module's quiz passed
-- AND every practical in a published module passed.
--
-- Safe to run more than once.

-- ---------- practical lessons ----------
alter table academy_lessons drop constraint if exists academy_lessons_kind_check;
alter table academy_lessons add constraint academy_lessons_kind_check
  check (kind in ('reading', 'video', 'simulation', 'practical'));

create table if not exists academy_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  lesson_id uuid not null references academy_lessons (id) on delete cascade,
  body text not null check (length(btrim(body)) > 0),
  status text not null default 'submitted' check (status in ('submitted', 'passed', 'needs_work')),
  feedback text,
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  submitted_at timestamptz not null default now(),
  unique (user_id, lesson_id)
);

create index if not exists academy_submissions_status_idx on academy_submissions (status, submitted_at);

-- Is this lesson part of the caller's workspace?
create or replace function academy_lesson_in_my_workspace(p_lesson uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from academy_lessons l join academy_modules m on m.id = l.module_id
     where l.id = p_lesson and m.workspace_id = my_workspace()
  );
$$;

-- Who may change what. The learner edits their work and it goes back to
-- 'submitted'; a reviewer changes the verdict and nothing else.
create or replace function academy_submission_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.user_id = auth.uid() then
    -- The learner: never a verdict, even an admin on their own work.
    new.status := 'submitted';
    new.reviewed_by := null;
    new.reviewed_at := null;
    if tg_op = 'UPDATE' then
      new.user_id := old.user_id;
      new.lesson_id := old.lesson_id;
      new.feedback := old.feedback;   -- keep the last feedback visible while they fix it
      new.submitted_at := now();
    end if;
  elsif tg_op = 'UPDATE' and is_admin() then
    -- A reviewer: verdict and feedback only.
    new.user_id := old.user_id;
    new.lesson_id := old.lesson_id;
    new.body := old.body;
    new.submitted_at := old.submitted_at;
    new.reviewed_by := auth.uid();
    new.reviewed_at := now();
  else
    raise exception 'not allowed';
  end if;
  return new;
end $$;

drop trigger if exists academy_submission_guard on academy_submissions;
create trigger academy_submission_guard before insert or update on academy_submissions
  for each row execute function academy_submission_guard();

alter table academy_submissions enable row level security;

drop policy if exists "submissions read" on academy_submissions;
create policy "submissions read" on academy_submissions for select to authenticated
  using (user_id = auth.uid() or (is_admin() and academy_lesson_in_my_workspace(lesson_id)));

drop policy if exists "submissions own insert" on academy_submissions;
create policy "submissions own insert" on academy_submissions for insert to authenticated
  with check (user_id = auth.uid() and academy_lesson_in_my_workspace(lesson_id));

drop policy if exists "submissions update" on academy_submissions;
create policy "submissions update" on academy_submissions for update to authenticated
  using (user_id = auth.uid() or (is_admin() and academy_lesson_in_my_workspace(lesson_id)))
  with check (user_id = auth.uid() or (is_admin() and academy_lesson_in_my_workspace(lesson_id)));

-- No delete policy: a submission is a record of the assessment.

-- ---------- resources ----------
-- "Resources Included" from the outline. Each one gets a link once it exists;
-- until then the Training Center lists it as being prepared.
create table if not exists academy_resources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid default my_workspace() references workspaces (id) on delete cascade,
  title text not null,
  url text check (url is null or url ~* '^https://'),
  position integer not null default 0
);

alter table academy_resources enable row level security;

drop policy if exists "resources readable" on academy_resources;
create policy "resources readable" on academy_resources for select to authenticated
  using (workspace_id = my_workspace());
drop policy if exists "resources admin write" on academy_resources;
create policy "resources admin write" on academy_resources for all to authenticated
  using (workspace_id = my_workspace() and is_admin())
  with check (workspace_id = my_workspace() and is_admin());

-- ---------- Made Ready now includes the practicals ----------
-- New columns go at the end so create or replace keeps working.
create or replace view academy_status
with (security_invoker = true) as
select
  m.user_id,
  (select count(*) from academy_modules am where am.workspace_id = m.workspace_id and am.is_published) as modules_total,
  (select count(distinct a.module_id)
     from academy_attempts a
     join academy_modules am on am.id = a.module_id
    where a.user_id = m.user_id and a.passed and am.is_published) as modules_passed,
  (select max(a.created_at)
     from academy_attempts a where a.user_id = m.user_id and a.passed) as last_passed_at,
  (select count(*)
     from academy_lessons l join academy_modules am on am.id = l.module_id
    where am.workspace_id = m.workspace_id and am.is_published and l.kind = 'practical') as practicals_total,
  (select count(*)
     from academy_submissions s
     join academy_lessons l on l.id = s.lesson_id
     join academy_modules am on am.id = l.module_id
    where s.user_id = m.user_id and s.status = 'passed' and am.is_published and l.kind = 'practical') as practicals_passed
from memberships m
where m.workspace_id = my_workspace();

comment on view academy_status is
  'Per-EA Academy completion. Made Ready = all published module quizzes passed and all practicals passed (0095).';

-- ---------- the curriculum ----------
-- GENERATED from src/data/academySeed.ts (node scripts/academy/gen.cjs). Change the
-- curriculum there and regenerate, so demo mode and the database agree.
--
-- Runs once per workspace: a workspace that already has "The MadeEA Standard"
-- is skipped. The old three-day outline is unpublished, not deleted, so past
-- attempts and progress stay on record; unpublished modules are hidden and do
-- not count toward Made Ready.
do $seed$
declare
  w record;
  m1 uuid; m2 uuid; m3 uuid; m4 uuid; m5 uuid; m6 uuid; m7 uuid; m8 uuid; m9 uuid; m10 uuid;
  q uuid;
begin
  for w in select id from workspaces loop
    if exists (select 1 from academy_modules where workspace_id = w.id and title = 'The MadeEA Standard') then
      continue;
    end if;

    update academy_modules set is_published = false where workspace_id = w.id;

    insert into academy_modules (workspace_id, day, title, summary, position, pass_pct)
    values (w.id, 1, $t$The MadeEA Standard$t$,
      $t$What makes a MadeEA assistant different, what clients expect, and the standards every piece of work is held to.$t$, 1, 80)
    returning id into m1;

    insert into academy_modules (workspace_id, day, title, summary, position, pass_pct)
    values (w.id, 1, $t$Modern Executive Assistant Essentials$t$,
      $t$Managing the flow of information, priorities, decisions and time around an executive, whatever tools they use.$t$, 2, 80)
    returning id into m2;

    insert into academy_modules (workspace_id, day, title, summary, position, pass_pct)
    values (w.id, 1, $t$Google Workspace + AI Workflow$t$,
      $t$Using Gmail, Calendar, Docs, Sheets and Drive together as one organized system, with AI to speed it up.$t$, 3, 80)
    returning id into m3;

    insert into academy_modules (workspace_id, day, title, summary, position, pass_pct)
    values (w.id, 2, $t$AI Foundations for Professionals$t$,
      $t$What AI does well, what it does poorly, what is safe to share, and when human judgment has to take over.$t$, 4, 80)
    returning id into m4;

    insert into academy_modules (workspace_id, day, title, summary, position, pass_pct)
    values (w.id, 2, $t$Prompt Engineering for Executive Assistants$t$,
      $t$The right context, clear instructions and useful boundaries: how to get AI output close to what you need.$t$, 5, 80)
    returning id into m5;

    insert into academy_modules (workspace_id, day, title, summary, position, pass_pct)
    values (w.id, 2, $t$AI Toolkit Every Modern EA Should Know$t$,
      $t$Which AI tool fits which job, and when a simpler tool is enough.$t$, 6, 80)
    returning id into m6;

    insert into academy_modules (workspace_id, day, title, summary, position, pass_pct)
    values (w.id, 2, $t$AI Workflow Systems$t$,
      $t$Connecting tools into complete workflows so nothing is missed and the executive is involved less.$t$, 7, 80)
    returning id into m7;

    insert into academy_modules (workspace_id, day, title, summary, position, pass_pct)
    values (w.id, 3, $t$Client Tech Stack$t$,
      $t$Why clients use the tools they use. Recognition, not mastery.$t$, 8, 80)
    returning id into m8;

    insert into academy_modules (workspace_id, day, title, summary, position, pass_pct)
    values (w.id, 3, $t$AI Workflow Integration$t$,
      $t$Taking one request from a client and turning it into every piece of work it really needs.$t$, 9, 80)
    returning id into m9;

    insert into academy_modules (workspace_id, day, title, summary, position, pass_pct)
    values (w.id, 3, $t$Client Communication Excellence$t$,
      $t$Proactive updates, clarifying questions, escalation and trust, finished with the 90-minute client simulation.$t$, 10, 80)
    returning id into m10;

    insert into academy_lessons (module_id, title, kind, minutes, position, body) values (m1, $t$The MadeEA difference and the premium EA mindset$t$, 'reading', 15, 1,
$t$Clients are not looking for someone who only completes administrative tasks. They want an assistant who works smarter, adapts quickly and adds value from day one. That is what MadeEA sells, and this course is how every MadeEA assistant starts at the same standard.

A premium EA mindset means:
• You think about the outcome, not only the task in front of you.
• You protect your executive's time, attention and energy.
• You use AI to work faster, and you stay accountable for the result.
• You leave every process a little more organized than you found it.

This course is about readiness, not mastery. You will keep learning with real client work. The aim is that your first day with a client is not your training day.$t$);
    insert into academy_lessons (module_id, title, kind, minutes, position, body) values (m1, $t$Client expectations, and ownership vs task execution$t$, 'reading', 15, 2,
$t$Clients expect three things from day one: reliability, good judgment and clear communication.

Task execution is doing what was asked. Ownership is making sure the outcome happens.

Example: your executive asks you to "book a meeting with Sarah".
• Task execution: you send an invite.
• Ownership: you check both calendars and time zones, add an agenda and the call link, attach what Sarah needs to read, set a reminder to prepare, and confirm once she accepts.

Ownership also means saying early when something is at risk, rather than explaining afterwards why it slipped.$t$);
    insert into academy_lessons (module_id, title, kind, minutes, position, body) values (m1, $t$Professional communication$t$, 'reading', 10, 3,
$t$Every message you send represents your executive and MadeEA.

• Lead with the point. Put the answer, decision or request in the first line.
• Be brief and specific: dates, times with time zones, names, links.
• Match the client's tone, but stay professional.
• Confirm what you understood before acting on anything unclear.
• Close the loop. Tell people when something is done.

Before you send, reread it as the person receiving it. Would they know what to do next?$t$);
    insert into academy_lessons (module_id, title, kind, minutes, position, body) values (m1, $t$Confidentiality and AI ethics$t$, 'reading', 15, 4,
$t$You will see private emails, financial details, contracts, passwords and personal information. Confidentiality is not optional.

When using AI:
• Only put client information into tools the client has approved for their data.
• Remove or anonymize names, figures and personal details when you can.
• Never paste passwords, bank details, ID numbers or health information into an AI tool.
• Get permission before recording or transcribing a meeting.
• You are responsible for anything AI helped you produce. If it is wrong, it is your mistake, not the tool's.

When in doubt, ask before you share.$t$);
    insert into academy_lessons (module_id, title, kind, minutes, position, body) values (m1, $t$Quality standards$t$, 'reading', 10, 5,
$t$Before any work leaves your hands, check it:

• Accurate: names, dates, numbers and links are correct and verified.
• Complete: it answers the whole request, and missing information is flagged.
• Clear: someone busy can understand it in under a minute.
• Consistent: it follows the client's SOPs, templates and file naming.
• On time: or you warned them early that it would not be.

Work that needs a second opinion goes to Review before it goes to the client. New kinds of work become a new SOP, so the next person does it the same way.$t$);
    insert into academy_lessons (module_id, title, kind, minutes, position, body) values (m2, $t$Workflow beats buttons$t$, 'reading', 5, 1,
$t$Modern executive assistance is not about knowing where every button is in Gmail, Calendar or a project management tool. Tools change. Platforms change. AI changes.

The skill that stays valuable is managing the workflow behind them: organizing information, protecting an executive's time, prioritizing work, coordinating meetings, building repeatable systems, and helping an executive decide faster.

Keep asking: "How can I reduce the time, attention and mental energy my executive needs to spend on this?"$t$);
    insert into academy_lessons (module_id, title, kind, minutes, position, body) values (m2, $t$Executive inbox management$t$, 'reading', 10, 2,
$t$Your goal is that your executive only reads what needs them.

• Sort daily into: needs a decision, needs a reply from them, you can handle, for information, and archive.
• Answer what you can, in your executive's agreed voice.
• Summarize the rest in a short daily brief: who, what they need, by when, and your suggested reply.
• Use labels or folders the executive understands, and keep the inbox close to empty.
• Flag anything urgent as soon as you see it, not at the end of the day.$t$);
    insert into academy_lessons (module_id, title, kind, minutes, position, body) values (m2, $t$Calendar strategy and time blocking$t$, 'reading', 10, 3,
$t$A calendar shows what an executive values. Protect it.

• Block focus time for deep work and keep it as firm as a meeting.
• Leave buffers between meetings for travel, breaks and preparation.
• Group similar meetings together, such as calls on one afternoon.
• Always check time zones, and write them in the invite.
• Every meeting should have a purpose, an agenda and a link or location.
• Review the coming week every Friday and fix conflicts before Monday.$t$);
    insert into academy_lessons (module_id, title, kind, minutes, position, body) values (m2, $t$Task prioritization framework$t$, 'reading', 10, 4,
$t$When everything is urgent, nothing is. Use urgency and importance:

• Urgent and important: do it now, or raise it straight away.
• Important, not urgent: schedule it, and protect the time.
• Urgent, not important: handle it quickly or delegate it.
• Neither: drop it, or batch it for later.

Ask yourself: what happens if this waits a day? Who is affected? Is there a deadline someone else depends on? When you are unsure, propose an order and ask your executive to confirm it.$t$);
    insert into academy_lessons (module_id, title, kind, minutes, position, body) values (m2, $t$Meeting coordination$t$, 'reading', 8, 5,
$t$A well-run meeting has three parts.

Before: a clear purpose, the right people, an agenda, documents shared in advance, and a link that works.
During: notes on decisions, action items, owners and deadlines.
After: a follow-up email with decisions and actions, tasks created, and reminders set.

Your executive should never walk into a meeting wondering what it is about.$t$);
    insert into academy_lessons (module_id, title, kind, minutes, position, body) values (m2, $t$File organization and SOP thinking$t$, 'reading', 10, 6,
$t$Information is only useful if it can be found.

• Use one folder structure, agreed with the client, and stick to it.
• Name files so they sort and search well, for example: 2026-11-03 Client Proposal v2.
• Keep one current version. Archive old ones rather than leaving copies everywhere.

SOP thinking: when you do something for the second time, write down how. A good SOP has the trigger, the steps, the tools, and what "done" looks like. SOPs keep quality consistent across EAs and make handovers easy.$t$);
    insert into academy_lessons (module_id, title, kind, minutes, position, body) values (m2, $t$Executive decision support$t$, 'reading', 7, 7,
$t$Executives make many decisions a day. Help them decide faster.

• Bring options, not just problems: two or three choices, with your recommendation.
• Give the key facts, the deadline and what happens if nothing is decided.
• Keep it short enough to answer in one reply.

You are not just managing an inbox, calendar, meetings, files and tasks. You are managing the flow of information, priorities, decisions and time around the executive.$t$);
    insert into academy_lessons (module_id, title, kind, minutes, position, body) values (m3, $t$Google Workspace as one system$t$, 'reading', 5, 1,
$t$Being an effective EA is not about knowing Gmail, Calendar, Docs, Sheets and Drive one by one. It is using them together so that:

• Information is easy to find
• Priorities are visible
• Meetings are properly prepared
• Tasks do not fall through the cracks
• Collaboration is simple
• The executive spends less time on administrative work

AI makes these workflows faster, but it should support good systems, not replace them.$t$);
    insert into academy_lessons (module_id, title, kind, minutes, position, body) values (m3, $t$Gmail shortcuts and Calendar best practices$t$, 'reading', 10, 2,
$t$Gmail:
• Turn on keyboard shortcuts (Settings). Useful ones: c compose, r reply, a reply all, f forward, e archive, # delete, / search, g i go to inbox.
• Use labels and filters to sort mail automatically.
• Save common replies as templates.
• Search operators save time: from:, to:, has:attachment, after:2026/01/01, is:unread.
• Schedule sends so messages arrive at a sensible time for the reader.

Calendar:
• Set working hours and time zones for your executive.
• Use appointment schedules for booking links.
• Attach documents and the agenda to the event itself.
• Use colors consistently, for example external meetings in one color and focus time in another.$t$);
    insert into academy_lessons (module_id, title, kind, minutes, position, body) values (m3, $t$Docs, Sheets and Drive for EAs$t$, 'reading', 10, 3,
$t$Docs: use suggestion mode when editing someone else's work, comments with @mentions to assign actions, and headings so long documents get an outline.

Sheets: the basics an EA uses every week are filters, sorting, freeze header row, data validation (drop-down lists), SUM, COUNTIF and simple conditional formatting.

Drive: one agreed folder structure, shared drives for team files, and sharing set to the right people only. Check "Anyone with the link" settings before sending a link.

File naming convention: date first (YYYY-MM-DD), then what it is, then the version. Example: 2026-11-03 Board Pack v3.$t$);
    insert into academy_lessons (module_id, title, kind, minutes, position, body) values (m3, $t$AI inside Google Workspace (Gemini)$t$, 'reading', 5, 4,
$t$Gemini is built into Google Workspace for many accounts. It can:
• Summarize long email threads in Gmail
• Draft replies and documents in Gmail and Docs
• Help build tables and formulas in Sheets
• Summarize files in Drive

Only use it on client data if the client's Workspace has it enabled and approved. As with any AI tool, review everything it writes before it goes anywhere.$t$);
    insert into academy_lessons (module_id, title, kind, minutes, position, body) values (m3, $t$Mini exercise: organize a client workspace$t$, 'practical', 15, 5,
$t$Practical. Your work is reviewed by an admin.

Scenario: a new client, a founder, sends you 12 files with names like "final FINAL.docx", "Untitled spreadsheet", "scan001.pdf" and "notes".

Write down:
1. The Drive folder structure you would set up for them (top-level folders and one level below).
2. A file naming convention, with three example file names.
3. Three Gmail labels or filters you would create, and what each one catches.
4. One way Gemini or another AI tool could save time here, and one thing you would not use AI for.

Paste your answer below, or a link to a Google Doc shared with your trainer.$t$);
    insert into academy_lessons (module_id, title, kind, minutes, position, body) values (m4, $t$How AI language models work, simply$t$, 'reading', 10, 1,
$t$Tools like ChatGPT, Claude and Gemini are large language models. They learned patterns from a huge amount of text, and they write by predicting what text should come next.

What that means for you:
• They are very good at language: drafting, summarizing, rewriting, organizing and explaining.
• They do not "know" facts the way a database does. They produce what sounds right.
• They only know what is in their training, plus what you give them or what they can search.
• Clear instructions and good context produce much better results.

Being an AI-powered EA does not mean using AI for everything. It means knowing when to use it.$t$);
    insert into academy_lessons (module_id, title, kind, minutes, position, body) values (m4, $t$Hallucinations and verification$t$, 'reading', 10, 2,
$t$A hallucination is when AI states something false with full confidence: a wrong date, an invented quote, a made-up source or a figure that does not exist.

Always verify:
• Names, titles, dates, times and time zones
• Numbers, prices and calculations
• Quotes, sources and links (open them)
• Legal, financial or medical statements
• Anything that will be sent externally or entered into a client system

A good habit: ask the AI to list what it is unsure of, and tell it not to invent information. Then check the facts yourself before you deliver.$t$);
    insert into academy_lessons (module_id, title, kind, minutes, position, body) values (m4, $t$Responsible AI and confidentiality$t$, 'reading', 10, 3,
$t$Responsible AI use means protecting the client, being honest and staying accountable.

• Use only tools approved for that client's data.
• Share the minimum information the task needs. Anonymize where you can.
• Never put passwords, payment details, ID numbers or health records into an AI tool.
• Be transparent if a client asks whether AI was used.
• Respect copyright and other people's work.

You are responsible for the final result, whoever or whatever drafted it.$t$);
    insert into academy_lessons (module_id, title, kind, minutes, position, body) values (m4, $t$When not to use AI, and human judgment$t$, 'reading', 10, 4,
$t$Do not use AI when:
• The information is confidential and the tool is not approved
• The message is sensitive: condolences, conflict, performance or personal matters
• A decision needs judgment about people, relationships or risk
• It would be faster to just do it yourself
• You cannot check whether the answer is right

AI helps process information. You bring judgment: context about your executive, relationships, priorities, timing and tone. AI is a productivity partner, not a decision-maker.$t$);
    insert into academy_lessons (module_id, title, kind, minutes, position, body) values (m4, $t$A real client scenario$t$, 'reading', 10, 5,
$t$Your executive forwards a 30-email thread about a delayed supplier delivery and asks: "Where are we on this?"

A good AI-assisted approach:
1. Check the client has approved the AI tool for this data, and remove anything sensitive you don't need.
2. Ask AI to summarize the thread: what was promised, what changed, who said what, and what is still open.
3. Verify the key dates and amounts against the original emails.
4. Write a three-line update with a recommended next step, in your executive's voice.
5. Offer to draft the reply to the supplier.

AI saved the reading time. You made sure it is right, and you decided what matters.$t$);
    insert into academy_lessons (module_id, title, kind, minutes, position, body) values (m5, $t$Context, instructions and boundaries$t$, 'reading', 10, 1,
$t$AI output depends heavily on the instructions you give it. Compare:

"Write an email."

with:

"Draft a short, professional follow-up email to a potential client who attended a discovery call yesterday. Thank them for their time, mention that the proposal is attached, and invite them to reply with questions. Keep it warm and confident, under 120 words."

Both ask for an email. The second gives AI enough to produce something close to what you need.

Effective prompting is not about magic words. It is: the right context + clear instructions + useful boundaries.$t$);
    insert into academy_lessons (module_id, title, kind, minutes, position, body) values (m5, $t$A prompt pattern for EA work$t$, 'reading', 15, 2,
$t$Use this pattern for most EA prompts:

1. Role: "Act as an experienced Executive Assistant to a CEO."
2. Task: what you want produced.
3. Context: who it is for, background, what has happened so far.
4. Format: bullet points, table, email, length, headings.
5. Boundaries: tone, word limit, what not to do ("Do not invent dates. Flag missing information.").

Then improve it in conversation: "Shorter." "More formal." "Turn this into a table." "What did you assume?"

Save prompts that work well. Over time you build your own prompt library.$t$);
    insert into academy_lessons (module_id, title, kind, minutes, position, body) values (m5, $t$Prompt writing practical$t$, 'practical', 25, 3,
$t$Practical. Your work is reviewed by an admin.

1. Improve a poorly written email using AI. Here is the draft:
"hi, so about the thing next week, we cant do tuesday anymore can u do another day? also send the doc. thx"
Write the prompt you used, and the improved email you would send.

2. Write a prompt for each of these, using the pattern from the last lesson:
a) Summarize a 10-page document into a one-page executive brief.
b) Create meeting minutes from a transcript, with decisions and action items.
c) Build a first draft of an SOP for booking executive travel.

Paste your answers below, or a link to a Google Doc shared with your trainer.$t$);
    insert into academy_lessons (module_id, title, kind, minutes, position, body) values (m6, $t$Choosing the right tool$t$, 'reading', 10, 1,
$t$Being an AI-powered EA does not mean using one AI tool for everything. Different tools suit different work.

For any task, ask:
• What does each tool do well?
• Which tool fits this task?
• What information can safely be provided?
• What output still needs checking?
• Is a simpler tool enough?

The goal is not to become an expert in every AI platform. It is to build a toolkit and know which tool to reach for.$t$);
    insert into academy_lessons (module_id, title, kind, minutes, position, body) values (m6, $t$Writing, research and knowledge tools$t$, 'reading', 20, 2,
$t$ChatGPT: a general assistant for drafting, rewriting, summarizing, brainstorming and working with files. Good all-rounder.

Claude: strong at long documents, careful writing and following detailed instructions. Good for contracts, reports and long threads.

Perplexity: AI search that answers with sources you can click. Use it for research, then open the sources to verify.

NotebookLM: you upload your own documents and it answers only from them, with citations. Great for building a knowledge notebook for a client, project or onboarding pack.

Verify facts from all of them before delivering.$t$);
    insert into academy_lessons (module_id, title, kind, minutes, position, body) values (m6, $t$Presentation and visual tools$t$, 'reading', 15, 3,
$t$Gamma: turns an outline or document into a presentation, document or simple web page in minutes. Edit the result; don't send the first draft.

Napkin AI: turns text into simple diagrams and visuals, useful for explaining a process or idea.

Canva Magic Studio: AI features inside Canva for designs, social posts, resizing and editing images. Use the client's brand kit when they have one.

Use these when the format matters as much as the content: briefings, proposals, one-pagers and updates.$t$);
    insert into academy_lessons (module_id, title, kind, minutes, position, body) values (m6, $t$Meeting and voice tools$t$, 'reading', 15, 4,
$t$Fathom AI: records, transcribes and summarizes video calls, with highlights and action items.

Granola (overview): an AI notepad for meetings. It improves your own notes using the meeting audio.

ElevenLabs (basic overview): creates realistic voice audio from text, for example a voiceover for a training video. Never clone someone's voice without their clear permission.

Always make sure recording or transcription is authorized by everyone in the meeting.$t$);
    insert into academy_lessons (module_id, title, kind, minutes, position, body) values (m7, $t$Understanding AI workflow systems$t$, 'reading', 10, 1,
$t$Using tools one at a time is useful. The real advantage comes from connecting them into complete workflows.

An AI workflow is a sequence of steps where information moves between tools, people and processes to reach an outcome. Every workflow should answer:
• What triggers the process?
• What information is needed?
• Which tools can support it?
• What is the expected output?
• Who reviews and completes it?

Receiving an email is not the end of a task. It may need a reply, a calendar invite, a reminder and an update to the executive.

Key principle: AI helps process information. You stay responsible for accuracy, decisions and follow-through.$t$);
    insert into academy_lessons (module_id, title, kind, minutes, position, body) values (m7, $t$Workflow 1: Meeting to action$t$, 'reading', 15, 2,
$t$Meeting → Transcript → AI summary → Action items → Follow-up email → Asana tasks → Weekly report

Scenario: your executive has a 45-minute project meeting with the marketing team. Decisions are made, deadlines discussed and responsibilities assigned.

1. Capture the meeting (Fathom or Granola). Make sure recording is authorized.
2. Generate the transcript. Check it is accurate.
3. Summarize (ChatGPT or Claude). Identify key decisions and discussion points.
4. Extract actions. Confirm owners and deadlines.
5. Draft the follow-up email. Review it before sending.
6. Create tasks in Asana with owners and due dates.
7. Prepare the weekly report, combining progress and open items.

Sample prompt:
"Act as an experienced Executive Assistant. Review the following meeting transcript and produce: 1. A concise executive summary. 2. Key decisions made. 3. Action items with owners and deadlines. 4. Outstanding questions requiring clarification. 5. A professional follow-up email. Do not invent deadlines, decisions, or task owners. Clearly flag missing information. Transcript: [insert approved transcript]"

Outcome: a meeting becomes documented decisions, assigned responsibilities and trackable follow-ups.$t$);
    insert into academy_lessons (module_id, title, kind, minutes, position, body) values (m7, $t$Workflow 2: Inbox to follow-up$t$, 'reading', 10, 3,
$t$Inbox → AI draft → Reply → Calendar → Follow-up tracking

Scenario: a potential client emails your executive asking for a meeting about a partnership. Don't just reply.

1. Review the request and decide its priority.
2. Use AI to prepare a professional response.
3. Check the executive's calendar for available times.
4. Send the reviewed reply with suitable options.
5. Create the calendar event once confirmed.
6. Add a reminder to prepare meeting materials.
7. Track any outstanding reply or follow-up.

Outcome: the meeting is coordinated, the executive is prepared, and no follow-up is forgotten.$t$);
    insert into academy_lessons (module_id, title, kind, minutes, position, body) values (m7, $t$Workflow 3: Research to executive briefing$t$, 'reading', 15, 4,
$t$Research (Perplexity) → Analyze (ChatGPT or Claude) → Organize (Google Docs) → Present (Gamma or Canva)

Scenario: your executive meets a prospective partner tomorrow and wants a short company briefing.

• Research: gather company information and credible sources with Perplexity.
• Analysis: use ChatGPT or Claude to pull out relevant business insights.
• Documentation: write a one-page briefing in Google Docs.
• Presentation: make a short visual summary in Gamma or Canva.
• Verification: check company details, claims, dates and sources before delivery.

The briefing covers: company overview, key leadership, business activities, recent developments, possible discussion points and questions the executive may want to ask.$t$);
    insert into academy_lessons (module_id, title, kind, minutes, position, body) values (m7, $t$Designing your own AI workflow$t$, 'reading', 10, 5,
$t$Not every workflow needs several AI tools. Choose the simplest reliable process.

1. Identify the trigger: what starts it?
2. Define the outcome: what must be delivered?
3. Choose the right tools: which reduce manual work?
4. Add quality checkpoints: what needs checking or executive approval?
5. Close the loop: how will completion and follow-up be tracked?

AI output must be reviewed before it is shared externally or entered into client systems. Sensitive information only goes through tools approved for that client's data.

Teach yourself systems, not tools.$t$);
    insert into academy_lessons (module_id, title, kind, minutes, position, body) values (m7, $t$Day 2 practical assessment$t$, 'practical', 60, 6,
$t$Practical. Your work is reviewed by an admin.

Pick a real, public company (for example a well-known software or retail company). Your executive is meeting its leadership next week. Using several AI tools, produce:

1. A research report: key facts about the company, with sources (Perplexity).
2. An executive briefing: one page, with discussion points and questions to ask.
3. A meeting summary: write a short made-up meeting transcript about the partnership (or use one your trainer gives you), then produce minutes with decisions and action items.
4. A professional email following up that meeting.
5. A short presentation (5 to 7 slides) summarizing the opportunity (Gamma or Canva).

Paste links to your files below (shared with your trainer), and list which AI tool you used for each part and what you checked by hand.$t$);
    insert into academy_lessons (module_id, title, kind, minutes, position, body) values (m8, $t$Communication and meetings$t$, 'reading', 10, 1,
$t$No mastery required, recognition only. Know why clients use these.

Slack: team chat organized in channels. Fast, informal, used by many startups and tech teams.
Microsoft Teams: chat, meetings and files for companies on Microsoft 365.
Google Meet: video calls built into Google Workspace and Calendar.
Zoom: video meetings and webinars, common with external guests.

Learn the client's habits: which tool is for urgent messages, which for updates, and when to email instead.$t$);
    insert into academy_lessons (module_id, title, kind, minutes, position, body) values (m8, $t$Project and work management$t$, 'reading', 15, 2,
$t$Asana: tasks and projects with owners, due dates and timelines. Popular with marketing and operations teams.
ClickUp: an all-in-one workspace for tasks, docs and goals. Very customizable.
Notion: docs, wikis and simple databases in one place. Often the company handbook.
Trello: simple boards with cards moving across columns.
Monday.com: visual boards and workflows, often for operations and sales teams.

They all do the same core job: who is doing what, by when. Find out how the client uses theirs, and follow their system rather than bringing your own.$t$);
    insert into academy_lessons (module_id, title, kind, minutes, position, body) values (m8, $t$Scheduling, video and automation$t$, 'reading', 10, 3,
$t$Calendly: booking links so people choose a time without back-and-forth email.
Loom: quick screen recordings, great for explaining something instead of a meeting.
Zapier (overview): connects apps so one action triggers another, for example a new form entry creates a task.
Make (overview): like Zapier, with more complex visual workflows.

You don't need to build automations. Recognize when a repeated manual task could be automated, and suggest it.$t$);
    insert into academy_lessons (module_id, title, kind, minutes, position, body) values (m8, $t$Google Workspace and Microsoft 365$t$, 'reading', 10, 4,
$t$Most clients run on one of two suites:

Google Workspace: Gmail, Calendar, Drive, Docs, Sheets, Slides and Meet.
Microsoft 365: Outlook, OneDrive, SharePoint, Word, Excel, PowerPoint and Teams.

The skills are the same across both: inbox, calendar, documents, spreadsheets and files. Only the buttons differ. If a client uses the one you know less, spend the first day learning where things are.$t$);
    insert into academy_lessons (module_id, title, kind, minutes, position, body) values (m9, $t$From one request to the full job$t$, 'reading', 15, 1,
$t$Client asks: "Can you prepare for tomorrow's board meeting?"

A ready EA hears more than one task. With AI where it helps:
1. Research: anything new on the board members, the company and the topics.
2. Summarize: last meeting's minutes and the papers for this one.
3. Create slides for any update your executive presents.
4. Draft the agenda, with timings.
5. Prepare an executive brief: key issues, decisions needed, likely questions.
6. Draft the follow-up email, ready to complete after the meeting.
7. Schedule: confirm the time, room or link, and any prep meeting.
8. Produce an action list to track outcomes.

Confirm the scope first: "Here is what I plan to prepare by 5 PM. Anything to add?"$t$);
    insert into academy_lessons (module_id, title, kind, minutes, position, body) values (m9, $t$Putting it together under time pressure$t$, 'reading', 15, 2,
$t$When a request is big and the time is short:

• Start with what the executive needs first, usually the brief and the agenda.
• Use AI for first drafts, then spend your time on checking and judgment.
• Share drafts early ("Draft brief attached, slides in an hour") rather than everything at the last minute.
• Keep a checklist so nothing from the request is forgotten.
• Note what you did and how long it took. Next time it becomes an SOP.

Speed comes from systems you have already built, not from rushing.$t$);
    insert into academy_lessons (module_id, title, kind, minutes, position, body) values (m10, $t$Proactive communication and professional updates$t$, 'reading', 10, 1,
$t$Don't make your executive ask for an update.

• Send short, regular updates: done, in progress, blocked, needs you.
• Share bad news early, with a plan.
• Confirm when tasks are finished. Silence makes people wonder.
• Use the client's preferred channel and keep it consistent.

A good update can be read in 30 seconds and makes clear what, if anything, the executive needs to do.$t$);
    insert into academy_lessons (module_id, title, kind, minutes, position, body) values (m10, $t$Clarifying questions and time estimation$t$, 'reading', 10, 2,
$t$Ask good questions before you start, not after you finish.

• Ask when the outcome, deadline, audience or format is unclear.
• Group your questions into one message, and suggest answers: "I'll assume X unless you say otherwise."

Time estimation:
• Break the work into steps and estimate each one.
• Add a buffer for checking and surprises.
• Say when you'll deliver, and if that changes, say so as soon as you know.$t$);
    insert into academy_lessons (module_id, title, kind, minutes, position, body) values (m10, $t$Escalation and urgent requests$t$, 'reading', 10, 3,
$t$Escalate when something is blocked, risky, outside your authority or about to miss a deadline. Escalating early is professional, not a failure.

A good escalation says: what happened, the impact, what you have tried, the options, and what you need from them, by when.

For urgent requests: confirm what "urgent" means (within the hour or today), reprioritize openly ("I'll pause X to do this"), and tell anyone affected.$t$);
    insert into academy_lessons (module_id, title, kind, minutes, position, body) values (m10, $t$Managing multiple executives$t$, 'reading', 8, 4,
$t$When you support more than one executive:

• Know each one's priorities, preferences and working hours.
• Keep their calendars, files and information separate and confidential.
• When requests conflict, don't choose secretly. Explain the conflict and ask, or follow the priority order agreed with the client.
• Use one task list so you can see everything you have committed to.$t$);
    insert into academy_lessons (module_id, title, kind, minutes, position, body) values (m10, $t$Building trust remotely$t$, 'reading', 7, 5,
$t$Remote trust is built through reliability you can see.

• Do what you said, when you said.
• Be reachable during agreed hours, and say when you won't be.
• Keep work visible: task boards, EOD reports, shared documents.
• Admit mistakes quickly and fix them.
• Protect confidential information every time.

Over time, trust means your executive delegates more, and that is where you add the most value.$t$);
    insert into academy_lessons (module_id, title, kind, minutes, position, body) values (m10, $t$Final client simulation (90 minutes)$t$, 'practical', 90, 6,
$t$Capstone. Your work is reviewed by an admin. Everything you need is on this page: the CEO's profile, the calendar and the files. Press Start when you have 90 uninterrupted minutes. Emails keep arriving while the clock runs.

You are supporting a CEO. During the 90 minutes:
• 18 emails arrive
• two meetings conflict
• an urgent travel request comes in
• meeting minutes are needed
• a client presentation is needed
• a research request comes in
• there is a calendar conflict
• the executive asks for a briefing

Use AI where appropriate. Deliver:
• professional email replies
• meeting notes
• an executive briefing
• a presentation
• your calendar decisions, with reasons
• your task priorities, with reasons

Paste links to your work below (shared with your trainer), with a short note on how you prioritized and where you used AI.$t$);

    insert into academy_questions (module_id, prompt, choices, explanation, position) values (m1, $t$What separates ownership from task execution?$t$,
      $t$["Doing exactly what was asked, quickly","Making sure the outcome happens, including the steps nobody spelled out","Asking the executive to confirm every step","Doing the task yourself instead of delegating it"]$t$::jsonb, $t$Task execution is doing what was asked. Ownership is making sure the outcome happens.$t$, 1) returning id into q;
    insert into academy_answer_key values (q, 1);
    insert into academy_questions (module_id, prompt, choices, explanation, position) values (m1, $t$Your executive says "book a meeting with Sarah". What does a MadeEA assistant do?$t$,
      $t$["Send an invite for the first free slot","Ask the executive to pick a time","Check both calendars and time zones, add an agenda and link, attach what Sarah needs and confirm once accepted","Email Sarah asking when she is free and wait"]$t$::jsonb, $t$Ownership: the meeting should be ready to run, not just booked.$t$, 2) returning id into q;
    insert into academy_answer_key values (q, 2);
    insert into academy_questions (module_id, prompt, choices, explanation, position) values (m1, $t$Where should the main point of a professional message go?$t$,
      $t$["In the first line","In the last line","In an attachment","Wherever it fits naturally"]$t$::jsonb, $t$Lead with the point. Busy readers may only read the first line.$t$, 3) returning id into q;
    insert into academy_answer_key values (q, 0);
    insert into academy_questions (module_id, prompt, choices, explanation, position) values (m1, $t$Which of these should never go into an AI tool?$t$,
      $t$["A meeting agenda with no client names","A public company's press release","A draft email you wrote","A client's bank account details"]$t$::jsonb, $t$Passwords, payment details, ID numbers and health information never go into AI tools.$t$, 4) returning id into q;
    insert into academy_answer_key values (q, 3);
    insert into academy_questions (module_id, prompt, choices, explanation, position) values (m1, $t$A client hasn't approved any AI tools for their data yet. What do you do?$t$,
      $t$["Use a free AI tool, it's faster","Do the work without AI, or anonymize it, until approval is confirmed","Use AI and tell them afterwards","Ask a colleague to run it through their account"]$t$::jsonb, $t$Only use AI tools the client has approved for their data.$t$, 5) returning id into q;
    insert into academy_answer_key values (q, 1);
    insert into academy_questions (module_id, prompt, choices, explanation, position) values (m1, $t$AI drafted a client report and it contains a wrong figure. Whose mistake is it?$t$,
      $t$["The AI tool's","The client's, for not checking","Yours, because you are responsible for anything AI helped you produce","Nobody's, it's a known limitation"]$t$::jsonb, $t$You stay accountable for the final result, whoever or whatever drafted it.$t$, 6) returning id into q;
    insert into academy_answer_key values (q, 2);
    insert into academy_questions (module_id, prompt, choices, explanation, position) values (m1, $t$You realize a deliverable will be late. When do you say so?$t$,
      $t$["As soon as you know, with a new time","When the deadline arrives","Only if the client asks","In the next weekly report"]$t$::jsonb, $t$Saying early that something is at risk is part of ownership.$t$, 7) returning id into q;
    insert into academy_answer_key values (q, 0);
    insert into academy_questions (module_id, prompt, choices, explanation, position) values (m1, $t$Which is NOT one of the quality checks before work leaves your hands?$t$,
      $t$["Accurate","Complete","On time, or flagged early","Long and detailed"]$t$::jsonb, $t$The checks are accurate, complete, clear, consistent and on time. Long is not a goal; clear is.$t$, 8) returning id into q;
    insert into academy_answer_key values (q, 3);
    insert into academy_questions (module_id, prompt, choices, explanation, position) values (m1, $t$You do a new kind of task for a client for the second time. What should you do?$t$,
      $t$["Nothing different","Write an SOP so it is done the same way next time","Ask the client to write instructions","Delegate it to someone else"]$t$::jsonb, $t$When you do something for the second time, write down how. SOPs keep quality consistent across EAs.$t$, 9) returning id into q;
    insert into academy_answer_key values (q, 1);
    insert into academy_questions (module_id, prompt, choices, explanation, position) values (m1, $t$What is the goal of the Made Ready course?$t$,
      $t$["Becoming an AI expert","Learning every client tool in depth","A consistent foundation so you are ready from your first day with a client","Replacing on-the-job learning"]$t$::jsonb, $t$Readiness, not mastery. Learning continues with real client work.$t$, 10) returning id into q;
    insert into academy_answer_key values (q, 2);
    insert into academy_questions (module_id, prompt, choices, explanation, position) values (m2, $t$Your executive's inbox has 140 unread emails. What do you give them?$t$,
      $t$["A forward of every important email","A short brief: what needs a decision or reply from them, by when, with suggested replies","Nothing; you reply to everything yourself","A list of all 140 subjects"]$t$::jsonb, $t$Your executive should only read what needs them.$t$, 1) returning id into q;
    insert into academy_answer_key values (q, 1);
    insert into academy_questions (module_id, prompt, choices, explanation, position) values (m2, $t$Your executive has back-to-back calls all Tuesday. What is the best fix?$t$,
      $t$["Cancel half of them","Leave it, they agreed to them","Move them all to Wednesday","Add buffers, group similar calls, and protect a focus block for next week"]$t$::jsonb, $t$Buffers, grouping and protected focus time are calendar strategy.$t$, 2) returning id into q;
    insert into academy_answer_key values (q, 3);
    insert into academy_questions (module_id, prompt, choices, explanation, position) values (m2, $t$A task is important but not urgent. What do you do with it?$t$,
      $t$["Schedule it and protect the time","Do it immediately","Drop it","Delegate it to anyone available"]$t$::jsonb, $t$Important, not urgent: schedule it. That is how important work stops becoming an emergency.$t$, 3) returning id into q;
    insert into academy_answer_key values (q, 0);
    insert into academy_questions (module_id, prompt, choices, explanation, position) values (m2, $t$What should happen right after a meeting?$t$,
      $t$["Nothing until the next meeting","Share the recording only","A follow-up with decisions and action items, tasks created and reminders set","Ask everyone what they remember"]$t$::jsonb, $t$After: follow-up email, tasks and reminders.$t$, 4) returning id into q;
    insert into academy_answer_key values (q, 2);
    insert into academy_questions (module_id, prompt, choices, explanation, position) values (m2, $t$Which file name follows a good naming convention?$t$,
      $t$["final FINAL v2 (1).docx","2026-11-03 Client Proposal v2","Proposal","Copy of Untitled document"]$t$::jsonb, $t$Date first, then what it is, then the version, so files sort and search well.$t$, 5) returning id into q;
    insert into academy_answer_key values (q, 1);
    insert into academy_questions (module_id, prompt, choices, explanation, position) values (m2, $t$Your executive must choose a venue for an event. How do you help?$t$,
      $t$["Pick one yourself and book it","Send them every option you found","Ask them to research it","Give two or three options with key facts, a deadline and your recommendation"]$t$::jsonb, $t$Bring options, not just problems, and make the decision easy to answer in one reply.$t$, 6) returning id into q;
    insert into academy_answer_key values (q, 3);
    insert into academy_questions (module_id, prompt, choices, explanation, position) values (m3, $t$Which Gmail search finds unread emails from a client with attachments?$t$,
      $t$["unread client attachment","from:client@example.com has:attachment is:unread","client + file + new","label:client unread"]$t$::jsonb, $t$Search operators like from:, has:attachment and is:unread save time.$t$, 1) returning id into q;
    insert into academy_answer_key values (q, 1);
    insert into academy_questions (module_id, prompt, choices, explanation, position) values (m3, $t$You are editing a document your executive wrote. What mode do you use?$t$,
      $t$["Suggestion mode, so they can accept or reject changes","Editing mode, and tell them later","Make a copy and edit that","Comment only, never edit"]$t$::jsonb, $t$Suggestion mode keeps the author in control.$t$, 2) returning id into q;
    insert into academy_answer_key values (q, 0);
    insert into academy_questions (module_id, prompt, choices, explanation, position) values (m3, $t$Before sending a Drive link outside the company, what do you check?$t$,
      $t$["The file size","The file color","Sharing settings, so only the right people can open it","That it is a PDF"]$t$::jsonb, $t$Check "Anyone with the link" settings before sending a link.$t$, 3) returning id into q;
    insert into academy_answer_key values (q, 2);
    insert into academy_questions (module_id, prompt, choices, explanation, position) values (m3, $t$When is it fine to use Gemini on a client's emails?$t$,
      $t$["Always, it's built into Google","Never","Only on weekends","When the client's Workspace has it enabled and approved"]$t$::jsonb, $t$Only use AI on client data the client has approved.$t$, 4) returning id into q;
    insert into academy_answer_key values (q, 3);
    insert into academy_questions (module_id, prompt, choices, explanation, position) values (m3, $t$What is the main goal of using Workspace tools together?$t$,
      $t$["Using as many features as possible","An organized system where information is easy to find and nothing falls through the cracks","Replacing every process with AI","Making documents look better"]$t$::jsonb, $t$AI should support good systems, not replace them.$t$, 5) returning id into q;
    insert into academy_answer_key values (q, 1);
    insert into academy_questions (module_id, prompt, choices, explanation, position) values (m4, $t$How does a language model like ChatGPT produce an answer?$t$,
      $t$["It looks up facts in a verified database","It copies from one website","It predicts what text should come next, based on patterns it learned","A person writes it in real time"]$t$::jsonb, $t$That is why it can sound right while being wrong.$t$, 1) returning id into q;
    insert into academy_answer_key values (q, 2);
    insert into academy_questions (module_id, prompt, choices, explanation, position) values (m4, $t$What is an AI "hallucination"?$t$,
      $t$["A confident answer that is false or invented","When the tool is slow","When AI refuses to answer","An image generated by AI"]$t$::jsonb, $t$Invented dates, quotes, sources and figures are the classic examples.$t$, 2) returning id into q;
    insert into academy_answer_key values (q, 0);
    insert into academy_questions (module_id, prompt, choices, explanation, position) values (m4, $t$AI gives you a revenue figure for a company briefing. What do you do?$t$,
      $t$["Use it, AI is usually right","Round it to be safe","Leave it out without saying","Check it against a reliable source before it goes in"]$t$::jsonb, $t$Numbers going to an executive or client are always verified.$t$, 3) returning id into q;
    insert into academy_answer_key values (q, 3);
    insert into academy_questions (module_id, prompt, choices, explanation, position) values (m4, $t$Which task is a poor fit for AI?$t$,
      $t$["Summarizing a long email thread","Writing a condolence message to a client whose parent died","Turning notes into a table","Drafting an agenda"]$t$::jsonb, $t$Sensitive, personal messages need human judgment and care.$t$, 4) returning id into q;
    insert into academy_answer_key values (q, 1);
    insert into academy_questions (module_id, prompt, choices, explanation, position) values (m4, $t$What is the role of human judgment when using AI?$t$,
      $t$["None, AI handles it","Only to fix spelling","Bringing context, priorities, relationships and tone, and deciding what is right","Approving whatever AI writes"]$t$::jsonb, $t$AI is a productivity partner. You remain accountable for the result.$t$, 5) returning id into q;
    insert into academy_answer_key values (q, 2);
    insert into academy_questions (module_id, prompt, choices, explanation, position) values (m4, $t$Before summarizing a client thread with AI, what is the first check?$t$,
      $t$["That the tool is approved for this client's data","That the thread is short","That the executive is online","That the AI has a paid plan"]$t$::jsonb, $t$Approval and confidentiality come first.$t$, 6) returning id into q;
    insert into academy_answer_key values (q, 0);
    insert into academy_questions (module_id, prompt, choices, explanation, position) values (m4, $t$How can you reduce hallucinations in a prompt?$t$,
      $t$["Use longer words","Ask it to be creative","Ask the same question twice","Tell it not to invent information and to flag what it's unsure of"]$t$::jsonb, $t$Then verify the facts yourself.$t$, 7) returning id into q;
    insert into academy_answer_key values (q, 3);
    insert into academy_questions (module_id, prompt, choices, explanation, position) values (m5, $t$What makes a good prompt?$t$,
      $t$["Secret keywords","The right context, clear instructions and useful boundaries","As few words as possible","Polite phrasing"]$t$::jsonb, $t$Effective prompting is not about magic words.$t$, 1) returning id into q;
    insert into academy_answer_key values (q, 1);
    insert into academy_questions (module_id, prompt, choices, explanation, position) values (m5, $t$Which prompt will produce the best follow-up email?$t$,
      $t$["Write an email.","Write a good email to a client.","Draft a short, warm follow-up to a prospect from yesterday's discovery call, mention the attached proposal and invite questions, under 120 words.","Email, professional, now."]$t$::jsonb, $t$It gives the audience, the purpose, the content and a limit.$t$, 2) returning id into q;
    insert into academy_answer_key values (q, 2);
    insert into academy_questions (module_id, prompt, choices, explanation, position) values (m5, $t$In the prompt pattern, what does a "boundary" look like?$t$,
      $t$["\"Do not invent dates. Flag missing information.\"","\"Act as an Executive Assistant.\"","\"Summarize this document.\"","\"Here is the transcript.\""]$t$::jsonb, $t$Boundaries set tone, limits and what not to do.$t$, 3) returning id into q;
    insert into academy_answer_key values (q, 0);
    insert into academy_questions (module_id, prompt, choices, explanation, position) values (m5, $t$The first AI draft is too long and too formal. What next?$t$,
      $t$["Start a new chat and try again from scratch","Send it anyway","Rewrite it all yourself","Ask it to refine: shorter, warmer, three sentences"]$t$::jsonb, $t$Improve the result in conversation.$t$, 4) returning id into q;
    insert into academy_answer_key values (q, 3);
    insert into academy_questions (module_id, prompt, choices, explanation, position) values (m5, $t$Why save prompts that work well?$t$,
      $t$["AI tools delete them otherwise","To build a prompt library you can reuse for repeated tasks","Clients ask for them","It's required by the AI tools"]$t$::jsonb, $t$Reusable prompts make repeated work faster and more consistent.$t$, 5) returning id into q;
    insert into academy_answer_key values (q, 1);
    insert into academy_questions (module_id, prompt, choices, explanation, position) values (m6, $t$You need research on a company with sources you can click and check. Which tool fits?$t$,
      $t$["Canva Magic Studio","ElevenLabs","Perplexity","Napkin AI"]$t$::jsonb, $t$Perplexity answers with sources. Open them to verify.$t$, 1) returning id into q;
    insert into academy_answer_key values (q, 2);
    insert into academy_questions (module_id, prompt, choices, explanation, position) values (m6, $t$You want answers drawn only from a client's own onboarding documents, with citations. Which tool fits?$t$,
      $t$["NotebookLM","Gamma","Fathom","Zapier"]$t$::jsonb, $t$NotebookLM answers from the documents you upload.$t$, 2) returning id into q;
    insert into academy_answer_key values (q, 0);
    insert into academy_questions (module_id, prompt, choices, explanation, position) values (m6, $t$You need a 6-slide presentation from an outline, quickly. Which tool fits?$t$,
      $t$["Perplexity","Gamma","Granola","Calendly"]$t$::jsonb, $t$Gamma turns an outline into slides. Edit before sending.$t$, 3) returning id into q;
    insert into academy_answer_key values (q, 1);
    insert into academy_questions (module_id, prompt, choices, explanation, position) values (m6, $t$You need a recorded call summarized with action items. Which tool fits?$t$,
      $t$["Canva","Napkin AI","NotebookLM","Fathom"]$t$::jsonb, $t$Fathom records, transcribes and summarizes calls. Recording must be authorized.$t$, 4) returning id into q;
    insert into academy_answer_key values (q, 3);
    insert into academy_questions (module_id, prompt, choices, explanation, position) values (m6, $t$You want to explain a 5-step process as a simple diagram. Which tool fits?$t$,
      $t$["ElevenLabs","Perplexity","Napkin AI","Granola"]$t$::jsonb, $t$Napkin AI turns text into simple visuals.$t$, 5) returning id into q;
    insert into academy_answer_key values (q, 2);
    insert into academy_questions (module_id, prompt, choices, explanation, position) values (m6, $t$A client asks for a 40-page contract summary with risky clauses flagged. Which tool fits best?$t$,
      $t$["Claude, which handles long documents and detailed instructions well","Canva Magic Studio","Calendly","ElevenLabs"]$t$::jsonb, $t$Match the tool to the shape of the job: long document in, careful summary out.$t$, 6) returning id into q;
    insert into academy_answer_key values (q, 0);
    insert into academy_questions (module_id, prompt, choices, explanation, position) values (m6, $t$A client wants a voiceover for a training video in their CEO's cloned voice. What is required?$t$,
      $t$["Nothing, it's a common feature","The CEO's clear permission","A paid plan only","A Loom recording"]$t$::jsonb, $t$Never clone someone's voice without their clear permission.$t$, 7) returning id into q;
    insert into academy_answer_key values (q, 1);
    insert into academy_questions (module_id, prompt, choices, explanation, position) values (m6, $t$When is a simpler tool the right choice over AI?$t$,
      $t$["Never","Only for clients without AI","When the task is confidential","When the simple tool does the job just as well and faster"]$t$::jsonb, $t$Choose the simplest reliable process.$t$, 8) returning id into q;
    insert into academy_answer_key values (q, 3);
    insert into academy_questions (module_id, prompt, choices, explanation, position) values (m7, $t$Which question does every workflow need to answer?$t$,
      $t$["Which tool is newest?","How many steps can we add?","What triggers it, and who reviews and completes it?","Which AI is the cheapest?"]$t$::jsonb, $t$Trigger, information, tools, output and who is responsible.$t$, 1) returning id into q;
    insert into academy_answer_key values (q, 2);
    insert into academy_questions (module_id, prompt, choices, explanation, position) values (m7, $t$In the meeting-to-action workflow, what must you confirm when extracting actions?$t$,
      $t$["Owners and deadlines","The meeting's length","The transcript's word count","The recording quality"]$t$::jsonb, $t$Do not invent deadlines, decisions or task owners. Flag what's missing.$t$, 2) returning id into q;
    insert into academy_answer_key values (q, 0);
    insert into academy_questions (module_id, prompt, choices, explanation, position) values (m7, $t$A prospect emails asking for a meeting. Replying is step one. What else completes the workflow?$t$,
      $t$["Nothing else","Offer times, create the event once confirmed, set a prep reminder and track the reply","Forward it to the executive","Archive the email"]$t$::jsonb, $t$No follow-up should be forgotten.$t$, 3) returning id into q;
    insert into academy_answer_key values (q, 1);
    insert into academy_questions (module_id, prompt, choices, explanation, position) values (m7, $t$What is the last step before a research briefing goes to the executive?$t$,
      $t$["Making it longer","Adding more AI tools","Converting it to PDF","Verifying details, claims, dates and sources"]$t$::jsonb, $t$Verification comes before delivery.$t$, 4) returning id into q;
    insert into academy_answer_key values (q, 3);
    insert into academy_questions (module_id, prompt, choices, explanation, position) values (m7, $t$AI-generated output is ready to enter into a client's CRM. What first?$t$,
      $t$["Enter it straight away","Ask the AI if it is correct","Review it","Wait a day"]$t$::jsonb, $t$AI output is reviewed before it is shared externally or entered into client systems.$t$, 5) returning id into q;
    insert into academy_answer_key values (q, 2);
    insert into academy_questions (module_id, prompt, choices, explanation, position) values (m7, $t$What does "close the loop" mean in a workflow?$t$,
      $t$["Tracking completion and follow-up","Closing the browser tabs","Ending the meeting on time","Deleting the draft"]$t$::jsonb, $t$A workflow isn't done until completion and follow-up are tracked.$t$, 6) returning id into q;
    insert into academy_answer_key values (q, 0);
    insert into academy_questions (module_id, prompt, choices, explanation, position) values (m8, $t$A client's team chats in channels and expects quick replies there. Which tool is it most likely?$t$,
      $t$["Trello","Slack","Calendly","Make"]$t$::jsonb, $t$Slack organizes team chat into channels.$t$, 1) returning id into q;
    insert into academy_answer_key values (q, 1);
    insert into academy_questions (module_id, prompt, choices, explanation, position) values (m8, $t$Which tool lets people choose a meeting time without back-and-forth email?$t$,
      $t$["Notion","Loom","Zapier","Calendly"]$t$::jsonb, $t$Booking links remove the back-and-forth.$t$, 2) returning id into q;
    insert into academy_answer_key values (q, 3);
    insert into academy_questions (module_id, prompt, choices, explanation, position) values (m8, $t$You want to show a colleague how to file expenses without a meeting. Which tool?$t$,
      $t$["Loom","Monday.com","Zoom","Perplexity"]$t$::jsonb, $t$A quick screen recording replaces a meeting.$t$, 3) returning id into q;
    insert into academy_answer_key values (q, 0);
    insert into academy_questions (module_id, prompt, choices, explanation, position) values (m8, $t$A form entry should automatically create a task. Which tools do that?$t$,
      $t$["Canva and Gamma","Zoom and Meet","Zapier or Make","Word and Excel"]$t$::jsonb, $t$Automation tools connect apps so one action triggers another.$t$, 4) returning id into q;
    insert into academy_answer_key values (q, 2);
    insert into academy_questions (module_id, prompt, choices, explanation, position) values (m8, $t$A client uses Outlook, OneDrive and Teams. Which suite are they on?$t$,
      $t$["Google Workspace","Microsoft 365","Notion","ClickUp"]$t$::jsonb, $t$The skills are the same; only the buttons differ.$t$, 5) returning id into q;
    insert into academy_answer_key values (q, 1);
    insert into academy_questions (module_id, prompt, choices, explanation, position) values (m8, $t$Your client tracks work in ClickUp, but you prefer Asana. What do you do?$t$,
      $t$["Move everything to Asana","Use both","Keep your own list privately","Follow the client's system"]$t$::jsonb, $t$Learn how the client uses their tools rather than bringing your own.$t$, 6) returning id into q;
    insert into academy_answer_key values (q, 3);
    insert into academy_questions (module_id, prompt, choices, explanation, position) values (m9, $t$"Prepare for tomorrow's board meeting." What should you do first?$t$,
      $t$["Start making slides","Wait for more instructions","Confirm the scope: what you'll prepare and by when","Research everything you can"]$t$::jsonb, $t$Confirm scope first so you deliver what is needed.$t$, 1) returning id into q;
    insert into academy_answer_key values (q, 2);
    insert into academy_questions (module_id, prompt, choices, explanation, position) values (m9, $t$Time is short. What does the executive usually need first?$t$,
      $t$["The brief and the agenda","The follow-up email","The action list","The slide design"]$t$::jsonb, $t$Start with what they need first.$t$, 2) returning id into q;
    insert into academy_answer_key values (q, 0);
    insert into academy_questions (module_id, prompt, choices, explanation, position) values (m9, $t$Where should most of your time go when AI drafts the first versions?$t$,
      $t$["Making more drafts","Checking and applying judgment","Formatting","Choosing fonts"]$t$::jsonb, $t$Use AI for first drafts; spend your time on checking and judgment.$t$, 3) returning id into q;
    insert into academy_answer_key values (q, 1);
    insert into academy_questions (module_id, prompt, choices, explanation, position) values (m9, $t$Why share drafts early on a big request?$t$,
      $t$["To look busy","Because AI requires it","To skip checking","So the executive can steer before everything is finished"]$t$::jsonb, $t$Early drafts prevent last-minute surprises.$t$, 4) returning id into q;
    insert into academy_answer_key values (q, 3);
    insert into academy_questions (module_id, prompt, choices, explanation, position) values (m9, $t$You finished a big request for the first time. What makes the next one faster?$t$,
      $t$["Remembering it","Asking the client to simplify","Turning what you did into an SOP or checklist","Using a different AI tool"]$t$::jsonb, $t$Speed comes from systems you've already built.$t$, 5) returning id into q;
    insert into academy_answer_key values (q, 2);
    insert into academy_questions (module_id, prompt, choices, explanation, position) values (m10, $t$What makes a good update?$t$,
      $t$["A long account of everything you did","Done, in progress, blocked and what's needed from them, readable in 30 seconds","Only good news","A forward of all related emails"]$t$::jsonb, $t$Updates should make clear what, if anything, the executive needs to do.$t$, 1) returning id into q;
    insert into academy_answer_key values (q, 1);
    insert into academy_questions (module_id, prompt, choices, explanation, position) values (m10, $t$A request is unclear. What's the best way to ask about it?$t$,
      $t$["One message with grouped questions and a suggested default","Several messages as questions come up","Don't ask; guess","Wait until it's done, then ask"]$t$::jsonb, $t$"I'll assume X unless you say otherwise" keeps work moving.$t$, 2) returning id into q;
    insert into academy_answer_key values (q, 0);
    insert into academy_questions (module_id, prompt, choices, explanation, position) values (m10, $t$When should you escalate a problem?$t$,
      $t$["Never; solve everything yourself","Only after the deadline is missed","Only on Fridays","As soon as it's blocked, risky, outside your authority or a deadline is at risk"]$t$::jsonb, $t$Escalating early is professional, not a failure.$t$, 3) returning id into q;
    insert into academy_answer_key values (q, 3);
    insert into academy_questions (module_id, prompt, choices, explanation, position) values (m10, $t$What belongs in a good escalation?$t$,
      $t$["Who is to blame","Just the problem","What happened, the impact, what you tried, the options and what you need by when","A request to cancel the task"]$t$::jsonb, $t$Make it easy for someone to act on it.$t$, 4) returning id into q;
    insert into academy_answer_key values (q, 2);
    insert into academy_questions (module_id, prompt, choices, explanation, position) values (m10, $t$Two executives you support need you at the same time. What do you do?$t$,
      $t$["Quietly choose the more senior one","Explain the conflict and ask, or follow the agreed priority order","Do both badly","Ignore both until one follows up"]$t$::jsonb, $t$Don't choose secretly.$t$, 5) returning id into q;
    insert into academy_answer_key values (q, 1);
    insert into academy_questions (module_id, prompt, choices, explanation, position) values (m10, $t$What builds trust in a remote working relationship most?$t$,
      $t$["Doing what you said, when you said, with your work visible","Being online 24 hours a day","Never admitting mistakes","Sending many messages"]$t$::jsonb, $t$Reliability that can be seen builds trust, and trust leads to more delegation.$t$, 6) returning id into q;
    insert into academy_answer_key values (q, 0);

    insert into academy_resources (workspace_id, title, position) values (w.id, $t$MadeEA AI Prompt Library (100+ prompts)$t$, 1);
    insert into academy_resources (workspace_id, title, position) values (w.id, $t$Executive Assistant Prompt Playbook$t$, 2);
    insert into academy_resources (workspace_id, title, position) values (w.id, $t$AI Tool Cheat Sheet$t$, 3);
    insert into academy_resources (workspace_id, title, position) values (w.id, $t$Google Workspace Cheat Sheet$t$, 4);
    insert into academy_resources (workspace_id, title, position) values (w.id, $t$AI Decision Framework (when to use AI vs. human judgment)$t$, 5);
    insert into academy_resources (workspace_id, title, position) values (w.id, $t$Executive Daily Brief Template$t$, 6);
    insert into academy_resources (workspace_id, title, position) values (w.id, $t$Meeting Minutes Template$t$, 7);
    insert into academy_resources (workspace_id, title, position) values (w.id, $t$SOP Template$t$, 8);
    insert into academy_resources (workspace_id, title, position) values (w.id, $t$Executive Dashboard Template$t$, 9);
    insert into academy_resources (workspace_id, title, position) values (w.id, $t$Email Template Library$t$, 10);
    insert into academy_resources (workspace_id, title, position) values (w.id, $t$Executive Communication Guide$t$, 11);
    insert into academy_resources (workspace_id, title, position) values (w.id, $t$AI Workflow Playbook$t$, 12);
    insert into academy_resources (workspace_id, title, position) values (w.id, $t$MadeEA SOP Starter Kit$t$, 13);
  end loop;
end $seed$;
