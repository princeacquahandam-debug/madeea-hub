import type {
  Automation,
  Client,
  Meeting,
  Message,
  Task,
} from "@/types/db";

// Demo dataset ported verbatim from the original prototype (see
// madeea-hub-extraction.md). In live mode this same shape is seeded per-user
// via the Supabase seed_demo_data() function.

export const CLIENTS: Client[] = [
  {
    id: "c1",
    name: "James Harrington",
    title: "CEO",
    company: "Harrington Capital",
    preferred_channel: "Email",
    tone: "Formal",
    tags: ["Board Prep", "Investor Relations", "Travel"],
    bio: "James Harrington is the founding CEO of Harrington Capital, a $2.4B growth equity firm focused on B2B SaaS and healthcare technology. A Harvard Business School alumnus with 22 years in private equity, James sits on 6 portfolio company boards and is an active speaker at industry conferences. He values precision, punctuality, and brevity in all communications.",
    preferences_notes:
      "Prefers to receive the morning briefing before 8 AM. Never call without pre-scheduling. Always copy the CFO on financial communications. Allergic to vague language — be specific with numbers and dates.",
    active_tasks: [
      { title: "Prepare Q4 board deck", status: "Urgent" },
      { title: "Review NovaMed investment memo", status: "In Progress" },
      { title: "Draft investor letter", status: "Pending" },
    ],
    schedule: [
      { when: "Mon 10:15 AM", what: "Investor call — Apex Capital" },
      { when: "Thu 9:00 AM", what: "Q4 Board Review Meeting" },
      { when: "Fri 4:30 PM", what: "EOW debrief with Sarah" },
    ],
  },
  {
    id: "c2",
    name: "Priya Nair",
    title: "Founder & CEO",
    company: "NovaMed Health",
    preferred_channel: "Slack",
    tone: "Direct, collaborative",
    tags: ["Product Roadmap", "Media", "Fundraising"],
    bio: "Priya Nair is the founder of NovaMed Health, a fast-growing digital health platform serving enterprise clients across North America. A former McKinsey healthcare consultant and Stanford Medicine alumna, Priya leads a 62-person team and is currently closing a $22M Series B round. She's highly responsive but time-poor — concise, actionable communication is essential.",
    preferences_notes:
      "Prefers Slack for day-to-day; email for formal/external. Responds quickly but expects the same. Always lead with the ask or key point — no preamble. Available for calls Tue/Thu 9–11 AM only. Vegetarian (note for meeting catering).",
    active_tasks: [
      { title: "Competitor research — digital health", status: "In Progress" },
      { title: "Series B investor deck review", status: "Pending" },
      { title: "Media brief for Forbes interview", status: "Pending" },
    ],
    schedule: [
      { when: "Wed 11:30 AM", what: "Product Review — NovaMed" },
      { when: "Thu 2:00 PM", what: "Investor call (Series B)" },
      { when: "Fri 9:00 AM", what: "Forbes interview prep" },
    ],
  },
  {
    id: "c3",
    name: "David Osei",
    title: "Managing Director",
    company: "Osei Global Ventures",
    preferred_channel: "WhatsApp",
    tone: "Concise, informal",
    tags: ["Travel", "Deal Flow", "Events"],
    bio: "David Osei is the Managing Director of Osei Global Ventures, a pan-African private equity firm with $800M under management. Based between London and Accra, David travels extensively and manages a complex multi-timezone schedule. A Cambridge economics graduate and former Bain consultant, he values efficiency above all. Most comfortable communicating via WhatsApp for speed.",
    preferences_notes:
      "Primary contact: WhatsApp (+44 7700 900 142). Email for contracts and formal docs only. Always book business class — no exceptions. Hotel preference: Rosewood, Four Seasons, or St. Regis. Time zones: GMT/WAT primarily. Keep messages under 3 sentences where possible.",
    active_tasks: [
      { title: "Book SF travel (flights + hotel)", status: "In Progress" },
      { title: "Prepare AGOA conference materials", status: "Pending" },
      { title: "Coordinate Accra LP meetings", status: "Pending" },
    ],
    schedule: [
      { when: "Tue 2:00 PM", what: "Travel Brief — SF Trip" },
      { when: "Thu 10:00 AM", what: "AGOA Conference prep call" },
      { when: "Next Mon", what: "Departs for San Francisco" },
    ],
  },
];

