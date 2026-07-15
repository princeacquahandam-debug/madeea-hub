/**
 * Demo dataset — ONLY loaded when the app is built with VITE_DEMO=1.
 *
 * seed.ts deliberately ships empty arrays ("no dummy data, never seeded"), and
 * that contract is unchanged: a normal build — dev, Vercel, or Pages — still sees
 * empty arrays and reads real records from Supabase. This file exists purely so a
 * preview build has something on screen to click, and it is inert everywhere else.
 */
import type { Automation, Client, Meeting, Message, Task } from "@/types/db";
import { addBusinessHours } from "@/lib/sla";
import { DEFAULT_SLA } from "@/store/slaSettings";

// Anchored to "now" so the packet's relative times ("2 days ago") stay sensible
// however long after this was written the preview gets opened.
const now = Date.now();
const at = (dayOffset: number, hour: number, min = 0): string => {
  const d = new Date(now + dayOffset * 86_400_000);
  d.setHours(hour, min, 0, 0);
  return d.toISOString();
};

/**
 * Like `at`, but never lands on a weekend — nudged back to the preceding Friday.
 * Without this, a demo email that happens to arrive on a Saturday accrues zero
 * business hours and the client looks flawless for reasons that aren't real.
 */
const weekdayAt = (daysAgo: number, hour: number, min = 0): Date => {
  const d = new Date(now - daysAgo * 86_400_000);
  if (d.getDay() === 6) d.setDate(d.getDate() - 1);
  if (d.getDay() === 0) d.setDate(d.getDate() - 2);
  d.setHours(hour, min, 0, 0);
  return d;
};

/**
 * One inbound email plus the reply we sent `replyAfterHours` WORKING hours later
 * (null = still unanswered). Authored in working hours because that's the unit the
 * SLA metric measures in — writing these as calendar hours makes a "slow" reply
 * across a weekend land as a fast one.
 */
let seq = 0;
function thread(opts: {
  client: { id: string; name: string; title: string; company: string; email: string };
  subject: string;
  preview: string;
  daysAgo: number;
  hour: number;
  replyAfterHours: number | null;
}): Message {
  const received = weekdayAt(opts.daysAgo, opts.hour);
  const reply =
    opts.replyAfterHours === null
      ? null
      : addBusinessHours(received, opts.replyAfterHours, DEFAULT_SLA);
  const id = `demo-msg-${++seq}`;
  return {
    id,
    thread_id: `demo-thread-${seq}`,
    sender_name: opts.client.name,
    sender_email: opts.client.email,
    subject: opts.subject,
    preview: opts.preview,
    body: opts.preview,
    category: reply ? "archive" : "reply",
    direction: "inbound",
    received_at: received.toISOString(),
    first_reply_at: reply ? reply.toISOString() : null,
    reply_received_at: null,
    time: received.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
    client_id: opts.client.id,
    client_name: opts.client.name,
    client_title: `${opts.client.title}, ${opts.client.company}`,
  };
}

export const CLIENTS: Client[] = [
  {
    id: "demo-client-1",
    lead_ea_id: "demo-1",
    name: "Priya Raman",
    title: "Chief Operating Officer",
    company: "Northwind Capital",
    preferred_channel: "Email",
    tone: "Formal",
    tags: ["Priority", "Board"],
    bio: "COO at Northwind Capital. Sits on the investment committee and chairs the quarterly board review.",
    preferences_notes:
      "Prefers bullet points over prose. Always wants the numbers before the narrative. Do not schedule anything before 10am.",
    avatar_url: null,
    active_tasks: [],
    schedule: [],
  },
  {
    id: "demo-client-2",
    lead_ea_id: "demo-2",
    name: "Marcus Bell",
    title: "Founder",
    company: "Halden Studio",
    preferred_channel: "WhatsApp",
    tone: "Casual",
    tags: ["Creative"],
    bio: "Founder of Halden Studio, a design practice working mainly with hospitality brands.",
    preferences_notes: "Hates long emails. Voice notes are fine. Will reschedule at short notice.",
    avatar_url: null,
    active_tasks: [],
    schedule: [],
  },
  {
    id: "demo-client-3",
    lead_ea_id: "demo-3",
    name: "Elena Fischer",
    title: "Managing Partner",
    company: "Vantage Group",
    preferred_channel: "Email",
    tone: "Direct",
    tags: ["Retainer"],
    bio: "Managing Partner at Vantage Group. Runs the firm's real-estate practice.",
    preferences_notes: "Expects same-day acknowledgement even if the full answer takes longer.",
    avatar_url: null,
    active_tasks: [],
    schedule: [],
  },
];

