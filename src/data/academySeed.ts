/**
 * The Made Ready Academy curriculum: "AI-Powered Executive Assistant
 * Foundations", from the HR course outline (Nov 2026). Three self-paced days of
 * roughly three hours, ten modules, a quiz per module, four practical
 * assessments reviewed by an admin, and a certificate.
 *
 * ONE SOURCE. Demo mode reads this file directly. The live database is seeded
 * from it too: migration 0095 was generated from this file, so if you change
 * the curriculum, change it here and regenerate (node scripts/academy/gen.cjs)
 * rather than editing the SQL by hand. A workspace already on this curriculum
 * is skipped by 0095, so a change after it has run needs its own migration.
 *
 * ANSWER KEY WARNING. In live mode the key sits in a table PostgREST cannot
 * read and grading happens in Postgres, so the pass/fail gate is real. Here the
 * key is in the bundle, because there is no server to hide it behind. Demo mode
 * is for reviewing the app, not for certifying anybody, and the UI says so.
 */
import type { AcademyLesson, AcademyModule, AcademyQuestion } from "@/types/db";

export const CERTIFICATE_TITLE = "Certified AI-Enhanced Executive Assistant (Foundation)";

export const DAY_TITLES: Record<number, string> = {
  1: "AI-Ready Executive Assistant Foundation",
  2: "AI Productivity Mastery for Executive Assistants",
  3: "AI-Enhanced Executive Assistant Simulation",
};

const M = (n: number, day: number, title: string, summary: string): AcademyModule => ({
  id: `am-${n}`, day, title, summary, position: n, pass_pct: 80, is_published: true,
});

export const MODULES: AcademyModule[] = [
  M(1, 1, "The MadeEA Standard",
    "What makes a MadeEA assistant different, what clients expect, and the standards every piece of work is held to."),
  M(2, 1, "Modern Executive Assistant Essentials",
    "Managing the flow of information, priorities, decisions and time around an executive, whatever tools they use."),
  M(3, 1, "Google Workspace + AI Workflow",
    "Using Gmail, Calendar, Docs, Sheets and Drive together as one organized system, with AI to speed it up."),
  M(4, 2, "AI Foundations for Professionals",
    "What AI does well, what it does poorly, what is safe to share, and when human judgment has to take over."),
  M(5, 2, "Prompt Engineering for Executive Assistants",
    "The right context, clear instructions and useful boundaries: how to get AI output close to what you need."),
  M(6, 2, "AI Toolkit Every Modern EA Should Know",
    "Which AI tool fits which job, and when a simpler tool is enough."),
  M(7, 2, "AI Workflow Systems",
    "Connecting tools into complete workflows so nothing is missed and the executive is involved less."),
  M(8, 3, "Client Tech Stack",
    "Why clients use the tools they use. Recognition, not mastery."),
  M(9, 3, "AI Workflow Integration",
    "Taking one request from a client and turning it into every piece of work it really needs."),
  M(10, 3, "Client Communication Excellence",
    "Proactive updates, clarifying questions, escalation and trust, finished with the 90-minute client simulation."),
];

const L = (
  module: number, n: number, title: string, kind: AcademyLesson["kind"], minutes: number, body: string,
): AcademyLesson => ({
  id: `al-${module}-${n}`, module_id: `am-${module}`, title, kind, minutes, position: n, body, video_url: null,
});