export const TASKS: Task[] = [
  { id: "t1", title: "Book SF flights for David", client_name: "David Osei", due_label: "Tomorrow", priority: "normal", status: "todo" },
  { id: "t2", title: "Draft investor update email", client_name: "James Harrington", due_label: "Friday", priority: "high", status: "todo" },
  { id: "t3", title: "Prepare Q3 expense report", client_name: "James Harrington", due_label: "Next week", priority: "normal", status: "todo" },
  { id: "t4", title: "Write NovaMed briefing doc", client_name: "Priya Nair", due_label: "Thursday", priority: "high", status: "todo" },
  { id: "t5", title: "Prepare board deck slides", client_name: "James Harrington", due_label: "Today, 3pm", priority: "urgent", status: "in_progress" },
  { id: "t6", title: "Research NovaMed competitors", client_name: "Priya Nair", due_label: "Today, EOD", priority: "high", status: "in_progress" },
  { id: "t7", title: "Reschedule Monday call", client_name: "James Harrington", due_label: "Completed", priority: "low", status: "done" },
  { id: "t8", title: "Send travel itinerary", client_name: "David Osei", due_label: "Completed", priority: "normal", status: "done" },
];

export const MESSAGES: Message[] = [
  { id: "m1", sender_name: "James Harrington", time: "8:42 AM", subject: "Board Meeting Agenda Request", preview: "Could you please send over the agenda for Thursday's board meeting by tomorrow morning?", body: "Could you please send over the agenda for Thursday's board meeting by tomorrow morning?", category: "urgent", client_name: "James Harrington", client_title: "CEO, Harrington Capital" },
  { id: "m2", sender_name: "Priya Nair", time: "9:15 AM", subject: "Postponing Thursday meeting", preview: "I need to reschedule our Thursday check-in. Can we move it to next Monday instead?", body: "I need to reschedule our Thursday check-in. Can we move it to next Monday instead?", category: "reply", client_name: "Priya Nair", client_title: "Founder & CEO, NovaMed Health" },
  { id: "m3", sender_name: "CFO Office", time: "10:03 AM", subject: "Q3 Expense Report Due", preview: "Reminder: Q3 expense reports are due by end of month. Please ensure all receipts are submitted.", body: "Reminder: Q3 expense reports are due by end of month. Please ensure all receipts are submitted.", category: "delegate" },
  { id: "m4", sender_name: "Travel Agent", time: "11:20 AM", subject: "SF Flight Options — David Osei", preview: "Here are three flight options for Mr. Osei's San Francisco trip. Please confirm preference.", body: "Here are three flight options for Mr. Osei's San Francisco trip. Please confirm preference.", category: "reply" },
  { id: "m5", sender_name: "Newsletter Service", time: "12:00 PM", subject: "Weekly industry digest — Issue #142", preview: "This week in executive leadership: AI adoption trends, market analysis, and more.", body: "This week in executive leadership: AI adoption trends, market analysis, and more.", category: "archive" },
  { id: "m6", sender_name: "HR Team", time: "1:30 PM", subject: "Team offsite planning — Q4", preview: "We're planning the Q4 team offsite and need input on preferred dates and venues.", body: "We're planning the Q4 team offsite and need input on preferred dates and venues.", category: "delegate" },
];

export const MEETINGS: Meeting[] = [
  { id: "mt1", time: "9:00 AM", title: "Board Prep Call", with: "James Harrington", status: "prepared" },
  { id: "mt2", time: "11:30 AM", title: "Product Review", with: "Priya Nair", status: "needs_prep" },
  { id: "mt3", time: "2:00 PM", title: "Travel Brief", with: "David Osei", status: "prepared" },
  { id: "mt4", time: "4:30 PM", title: "Team Sync", with: "Internal", status: "pending" },
];

export const AUTOMATIONS: Automation[] = [
  { id: "a1", name: "Executive Priority Alignment Automation™", description: "Every morning at 7:30 AM, analyses your calendar, emails, and task list to generate a prioritised daily briefing for your executive. Flags conflicts, urgent items, and suggested schedule optimisations.", status: "active", last_run: "2 hours ago", total_runs: 247 },
  { id: "a2", name: "Meeting Preparation Automation™", description: "Triggered 24 hours before every scheduled meeting. Automatically compiles attendee profiles, agenda drafts, relevant documents, and sends pre-meeting reminders to all participants.", status: "active", last_run: "This morning", total_runs: 183 },
  { id: "a3", name: "Executive Summary Inbox Automation™", description: "Runs every 2 hours during business hours to triage new emails, auto-archive newsletters, delegate routine requests, and surface only the communications requiring direct executive attention.", status: "paused", last_run: "4 hours ago", total_runs: 312 },
];

export const KPIS = [
  { label: "Tasks Active", value: 12 },
  { label: "Meetings Today", value: 4 },
  { label: "Emails Pending", value: 23 },
  { label: "Automations Running", value: 3 },
];

export const USER = { name: "Sarah Mitchell", role: "Elite EA", initials: "SM" };