// Contact details used to build the demo threads below.
const PRIYA = { id: "demo-client-1", name: "Priya Raman", title: "Chief Operating Officer", company: "Northwind Capital", email: "priya@northwind.com" };
const MARCUS = { id: "demo-client-2", name: "Marcus Bell", title: "Founder", company: "Halden Studio", email: "marcus@haldenstudio.com" };
const ELENA = { id: "demo-client-3", name: "Elena Fischer", title: "Managing Partner", company: "Vantage Group", email: "elena@vantage.group" };

export const MEETINGS: Meeting[] = [
  {
    id: "demo-meeting-1",
    title: "Q3 Planning Review",
    with: "Priya Raman",
    client_id: "demo-client-1",
    starts_at: at(0, 14, 30),
    time: "2:30 PM",
    status: "needs_prep",
  },
  {
    id: "demo-meeting-2",
    title: "Brand Refresh Kickoff",
    with: "Marcus Bell",
    client_id: "demo-client-2",
    starts_at: at(0, 16, 0),
    time: "4:00 PM",
    status: "pending",
  },
  {
    id: "demo-meeting-3",
    title: "Internal Ops Standup",
    with: "Internal",
    client_id: null,
    starts_at: at(1, 9, 30),
    time: "9:30 AM",
    status: "pending",
  },
  // Past meeting — surfaces as "last meeting" inside Priya's prep packet.
  {
    id: "demo-meeting-0",
    title: "Q2 Board Review",
    with: "Priya Raman",
    client_id: "demo-client-1",
    starts_at: at(-28, 11, 0),
    time: "11:00 AM",
    status: "prepared",
  },
];

export const TASKS: Task[] = [
  {
    id: "demo-task-1",
    assignee_id: "demo-1",
    client_id: "demo-client-1",
    created_at: at(-12, 9),
    completed_at: null,
    updated_at: at(-1, 9),
    title: "Send Q3 board pack to the investment committee",
    client_name: "Priya Raman",
    due_label: "Friday",
    due_at: at(2, 17),
    priority: "urgent",
    status: "todo",
    subtasks: [],
    recurrence: "none",
    depends_on: null,
  },
  {
    id: "demo-task-2",
    assignee_id: "demo-2",
    client_id: "demo-client-1",
    created_at: at(-20, 14),
    completed_at: null,
    updated_at: at(-9, 14), // untouched for over a week -> stale
    title: "Confirm auditor availability for October",
    client_name: "Priya Raman",
    due_label: "Next week",
    due_at: at(6, 12),
    priority: "normal",
    status: "in_progress",
    subtasks: [],
    recurrence: "none",
    depends_on: null,
  },
  {
    id: "demo-task-3",
    assignee_id: "demo-2",
    client_id: "demo-client-1",
    created_at: at(-14, 10),
    completed_at: at(-3, 12), // completed -> its own timeline entry
    updated_at: at(-7, 12), // old, but DONE -> must never be flagged
    title: "Circulate Q2 minutes",
    client_name: "Priya Raman",
    due_label: "Done",
    due_at: at(-7, 12),
    priority: "normal",
    status: "done",
    subtasks: [],
    recurrence: "none",
    depends_on: null,
  },
  {
    id: "demo-task-4",
    assignee_id: "demo-3",
    client_id: "demo-client-2",
    created_at: at(-16, 10),
    completed_at: null,
    updated_at: at(-6, 10), // stale
    title: "Collect moodboard feedback",
    client_name: "Marcus Bell",
    due_label: "Monday",
    due_at: at(4, 10),
    priority: "high",
    status: "todo",
    subtasks: [],
    recurrence: "none",
    depends_on: null,
  },
  // Delivered work — the entries that answer "what did we do last month".
  {
    id: "demo-task-5",
    assignee_id: "demo-1",
    client_id: "demo-client-1",
    created_at: at(-33, 11),
    completed_at: at(-24, 16),
    updated_at: at(-24, 16),
    title: "Book the Q2 board dinner",
    client_name: "Priya Raman",
    due_label: "Done",
    due_at: at(-25, 12),
    priority: "normal",
    status: "done",
    subtasks: [],
    recurrence: "none",
    depends_on: null,
  },
  // Bryan is carrying too much — the imbalance the workload view exists to show.
  {
    id: "demo-task-7",
    assignee_id: "demo-2",
    client_id: "demo-client-3",
    created_at: at(-8, 9),
    completed_at: null,
    updated_at: at(-2, 9),
    title: "Draft the Vantage lease summary",
    client_name: "Elena Fischer",
    due_label: "Yesterday",
    due_at: at(-1, 17), // overdue
    priority: "urgent",
    status: "in_progress",
    subtasks: [],
    recurrence: "none",
    depends_on: null,
  },
  {
    id: "demo-task-8",
    assignee_id: "demo-2",
    client_id: "demo-client-2",
    created_at: at(-5, 11),
    completed_at: null,
    updated_at: at(-3, 11),
    title: "Chase the Halden photography quote",
    client_name: "Marcus Bell",
    due_label: "Today",
    due_at: at(0, 17),
    priority: "high",
    status: "todo",
    subtasks: [],
    recurrence: "none",
    depends_on: null,
  },
  // Nobody has picked this up — a legitimate state, not a broken row.
  {
    id: "demo-task-9",
    assignee_id: null,
    client_id: "demo-client-1",
    created_at: at(-4, 14),
    completed_at: null,
    updated_at: at(-4, 14),
    title: "Renew the Northwind NDA",
    client_name: "Priya Raman",
    due_label: "Next week",
    due_at: at(5, 12),
    priority: "normal",
    status: "todo",
    subtasks: [],
    recurrence: "none",
    depends_on: null,
  },
  {
    id: "demo-task-6",
    assignee_id: null,
    client_id: "demo-client-2",
    created_at: at(-19, 9),
    completed_at: at(-17, 15),
    updated_at: at(-17, 15),
    title: "Send the Halden retainer invoice",
    client_name: "Marcus Bell",
    due_label: "Done",
    due_at: at(-18, 12),
    priority: "high",
    status: "done",
    subtasks: [],
    recurrence: "none",
    depends_on: null,
  },
];