export const LESSONS: AcademyLesson[] = [
  // ── Day 1 · Module 1 — The MadeEA Standard ─────────────────────────────
  L(1, 1, "The MadeEA difference and the premium EA mindset", "reading", 15,
`Clients are not looking for someone who only completes administrative tasks. They want an assistant who works smarter, adapts quickly and adds value from day one. That is what MadeEA sells, and this course is how every MadeEA assistant starts at the same standard.

A premium EA mindset means:
• You think about the outcome, not only the task in front of you.
• You protect your executive's time, attention and energy.
• You use AI to work faster, and you stay accountable for the result.
• You leave every process a little more organized than you found it.

This course is about readiness, not mastery. You will keep learning with real client work. The aim is that your first day with a client is not your training day.`),
  L(1, 2, "Client expectations, and ownership vs task execution", "reading", 15,
`Clients expect three things from day one: reliability, good judgment and clear communication.

Task execution is doing what was asked. Ownership is making sure the outcome happens.

Example: your executive asks you to "book a meeting with Sarah".
• Task execution: you send an invite.
• Ownership: you check both calendars and time zones, add an agenda and the call link, attach what Sarah needs to read, set a reminder to prepare, and confirm once she accepts.

Ownership also means saying early when something is at risk, rather than explaining afterwards why it slipped.`),
  L(1, 3, "Professional communication", "reading", 10,
`Every message you send represents your executive and MadeEA.

• Lead with the point. Put the answer, decision or request in the first line.
• Be brief and specific: dates, times with time zones, names, links.
• Match the client's tone, but stay professional.
• Confirm what you understood before acting on anything unclear.
• Close the loop. Tell people when something is done.

Before you send, reread it as the person receiving it. Would they know what to do next?`),
  L(1, 4, "Confidentiality and AI ethics", "reading", 15,
`You will see private emails, financial details, contracts, passwords and personal information. Confidentiality is not optional.

When using AI:
• Only put client information into tools the client has approved for their data.
• Remove or anonymize names, figures and personal details when you can.
• Never paste passwords, bank details, ID numbers or health information into an AI tool.
• Get permission before recording or transcribing a meeting.
• You are responsible for anything AI helped you produce. If it is wrong, it is your mistake, not the tool's.

When in doubt, ask before you share.`),
  L(1, 5, "Quality standards", "reading", 10,
`Before any work leaves your hands, check it:

• Accurate: names, dates, numbers and links are correct and verified.
• Complete: it answers the whole request, and missing information is flagged.
• Clear: someone busy can understand it in under a minute.
• Consistent: it follows the client's SOPs, templates and file naming.
• On time: or you warned them early that it would not be.

Work that needs a second opinion goes to Review before it goes to the client. New kinds of work become a new SOP, so the next person does it the same way.`),

  // ── Day 1 · Module 2 — Modern Executive Assistant Essentials ─────────────
  L(2, 1, "Workflow beats buttons", "reading", 5,
`Modern executive assistance is not about knowing where every button is in Gmail, Calendar or a project management tool. Tools change. Platforms change. AI changes.

The skill that stays valuable is managing the workflow behind them: organizing information, protecting an executive's time, prioritizing work, coordinating meetings, building repeatable systems, and helping an executive decide faster.

Keep asking: "How can I reduce the time, attention and mental energy my executive needs to spend on this?"`),
  L(2, 2, "Executive inbox management", "reading", 10,
`Your goal is that your executive only reads what needs them.

• Sort daily into: needs a decision, needs a reply from them, you can handle, for information, and archive.
• Answer what you can, in your executive's agreed voice.
• Summarize the rest in a short daily brief: who, what they need, by when, and your suggested reply.
• Use labels or folders the executive understands, and keep the inbox close to empty.
• Flag anything urgent as soon as you see it, not at the end of the day.`),
  L(2, 3, "Calendar strategy and time blocking", "reading", 10,
`A calendar shows what an executive values. Protect it.

• Block focus time for deep work and keep it as firm as a meeting.
• Leave buffers between meetings for travel, breaks and preparation.
• Group similar meetings together, such as calls on one afternoon.
• Always check time zones, and write them in the invite.
• Every meeting should have a purpose, an agenda and a link or location.
• Review the coming week every Friday and fix conflicts before Monday.`),
  L(2, 4, "Task prioritization framework", "reading", 10,
`When everything is urgent, nothing is. Use urgency and importance:

• Urgent and important: do it now, or raise it straight away.
• Important, not urgent: schedule it, and protect the time.
• Urgent, not important: handle it quickly or delegate it.
• Neither: drop it, or batch it for later.

Ask yourself: what happens if this waits a day? Who is affected? Is there a deadline someone else depends on? When you are unsure, propose an order and ask your executive to confirm it.`),
  L(2, 5, "Meeting coordination", "reading", 8,
`A well-run meeting has three parts.

Before: a clear purpose, the right people, an agenda, documents shared in advance, and a link that works.
During: notes on decisions, action items, owners and deadlines.
After: a follow-up email with decisions and actions, tasks created, and reminders set.

Your executive should never walk into a meeting wondering what it is about.`),
  L(2, 6, "File organization and SOP thinking", "reading", 10,
`Information is only useful if it can be found.

• Use one folder structure, agreed with the client, and stick to it.
• Name files so they sort and search well, for example: 2026-11-03 Client Proposal v2.
• Keep one current version. Archive old ones rather than leaving copies everywhere.

SOP thinking: when you do something for the second time, write down how. A good SOP has the trigger, the steps, the tools, and what "done" looks like. SOPs keep quality consistent across EAs and make handovers easy.`),
  L(2, 7, "Executive decision support", "reading", 7,
`Executives make many decisions a day. Help them decide faster.

• Bring options, not just problems: two or three choices, with your recommendation.
• Give the key facts, the deadline and what happens if nothing is decided.
• Keep it short enough to answer in one reply.

You are not just managing an inbox, calendar, meetings, files and tasks. You are managing the flow of information, priorities, decisions and time around the executive.`),

  // ── Day 1 · Module 3 — Google Workspace + AI Workflow ────────────────────
  L(3, 1, "Google Workspace as one system", "reading", 5,
`Being an effective EA is not about knowing Gmail, Calendar, Docs, Sheets and Drive one by one. It is using them together so that:

• Information is easy to find
• Priorities are visible
• Meetings are properly prepared
• Tasks do not fall through the cracks
• Collaboration is simple
• The executive spends less time on administrative work

AI makes these workflows faster, but it should support good systems, not replace them.`),
  L(3, 2, "Gmail shortcuts and Calendar best practices", "reading", 10,
`Gmail:
• Turn on keyboard shortcuts (Settings). Useful ones: c compose, r reply, a reply all, f forward, e archive, # delete, / search, g i go to inbox.
• Use labels and filters to sort mail automatically.
• Save common replies as templates.
• Search operators save time: from:, to:, has:attachment, after:2026/01/01, is:unread.
• Schedule sends so messages arrive at a sensible time for the reader.

Calendar:
• Set working hours and time zones for your executive.
• Use appointment schedules for booking links.
• Attach documents and the agenda to the event itself.
• Use colors consistently, for example external meetings in one color and focus time in another.`),
  L(3, 3, "Docs, Sheets and Drive for EAs", "reading", 10,
`Docs: use suggestion mode when editing someone else's work, comments with @mentions to assign actions, and headings so long documents get an outline.

Sheets: the basics an EA uses every week are filters, sorting, freeze header row, data validation (drop-down lists), SUM, COUNTIF and simple conditional formatting.

Drive: one agreed folder structure, shared drives for team files, and sharing set to the right people only. Check "Anyone with the link" settings before sending a link.

File naming convention: date first (YYYY-MM-DD), then what it is, then the version. Example: 2026-11-03 Board Pack v3.`),
  L(3, 4, "AI inside Google Workspace (Gemini)", "reading", 5,
`Gemini is built into Google Workspace for many accounts. It can:
• Summarize long email threads in Gmail
• Draft replies and documents in Gmail and Docs
• Help build tables and formulas in Sheets
• Summarize files in Drive

Only use it on client data if the client's Workspace has it enabled and approved. As with any AI tool, review everything it writes before it goes anywhere.`),
  L(3, 5, "Mini exercise: organize a client workspace", "practical", 15,
`Practical. Your work is reviewed by an admin.

Scenario: a new client, a founder, sends you 12 files with names like "final FINAL.docx", "Untitled spreadsheet", "scan001.pdf" and "notes".

Write down:
1. The Drive folder structure you would set up for them (top-level folders and one level below).
2. A file naming convention, with three example file names.
3. Three Gmail labels or filters you would create, and what each one catches.
4. One way Gemini or another AI tool could save time here, and one thing you would not use AI for.

Paste your answer below, or a link to a Google Doc shared with your trainer.`),

  // ── Day 2 · Module 4 — AI Foundations for Professionals ──────────────────
  L(4, 1, "How AI language models work, simply", "reading", 10,
`Tools like ChatGPT, Claude and Gemini are large language models. They learned patterns from a huge amount of text, and they write by predicting what text should come next.

What that means for you:
• They are very good at language: drafting, summarizing, rewriting, organizing and explaining.
• They do not "know" facts the way a database does. They produce what sounds right.
• They only know what is in their training, plus what you give them or what they can search.
• Clear instructions and good context produce much better results.

Being an AI-powered EA does not mean using AI for everything. It means knowing when to use it.`),
  L(4, 2, "Hallucinations and verification", "reading", 10,
`A hallucination is when AI states something false with full confidence: a wrong date, an invented quote, a made-up source or a figure that does not exist.

Always verify:
• Names, titles, dates, times and time zones
• Numbers, prices and calculations
• Quotes, sources and links (open them)
• Legal, financial or medical statements
• Anything that will be sent externally or entered into a client system

A good habit: ask the AI to list what it is unsure of, and tell it not to invent information. Then check the facts yourself before you deliver.`),
  L(4, 3, "Responsible AI and confidentiality", "reading", 10,
`Responsible AI use means protecting the client, being honest and staying accountable.

• Use only tools approved for that client's data.
• Share the minimum information the task needs. Anonymize where you can.
• Never put passwords, payment details, ID numbers or health records into an AI tool.
• Be transparent if a client asks whether AI was used.
• Respect copyright and other people's work.

You are responsible for the final result, whoever or whatever drafted it.`),
  L(4, 4, "When not to use AI, and human judgment", "reading", 10,
`Do not use AI when:
• The information is confidential and the tool is not approved
• The message is sensitive: condolences, conflict, performance or personal matters
• A decision needs judgment about people, relationships or risk
• It would be faster to just do it yourself
• You cannot check whether the answer is right

AI helps process information. You bring judgment: context about your executive, relationships, priorities, timing and tone. AI is a productivity partner, not a decision-maker.`),
  L(4, 5, "A real client scenario", "reading", 10,
`Your executive forwards a 30-email thread about a delayed supplier delivery and asks: "Where are we on this?"

A good AI-assisted approach:
1. Check the client has approved the AI tool for this data, and remove anything sensitive you don't need.
2. Ask AI to summarize the thread: what was promised, what changed, who said what, and what is still open.
3. Verify the key dates and amounts against the original emails.
4. Write a three-line update with a recommended next step, in your executive's voice.
5. Offer to draft the reply to the supplier.

AI saved the reading time. You made sure it is right, and you decided what matters.`),

  // ── Day 2 · Module 5 — Prompt Engineering for Executive Assistants ───────
  L(5, 1, "Context, instructions and boundaries", "reading", 10,
`AI output depends heavily on the instructions you give it. Compare:

"Write an email."

with:

"Draft a short, professional follow-up email to a potential client who attended a discovery call yesterday. Thank them for their time, mention that the proposal is attached, and invite them to reply with questions. Keep it warm and confident, under 120 words."

Both ask for an email. The second gives AI enough to produce something close to what you need.

Effective prompting is not about magic words. It is: the right context + clear instructions + useful boundaries.`),
  L(5, 2, "A prompt pattern for EA work", "reading", 15,
`Use this pattern for most EA prompts:

1. Role: "Act as an experienced Executive Assistant to a CEO."
2. Task: what you want produced.
3. Context: who it is for, background, what has happened so far.
4. Format: bullet points, table, email, length, headings.
5. Boundaries: tone, word limit, what not to do ("Do not invent dates. Flag missing information.").

Then improve it in conversation: "Shorter." "More formal." "Turn this into a table." "What did you assume?"

Save prompts that work well. Over time you build your own prompt library.`),
  L(5, 3, "Prompt writing practical", "practical", 25,
`Practical. Your work is reviewed by an admin.

1. Improve a poorly written email using AI. Here is the draft:
"hi, so about the thing next week, we cant do tuesday anymore can u do another day? also send the doc. thx"
Write the prompt you used, and the improved email you would send.

2. Write a prompt for each of these, using the pattern from the last lesson:
a) Summarize a 10-page document into a one-page executive brief.
b) Create meeting minutes from a transcript, with decisions and action items.
c) Build a first draft of an SOP for booking executive travel.

Paste your answers below, or a link to a Google Doc shared with your trainer.`),

  // ── Day 2 · Module 6 — AI Toolkit Every Modern EA Should Know ────────────
  L(6, 1, "Choosing the right tool", "reading", 10,
`Being an AI-powered EA does not mean using one AI tool for everything. Different tools suit different work.

For any task, ask:
• What does each tool do well?
• Which tool fits this task?
• What information can safely be provided?
• What output still needs checking?
• Is a simpler tool enough?

The goal is not to become an expert in every AI platform. It is to build a toolkit and know which tool to reach for.`),
  L(6, 2, "Writing, research and knowledge tools", "reading", 20,
`ChatGPT: a general assistant for drafting, rewriting, summarizing, brainstorming and working with files. Good all-rounder.

Claude: strong at long documents, careful writing and following detailed instructions. Good for contracts, reports and long threads.

Perplexity: AI search that answers with sources you can click. Use it for research, then open the sources to verify.

NotebookLM: you upload your own documents and it answers only from them, with citations. Great for building a knowledge notebook for a client, project or onboarding pack.

Verify facts from all of them before delivering.`),
  L(6, 3, "Presentation and visual tools", "reading", 15,
`Gamma: turns an outline or document into a presentation, document or simple web page in minutes. Edit the result; don't send the first draft.

Napkin AI: turns text into simple diagrams and visuals, useful for explaining a process or idea.

Canva Magic Studio: AI features inside Canva for designs, social posts, resizing and editing images. Use the client's brand kit when they have one.

Use these when the format matters as much as the content: briefings, proposals, one-pagers and updates.`),
  L(6, 4, "Meeting and voice tools", "reading", 15,
`Fathom AI: records, transcribes and summarizes video calls, with highlights and action items.

Granola (overview): an AI notepad for meetings. It improves your own notes using the meeting audio.

ElevenLabs (basic overview): creates realistic voice audio from text, for example a voiceover for a training video. Never clone someone's voice without their clear permission.

Always make sure recording or transcription is authorized by everyone in the meeting.`),

  // ── Day 2 · Module 7 — AI Workflow Systems ───────────────────────────────
  L(7, 1, "Understanding AI workflow systems", "reading", 10,
`Using tools one at a time is useful. The real advantage comes from connecting them into complete workflows.

An AI workflow is a sequence of steps where information moves between tools, people and processes to reach an outcome. Every workflow should answer:
• What triggers the process?
• What information is needed?
• Which tools can support it?
• What is the expected output?
• Who reviews and completes it?

Receiving an email is not the end of a task. It may need a reply, a calendar invite, a reminder and an update to the executive.

Key principle: AI helps process information. You stay responsible for accuracy, decisions and follow-through.`),
  L(7, 2, "Workflow 1: Meeting to action", "reading", 15,
`Meeting → Transcript → AI summary → Action items → Follow-up email → Asana tasks → Weekly report

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

Outcome: a meeting becomes documented decisions, assigned responsibilities and trackable follow-ups.`),
  L(7, 3, "Workflow 2: Inbox to follow-up", "reading", 10,
`Inbox → AI draft → Reply → Calendar → Follow-up tracking

Scenario: a potential client emails your executive asking for a meeting about a partnership. Don't just reply.

1. Review the request and decide its priority.
2. Use AI to prepare a professional response.
3. Check the executive's calendar for available times.
4. Send the reviewed reply with suitable options.
5. Create the calendar event once confirmed.
6. Add a reminder to prepare meeting materials.
7. Track any outstanding reply or follow-up.

Outcome: the meeting is coordinated, the executive is prepared, and no follow-up is forgotten.`),
  L(7, 4, "Workflow 3: Research to executive briefing", "reading", 15,
`Research (Perplexity) → Analyze (ChatGPT or Claude) → Organize (Google Docs) → Present (Gamma or Canva)

Scenario: your executive meets a prospective partner tomorrow and wants a short company briefing.

• Research: gather company information and credible sources with Perplexity.
• Analysis: use ChatGPT or Claude to pull out relevant business insights.
• Documentation: write a one-page briefing in Google Docs.
• Presentation: make a short visual summary in Gamma or Canva.
• Verification: check company details, claims, dates and sources before delivery.

The briefing covers: company overview, key leadership, business activities, recent developments, possible discussion points and questions the executive may want to ask.`),
  L(7, 5, "Designing your own AI workflow", "reading", 10,
`Not every workflow needs several AI tools. Choose the simplest reliable process.

1. Identify the trigger: what starts it?
2. Define the outcome: what must be delivered?
3. Choose the right tools: which reduce manual work?
4. Add quality checkpoints: what needs checking or executive approval?
5. Close the loop: how will completion and follow-up be tracked?

AI output must be reviewed before it is shared externally or entered into client systems. Sensitive information only goes through tools approved for that client's data.

Teach yourself systems, not tools.`),
  L(7, 6, "Day 2 practical assessment", "practical", 60,
`Practical. Your work is reviewed by an admin.

Pick a real, public company (for example a well-known software or retail company). Your executive is meeting its leadership next week. Using several AI tools, produce:

1. A research report: key facts about the company, with sources (Perplexity).
2. An executive briefing: one page, with discussion points and questions to ask.
3. A meeting summary: write a short made-up meeting transcript about the partnership (or use one your trainer gives you), then produce minutes with decisions and action items.
4. A professional email following up that meeting.
5. A short presentation (5 to 7 slides) summarizing the opportunity (Gamma or Canva).

Paste links to your files below (shared with your trainer), and list which AI tool you used for each part and what you checked by hand.`),

  // ── Day 3 · Module 8 — Client Tech Stack ─────────────────────────────────
  L(8, 1, "Communication and meetings", "reading", 10,
`No mastery required, recognition only. Know why clients use these.

Slack: team chat organized in channels. Fast, informal, used by many startups and tech teams.
Microsoft Teams: chat, meetings and files for companies on Microsoft 365.
Google Meet: video calls built into Google Workspace and Calendar.
Zoom: video meetings and webinars, common with external guests.

Learn the client's habits: which tool is for urgent messages, which for updates, and when to email instead.`),
  L(8, 2, "Project and work management", "reading", 15,
`Asana: tasks and projects with owners, due dates and timelines. Popular with marketing and operations teams.
ClickUp: an all-in-one workspace for tasks, docs and goals. Very customizable.
Notion: docs, wikis and simple databases in one place. Often the company handbook.
Trello: simple boards with cards moving across columns.
Monday.com: visual boards and workflows, often for operations and sales teams.

They all do the same core job: who is doing what, by when. Find out how the client uses theirs, and follow their system rather than bringing your own.`),
  L(8, 3, "Scheduling, video and automation", "reading", 10,
`Calendly: booking links so people choose a time without back-and-forth email.
Loom: quick screen recordings, great for explaining something instead of a meeting.
Zapier (overview): connects apps so one action triggers another, for example a new form entry creates a task.
Make (overview): like Zapier, with more complex visual workflows.

You don't need to build automations. Recognize when a repeated manual task could be automated, and suggest it.`),
  L(8, 4, "Google Workspace and Microsoft 365", "reading", 10,
`Most clients run on one of two suites:

Google Workspace: Gmail, Calendar, Drive, Docs, Sheets, Slides and Meet.
Microsoft 365: Outlook, OneDrive, SharePoint, Word, Excel, PowerPoint and Teams.

The skills are the same across both: inbox, calendar, documents, spreadsheets and files. Only the buttons differ. If a client uses the one you know less, spend the first day learning where things are.`),

  // ── Day 3 · Module 9 — AI Workflow Integration ───────────────────────────
  L(9, 1, "From one request to the full job", "reading", 15,
`Client asks: "Can you prepare for tomorrow's board meeting?"

A ready EA hears more than one task. With AI where it helps:
1. Research: anything new on the board members, the company and the topics.
2. Summarize: last meeting's minutes and the papers for this one.
3. Create slides for any update your executive presents.
4. Draft the agenda, with timings.
5. Prepare an executive brief: key issues, decisions needed, likely questions.
6. Draft the follow-up email, ready to complete after the meeting.
7. Schedule: confirm the time, room or link, and any prep meeting.
8. Produce an action list to track outcomes.

Confirm the scope first: "Here is what I plan to prepare by 5 PM. Anything to add?"`),
  L(9, 2, "Putting it together under time pressure", "reading", 15,
`When a request is big and the time is short:

• Start with what the executive needs first, usually the brief and the agenda.
• Use AI for first drafts, then spend your time on checking and judgment.
• Share drafts early ("Draft brief attached, slides in an hour") rather than everything at the last minute.
• Keep a checklist so nothing from the request is forgotten.
• Note what you did and how long it took. Next time it becomes an SOP.

Speed comes from systems you have already built, not from rushing.`),

  // ── Day 3 · Module 10 — Client Communication Excellence ──────────────────
  L(10, 1, "Proactive communication and professional updates", "reading", 10,
`Don't make your executive ask for an update.

• Send short, regular updates: done, in progress, blocked, needs you.
• Share bad news early, with a plan.
• Confirm when tasks are finished. Silence makes people wonder.
• Use the client's preferred channel and keep it consistent.

A good update can be read in 30 seconds and makes clear what, if anything, the executive needs to do.`),
  L(10, 2, "Clarifying questions and time estimation", "reading", 10,
`Ask good questions before you start, not after you finish.

• Ask when the outcome, deadline, audience or format is unclear.
• Group your questions into one message, and suggest answers: "I'll assume X unless you say otherwise."

Time estimation:
• Break the work into steps and estimate each one.
• Add a buffer for checking and surprises.
• Say when you'll deliver, and if that changes, say so as soon as you know.`),
  L(10, 3, "Escalation and urgent requests", "reading", 10,
`Escalate when something is blocked, risky, outside your authority or about to miss a deadline. Escalating early is professional, not a failure.

A good escalation says: what happened, the impact, what you have tried, the options, and what you need from them, by when.

For urgent requests: confirm what "urgent" means (within the hour or today), reprioritize openly ("I'll pause X to do this"), and tell anyone affected.`),
  L(10, 4, "Managing multiple executives", "reading", 8,
`When you support more than one executive:

• Know each one's priorities, preferences and working hours.
• Keep their calendars, files and information separate and confidential.
• When requests conflict, don't choose secretly. Explain the conflict and ask, or follow the priority order agreed with the client.
• Use one task list so you can see everything you have committed to.`),
  L(10, 5, "Building trust remotely", "reading", 7,
`Remote trust is built through reliability you can see.

• Do what you said, when you said.
• Be reachable during agreed hours, and say when you won't be.
• Keep work visible: task boards, EOD reports, shared documents.
• Admit mistakes quickly and fix them.
• Protect confidential information every time.

Over time, trust means your executive delegates more, and that is where you add the most value.`),
  L(10, 6, "Final client simulation (90 minutes)", "practical", 90,
`Capstone. Your work is reviewed by an admin. Your trainer gives you the scenario materials when you start.

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

Paste links to your work below (shared with your trainer), with a short note on how you prioritized and where you used AI.`),
];