/**
 * Something WE sent. `replyAfterDays: null` means they never wrote back — which is
 * exactly the blind spot this feature exists to surface: it sits in Sent, not the
 * inbox, so nothing in the app would otherwise notice it going quiet.
 */
function sent(opts: {
  client: { id: string; name: string; title: string; company: string; email: string } | null;
  to: string;
  subject: string;
  preview: string;
  daysAgo: number;
  hour: number;
  replyAfterDays: number | null;
}): Message {
  const at_ = weekdayAt(opts.daysAgo, opts.hour);
  const id = `demo-sent-${++seq}`;
  return {
    id,
    thread_id: `demo-thread-out-${seq}`,
    sender_name: opts.to,
    sender_email: opts.client?.email ?? null,
    subject: opts.subject,
    preview: opts.preview,
    body: opts.preview,
    category: "reply",
    direction: "outbound",
    received_at: at_.toISOString(),
    first_reply_at: null,
    reply_received_at:
      opts.replyAfterDays === null
        ? null
        : new Date(at_.getTime() + opts.replyAfterDays * 86_400_000).toISOString(),
    time: at_.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
    client_id: opts.client?.id ?? null,
    client_name: opts.client?.name,
    client_title: opts.client ? `${opts.client.title}, ${opts.client.company}` : undefined,
  };
}