type Seeded = AcademyQuestion & { answer: number };

const Q = (
  module: number, n: number, answer: number, prompt: string, choices: string[], explanation: string,
): Seeded => ({ id: `aq-${module}-${n}`, module_id: `am-${module}`, position: n, answer, prompt, choices, explanation });

const QUESTIONS_WITH_KEY: Seeded[] = [
  // Module 1 — 10 questions, as the outline asks.
  Q(1, 1, 1, "What separates ownership from task execution?",
    ["Doing exactly what was asked, quickly", "Making sure the outcome happens, including the steps nobody spelled out", "Asking the executive to confirm every step", "Doing the task yourself instead of delegating it"],
    "Task execution is doing what was asked. Ownership is making sure the outcome happens."),
  Q(1, 2, 2, "Your executive says \"book a meeting with Sarah\". What does a MadeEA assistant do?",
    ["Send an invite for the first free slot", "Ask the executive to pick a time", "Check both calendars and time zones, add an agenda and link, attach what Sarah needs and confirm once accepted", "Email Sarah asking when she is free and wait"],
    "Ownership: the meeting should be ready to run, not just booked."),
  Q(1, 3, 0, "Where should the main point of a professional message go?",
    ["In the first line", "In the last line", "In an attachment", "Wherever it fits naturally"],
    "Lead with the point. Busy readers may only read the first line."),
  Q(1, 4, 3, "Which of these should never go into an AI tool?",
    ["A meeting agenda with no client names", "A public company's press release", "A draft email you wrote", "A client's bank account details"],
    "Passwords, payment details, ID numbers and health information never go into AI tools."),
  Q(1, 5, 1, "A client hasn't approved any AI tools for their data yet. What do you do?",
    ["Use a free AI tool, it's faster", "Do the work without AI, or anonymize it, until approval is confirmed", "Use AI and tell them afterwards", "Ask a colleague to run it through their account"],
    "Only use AI tools the client has approved for their data."),
  Q(1, 6, 2, "AI drafted a client report and it contains a wrong figure. Whose mistake is it?",
    ["The AI tool's", "The client's, for not checking", "Yours, because you are responsible for anything AI helped you produce", "Nobody's, it's a known limitation"],
    "You stay accountable for the final result, whoever or whatever drafted it."),
  Q(1, 7, 0, "You realize a deliverable will be late. When do you say so?",
    ["As soon as you know, with a new time", "When the deadline arrives", "Only if the client asks", "In the next weekly report"],
    "Saying early that something is at risk is part of ownership."),
  Q(1, 8, 3, "Which is NOT one of the quality checks before work leaves your hands?",
    ["Accurate", "Complete", "On time, or flagged early", "Long and detailed"],
    "The checks are accurate, complete, clear, consistent and on time. Long is not a goal; clear is."),
  Q(1, 9, 1, "You do a new kind of task for a client for the second time. What should you do?",
    ["Nothing different", "Write an SOP so it is done the same way next time", "Ask the client to write instructions", "Delegate it to someone else"],
    "When you do something for the second time, write down how. SOPs keep quality consistent across EAs."),
  Q(1, 10, 2, "What is the goal of the Made Ready course?",
    ["Becoming an AI expert", "Learning every client tool in depth", "A consistent foundation so you are ready from your first day with a client", "Replacing on-the-job learning"],
    "Readiness, not mastery. Learning continues with real client work."),

  // Module 2 — scenario-based.
  Q(2, 1, 1, "Your executive's inbox has 140 unread emails. What do you give them?",
    ["A forward of every important email", "A short brief: what needs a decision or reply from them, by when, with suggested replies", "Nothing; you reply to everything yourself", "A list of all 140 subjects"],
    "Your executive should only read what needs them."),
  Q(2, 2, 3, "Your executive has back-to-back calls all Tuesday. What is the best fix?",
    ["Cancel half of them", "Leave it, they agreed to them", "Move them all to Wednesday", "Add buffers, group similar calls, and protect a focus block for next week"],
    "Buffers, grouping and protected focus time are calendar strategy."),
  Q(2, 3, 0, "A task is important but not urgent. What do you do with it?",
    ["Schedule it and protect the time", "Do it immediately", "Drop it", "Delegate it to anyone available"],
    "Important, not urgent: schedule it. That is how important work stops becoming an emergency."),
  Q(2, 4, 2, "What should happen right after a meeting?",
    ["Nothing until the next meeting", "Share the recording only", "A follow-up with decisions and action items, tasks created and reminders set", "Ask everyone what they remember"],
    "After: follow-up email, tasks and reminders."),
  Q(2, 5, 1, "Which file name follows a good naming convention?",
    ["final FINAL v2 (1).docx", "2026-11-03 Client Proposal v2", "Proposal", "Copy of Untitled document"],
    "Date first, then what it is, then the version, so files sort and search well."),
  Q(2, 6, 3, "Your executive must choose a venue for an event. How do you help?",
    ["Pick one yourself and book it", "Send them every option you found", "Ask them to research it", "Give two or three options with key facts, a deadline and your recommendation"],
    "Bring options, not just problems, and make the decision easy to answer in one reply."),

  // Module 3
  Q(3, 1, 1, "Which Gmail search finds unread emails from a client with attachments?",
    ["unread client attachment", "from:client@example.com has:attachment is:unread", "client + file + new", "label:client unread"],
    "Search operators like from:, has:attachment and is:unread save time."),
  Q(3, 2, 0, "You are editing a document your executive wrote. What mode do you use?",
    ["Suggestion mode, so they can accept or reject changes", "Editing mode, and tell them later", "Make a copy and edit that", "Comment only, never edit"],
    "Suggestion mode keeps the author in control."),
  Q(3, 3, 2, "Before sending a Drive link outside the company, what do you check?",
    ["The file size", "The file color", "Sharing settings, so only the right people can open it", "That it is a PDF"],
    "Check \"Anyone with the link\" settings before sending a link."),
  Q(3, 4, 3, "When is it fine to use Gemini on a client's emails?",
    ["Always, it's built into Google", "Never", "Only on weekends", "When the client's Workspace has it enabled and approved"],
    "Only use AI on client data the client has approved."),
  Q(3, 5, 1, "What is the main goal of using Workspace tools together?",
    ["Using as many features as possible", "An organized system where information is easy to find and nothing falls through the cracks", "Replacing every process with AI", "Making documents look better"],
    "AI should support good systems, not replace them."),

  // Module 4
  Q(4, 1, 2, "How does a language model like ChatGPT produce an answer?",
    ["It looks up facts in a verified database", "It copies from one website", "It predicts what text should come next, based on patterns it learned", "A person writes it in real time"],
    "That is why it can sound right while being wrong."),
  Q(4, 2, 0, "What is an AI \"hallucination\"?",
    ["A confident answer that is false or invented", "When the tool is slow", "When AI refuses to answer", "An image generated by AI"],
    "Invented dates, quotes, sources and figures are the classic examples."),
  Q(4, 3, 3, "AI gives you a revenue figure for a company briefing. What do you do?",
    ["Use it, AI is usually right", "Round it to be safe", "Leave it out without saying", "Check it against a reliable source before it goes in"],
    "Numbers going to an executive or client are always verified."),
  Q(4, 4, 1, "Which task is a poor fit for AI?",
    ["Summarizing a long email thread", "Writing a condolence message to a client whose parent died", "Turning notes into a table", "Drafting an agenda"],
    "Sensitive, personal messages need human judgment and care."),
  Q(4, 5, 2, "What is the role of human judgment when using AI?",
    ["None, AI handles it", "Only to fix spelling", "Bringing context, priorities, relationships and tone, and deciding what is right", "Approving whatever AI writes"],
    "AI is a productivity partner. You remain accountable for the result."),
  Q(4, 6, 0, "Before summarizing a client thread with AI, what is the first check?",
    ["That the tool is approved for this client's data", "That the thread is short", "That the executive is online", "That the AI has a paid plan"],
    "Approval and confidentiality come first."),
  Q(4, 7, 3, "How can you reduce hallucinations in a prompt?",
    ["Use longer words", "Ask it to be creative", "Ask the same question twice", "Tell it not to invent information and to flag what it's unsure of"],
    "Then verify the facts yourself."),

  // Module 5
  Q(5, 1, 1, "What makes a good prompt?",
    ["Secret keywords", "The right context, clear instructions and useful boundaries", "As few words as possible", "Polite phrasing"],
    "Effective prompting is not about magic words."),
  Q(5, 2, 2, "Which prompt will produce the best follow-up email?",
    ["Write an email.", "Write a good email to a client.", "Draft a short, warm follow-up to a prospect from yesterday's discovery call, mention the attached proposal and invite questions, under 120 words.", "Email, professional, now."],
    "It gives the audience, the purpose, the content and a limit."),
  Q(5, 3, 0, "In the prompt pattern, what does a \"boundary\" look like?",
    ["\"Do not invent dates. Flag missing information.\"", "\"Act as an Executive Assistant.\"", "\"Summarize this document.\"", "\"Here is the transcript.\""],
    "Boundaries set tone, limits and what not to do."),
  Q(5, 4, 3, "The first AI draft is too long and too formal. What next?",
    ["Start a new chat and try again from scratch", "Send it anyway", "Rewrite it all yourself", "Ask it to refine: shorter, warmer, three sentences"],
    "Improve the result in conversation."),
  Q(5, 5, 1, "Why save prompts that work well?",
    ["AI tools delete them otherwise", "To build a prompt library you can reuse for repeated tasks", "Clients ask for them", "It's required by the AI tools"],
    "Reusable prompts make repeated work faster and more consistent."),

  // Module 6 — matching tools to use cases.
  Q(6, 1, 2, "You need research on a company with sources you can click and check. Which tool fits?",
    ["Canva Magic Studio", "ElevenLabs", "Perplexity", "Napkin AI"],
    "Perplexity answers with sources. Open them to verify."),
  Q(6, 2, 0, "You want answers drawn only from a client's own onboarding documents, with citations. Which tool fits?",
    ["NotebookLM", "Gamma", "Fathom", "Zapier"],
    "NotebookLM answers from the documents you upload."),
  Q(6, 3, 1, "You need a 6-slide presentation from an outline, quickly. Which tool fits?",
    ["Perplexity", "Gamma", "Granola", "Calendly"],
    "Gamma turns an outline into slides. Edit before sending."),
  Q(6, 4, 3, "You need a recorded call summarized with action items. Which tool fits?",
    ["Canva", "Napkin AI", "NotebookLM", "Fathom"],
    "Fathom records, transcribes and summarizes calls. Recording must be authorized."),
  Q(6, 5, 2, "You want to explain a 5-step process as a simple diagram. Which tool fits?",
    ["ElevenLabs", "Perplexity", "Napkin AI", "Granola"],
    "Napkin AI turns text into simple visuals."),
  Q(6, 6, 0, "A client asks for a 40-page contract summary with risky clauses flagged. Which tool fits best?",
    ["Claude, which handles long documents and detailed instructions well", "Canva Magic Studio", "Calendly", "ElevenLabs"],
    "Match the tool to the shape of the job: long document in, careful summary out."),
  Q(6, 7, 1, "A client wants a voiceover for a training video in their CEO's cloned voice. What is required?",
    ["Nothing, it's a common feature", "The CEO's clear permission", "A paid plan only", "A Loom recording"],
    "Never clone someone's voice without their clear permission."),
  Q(6, 8, 3, "When is a simpler tool the right choice over AI?",
    ["Never", "Only for clients without AI", "When the task is confidential", "When the simple tool does the job just as well and faster"],
    "Choose the simplest reliable process."),

  // Module 7
  Q(7, 1, 2, "Which question does every workflow need to answer?",
    ["Which tool is newest?", "How many steps can we add?", "What triggers it, and who reviews and completes it?", "Which AI is the cheapest?"],
    "Trigger, information, tools, output and who is responsible."),
  Q(7, 2, 0, "In the meeting-to-action workflow, what must you confirm when extracting actions?",
    ["Owners and deadlines", "The meeting's length", "The transcript's word count", "The recording quality"],
    "Do not invent deadlines, decisions or task owners. Flag what's missing."),
  Q(7, 3, 1, "A prospect emails asking for a meeting. Replying is step one. What else completes the workflow?",
    ["Nothing else", "Offer times, create the event once confirmed, set a prep reminder and track the reply", "Forward it to the executive", "Archive the email"],
    "No follow-up should be forgotten."),
  Q(7, 4, 3, "What is the last step before a research briefing goes to the executive?",
    ["Making it longer", "Adding more AI tools", "Converting it to PDF", "Verifying details, claims, dates and sources"],
    "Verification comes before delivery."),
  Q(7, 5, 2, "AI-generated output is ready to enter into a client's CRM. What first?",
    ["Enter it straight away", "Ask the AI if it is correct", "Review it", "Wait a day"],
    "AI output is reviewed before it is shared externally or entered into client systems."),
  Q(7, 6, 0, "What does \"close the loop\" mean in a workflow?",
    ["Tracking completion and follow-up", "Closing the browser tabs", "Ending the meeting on time", "Deleting the draft"],
    "A workflow isn't done until completion and follow-up are tracked."),

  // Module 8
  Q(8, 1, 1, "A client's team chats in channels and expects quick replies there. Which tool is it most likely?",
    ["Trello", "Slack", "Calendly", "Make"],
    "Slack organizes team chat into channels."),
  Q(8, 2, 3, "Which tool lets people choose a meeting time without back-and-forth email?",
    ["Notion", "Loom", "Zapier", "Calendly"],
    "Booking links remove the back-and-forth."),
  Q(8, 3, 0, "You want to show a colleague how to file expenses without a meeting. Which tool?",
    ["Loom", "Monday.com", "Zoom", "Perplexity"],
    "A quick screen recording replaces a meeting."),
  Q(8, 4, 2, "A form entry should automatically create a task. Which tools do that?",
    ["Canva and Gamma", "Zoom and Meet", "Zapier or Make", "Word and Excel"],
    "Automation tools connect apps so one action triggers another."),
  Q(8, 5, 1, "A client uses Outlook, OneDrive and Teams. Which suite are they on?",
    ["Google Workspace", "Microsoft 365", "Notion", "ClickUp"],
    "The skills are the same; only the buttons differ."),
  Q(8, 6, 3, "Your client tracks work in ClickUp, but you prefer Asana. What do you do?",
    ["Move everything to Asana", "Use both", "Keep your own list privately", "Follow the client's system"],
    "Learn how the client uses their tools rather than bringing your own."),

  // Module 9
  Q(9, 1, 2, "\"Prepare for tomorrow's board meeting.\" What should you do first?",
    ["Start making slides", "Wait for more instructions", "Confirm the scope: what you'll prepare and by when", "Research everything you can"],
    "Confirm scope first so you deliver what is needed."),
  Q(9, 2, 0, "Time is short. What does the executive usually need first?",
    ["The brief and the agenda", "The follow-up email", "The action list", "The slide design"],
    "Start with what they need first."),
  Q(9, 3, 1, "Where should most of your time go when AI drafts the first versions?",
    ["Making more drafts", "Checking and applying judgment", "Formatting", "Choosing fonts"],
    "Use AI for first drafts; spend your time on checking and judgment."),
  Q(9, 4, 3, "Why share drafts early on a big request?",
    ["To look busy", "Because AI requires it", "To skip checking", "So the executive can steer before everything is finished"],
    "Early drafts prevent last-minute surprises."),
  Q(9, 5, 2, "You finished a big request for the first time. What makes the next one faster?",
    ["Remembering it", "Asking the client to simplify", "Turning what you did into an SOP or checklist", "Using a different AI tool"],
    "Speed comes from systems you've already built."),

  // Module 10
  Q(10, 1, 1, "What makes a good update?",
    ["A long account of everything you did", "Done, in progress, blocked and what's needed from them, readable in 30 seconds", "Only good news", "A forward of all related emails"],
    "Updates should make clear what, if anything, the executive needs to do."),
  Q(10, 2, 0, "A request is unclear. What's the best way to ask about it?",
    ["One message with grouped questions and a suggested default", "Several messages as questions come up", "Don't ask; guess", "Wait until it's done, then ask"],
    "\"I'll assume X unless you say otherwise\" keeps work moving."),
  Q(10, 3, 3, "When should you escalate a problem?",
    ["Never; solve everything yourself", "Only after the deadline is missed", "Only on Fridays", "As soon as it's blocked, risky, outside your authority or a deadline is at risk"],
    "Escalating early is professional, not a failure."),
  Q(10, 4, 2, "What belongs in a good escalation?",
    ["Who is to blame", "Just the problem", "What happened, the impact, what you tried, the options and what you need by when", "A request to cancel the task"],
    "Make it easy for someone to act on it."),
  Q(10, 5, 1, "Two executives you support need you at the same time. What do you do?",
    ["Quietly choose the more senior one", "Explain the conflict and ask, or follow the agreed priority order", "Do both badly", "Ignore both until one follows up"],
    "Don't choose secretly."),
  Q(10, 6, 0, "What builds trust in a remote working relationship most?",
    ["Doing what you said, when you said, with your work visible", "Being online 24 hours a day", "Never admitting mistakes", "Sending many messages"],
    "Reliability that can be seen builds trust, and trust leads to more delegation."),
];

/** Questions as the learner gets them, with no answer attached. */
export const QUESTIONS: AcademyQuestion[] = QUESTIONS_WITH_KEY.map(({ answer: _answer, ...q }) => q);

/** Demo-only grading. Live mode calls the Postgres function instead. */
export const demoKey = (questionId: string): number | undefined =>
  QUESTIONS_WITH_KEY.find((q) => q.id === questionId)?.answer;

/** For the migration generator only: every question with its answer index. */
export const SEED_QUESTIONS = QUESTIONS_WITH_KEY;

/** "Resources Included" from the outline. Links are added by an admin once each one exists. */
export const RESOURCES: string[] = [
  "MadeEA AI Prompt Library (100+ prompts)",
  "Executive Assistant Prompt Playbook",
  "AI Tool Cheat Sheet",
  "Google Workspace Cheat Sheet",
  "AI Decision Framework (when to use AI vs. human judgment)",
  "Executive Daily Brief Template",
  "Meeting Minutes Template",
  "SOP Template",
  "Executive Dashboard Template",
  "Email Template Library",
  "Executive Communication Guide",
  "AI Workflow Playbook",
  "MadeEA SOP Starter Kit",
];