// Response-time history. Threads are split across the last 30 days and the 30
// before that, so the trend indicator has two periods to compare.
export const MESSAGES: Message[] = [
  // --- Priya: answered within the hour, and quicker than last month. On Track, improving. ---
  thread({ client: PRIYA, subject: "Re: Q3 board pack — one more thing", preview: "Can you add the headcount forecast before Thursday? The committee will ask.", daysAgo: 2, hour: 9, replyAfterHours: 1 }),
  thread({ client: PRIYA, subject: "Committee papers", preview: "Circulating Thursday — anything outstanding from your side?", daysAgo: 9, hour: 11, replyAfterHours: 2 }),
  thread({ client: PRIYA, subject: "Auditor intro", preview: "Happy to make the introduction if useful.", daysAgo: 17, hour: 15, replyAfterHours: 1.5 }),
  thread({ client: PRIYA, subject: "Travel for the offsite", preview: "Can we look at the Thursday flights instead?", daysAgo: 26, hour: 10, replyAfterHours: 2 }),
  // previous period — slower, which is what makes the trend "improving"
  thread({ client: PRIYA, subject: "Q2 minutes", preview: "Could you send the signed copy?", daysAgo: 38, hour: 14, replyAfterHours: 6 }),
  thread({ client: PRIYA, subject: "Board dinner", preview: "Do we have a venue yet?", daysAgo: 46, hour: 9, replyAfterHours: 5 }),
  thread({ client: PRIYA, subject: "Headcount plan", preview: "Sharing the draft for comment.", daysAgo: 55, hour: 16, replyAfterHours: 7 }),

  // --- Marcus: over two working days to reply, plus one email still open. Breached. ---
  thread({ client: MARCUS, subject: "moodboards", preview: "sent you three directions, second one is my favourite", daysAgo: 4, hour: 10, replyAfterHours: null }),
  thread({ client: MARCUS, subject: "invoice question", preview: "is the retainer inclusive of the photography day?", daysAgo: 8, hour: 12, replyAfterHours: 21 }),
  thread({ client: MARCUS, subject: "Re: kickoff", preview: "works for me, send an invite whenever", daysAgo: 15, hour: 16, replyAfterHours: 24 }),
  thread({ client: MARCUS, subject: "site visit", preview: "can we push to the following week?", daysAgo: 23, hour: 9, replyAfterHours: 19 }),
  // previous period — was merely slow, not breaching; he has got worse
  thread({ client: MARCUS, subject: "logo files", preview: "which format do you need these in?", daysAgo: 41, hour: 11, replyAfterHours: 10 }),
  thread({ client: MARCUS, subject: "contract", preview: "signed and returned", daysAgo: 52, hour: 15, replyAfterHours: 11 }),

  // --- Elena: was same-day, has drifted to next-day-plus. At Risk, worsening. ---
  thread({ client: ELENA, subject: "Lease review", preview: "Need your read on clause 14 before Friday.", daysAgo: 3, hour: 9, replyAfterHours: 12 }),
  thread({ client: ELENA, subject: "Partner offsite dates", preview: "Which of the three weeks works?", daysAgo: 12, hour: 14, replyAfterHours: 13 }),
  thread({ client: ELENA, subject: "Re: valuation deck", preview: "Two comments on the appendix.", daysAgo: 21, hour: 10, replyAfterHours: 11 }),
  thread({ client: ELENA, subject: "Introductions", preview: "Connecting you with our new CFO.", daysAgo: 29, hour: 13, replyAfterHours: 10 }),
  // previous period — comfortably same-day
  thread({ client: ELENA, subject: "Q2 fee note", preview: "Approved, please proceed.", daysAgo: 36, hour: 9, replyAfterHours: 4 }),
  thread({ client: ELENA, subject: "Diary clash", preview: "Can we move Tuesday's call?", daysAgo: 44, hour: 16, replyAfterHours: 5 }),
  thread({ client: ELENA, subject: "Retainer renewal", preview: "Let's discuss terms for next year.", daysAgo: 58, hour: 11, replyAfterHours: 5 }),

  // --- Mail WE sent. The ones with no reply are the dead threads. ---
  sent({ client: MARCUS, to: "Marcus Bell", subject: "Re: invoice question — revised schedule", preview: "Attaching the revised fee schedule. Let me know if the photography day works.", daysAgo: 6, hour: 11, replyAfterDays: null }),
  sent({ client: ELENA, to: "Elena Fischer", subject: "Lease review — clause 14 redline", preview: "Redlined draft attached, flagging the break clause for your view.", daysAgo: 3, hour: 15, replyAfterDays: null }),
  sent({ client: null, to: "Tom Whitfield", subject: "Q3 offsite logistics", preview: "Chasing the venue contract — can you confirm the numbers?", daysAgo: 7, hour: 9, replyAfterDays: null }),
  // Control: answered, so it must NOT be flagged.
  sent({ client: PRIYA, to: "Priya Raman", subject: "Board pack — final", preview: "Final version attached ahead of Thursday.", daysAgo: 5, hour: 16, replyAfterDays: 1 }),
];

// Automations for the preview. Descriptions say what each one DOES; nothing here
// runs on a timer (there is no scheduler), so no schedule is claimed.
export const AUTOMATIONS: Automation[] = [
  {
    id: "demo-auto-1",
    name: "Executive Priority Alignment",
    description: "Analyses your calendar, emails and task list to produce a prioritised daily briefing, flagging conflicts and urgent items.",
    status: "active",
    last_run: new Date(now - 2 * 3_600_000).toLocaleString(),
    total_runs: 34,
    trigger: "Manual",
    action: "Generate daily briefing",
  },
  {
    id: "demo-auto-2",
    name: "Meeting Preparation",
    description: "Compiles attendee profiles, agenda drafts and prep notes for upcoming meetings.",
    status: "active",
    last_run: new Date(now - 26 * 3_600_000).toLocaleString(),
    total_runs: 18,
    trigger: "Manual",
    action: "Generate meeting briefs",
  },
  {
    id: "demo-auto-3",
    name: "Executive Summary Inbox",
    description: "Triages the inbox — archives newsletters and surfaces only what needs executive attention.",
    status: "paused",
    last_run: new Date(now - 5 * 3_600_000).toLocaleString(),
    total_runs: 51,
    trigger: "Manual",
    action: "Triage inbox",
  },
];
