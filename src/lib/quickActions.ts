import type { FormField } from "@/lib/constants";

/**
 * Guided input schemas for AI Quick Actions. Keyed by the EXACT action label
 * strings used in QUICK_ACTION_GROUPS (src/lib/constants.ts). Each schema gives
 * the user a one-line "how to use" plus example-rich fields so they know exactly
 * what to provide before firing the action at the AI.
 */
export interface QuickActionSchema {
  howTo: string;
  example?: string;
  fields: FormField[];
}

const TONE: FormField = {
  name: "tone",
  label: "Tone",
  type: "select",
  options: ["Formal", "Warm", "Concise", "Assertive", "Collaborative"],
};

export const QUICK_ACTION_SCHEMAS: Record<string, QuickActionSchema> = {
  // ---- Drafting & Writing ----
  "Draft Email Response": {
    howTo: "Paste the email you need to reply to and choose a tone — the AI writes a ready-to-send reply.",
    fields: [
      {
        name: "email",
        label: "Email to reply to",
        type: "textarea",
        placeholder: "Paste the client's email — the latest message, or the whole thread if context matters.",
      },
      { name: "scope", label: "Reply scope", type: "select", options: ["Just the latest message", "The whole thread"] },
      TONE,
      {
        name: "notes",
        label: "Anything to include (optional)",
        type: "text",
        placeholder: "e.g. confirm Friday 3pm, request the deck",
      },
    ],
  },
  "Draft Executive Email": {
    howTo: "Tell the AI who it's for and the key points — it drafts a polished executive email.",
    fields: [
      { name: "recipient", label: "Recipient", type: "text", placeholder: "e.g. James Harrington, CFO" },
      { name: "subject", label: "Subject / Purpose", type: "text", placeholder: "e.g. Follow up on board meeting agenda" },
      {
        name: "points",
        label: "Key points to cover",
        type: "textarea",
        placeholder: "e.g. Confirm agenda items, request deck by Friday, mention CFO attendance",
      },
      TONE,
    ],
  },
  "Write Meeting Agenda": {
    howTo: "Describe the meeting and topics — the AI returns a timed, structured agenda.",
    fields: [
      { name: "meeting", label: "Meeting purpose", type: "text", placeholder: "e.g. Weekly leadership sync, Q3 board meeting" },
      { name: "attendees", label: "Attendees (optional)", type: "text", placeholder: "e.g. James Harrington, Priya Nair, David Osei" },
      {
        name: "topics",
        label: "Topics to cover",
        type: "textarea",
        placeholder: "e.g. Pipeline review, hiring plan, budget sign-off, blockers",
      },
      { name: "duration", label: "Duration (optional)", type: "text", placeholder: "e.g. 45 minutes" },
    ],
  },
  "Compose Follow-Up": {
    howTo: "Paste what happened and the AI writes a clear follow-up that confirms next steps.",
    fields: [
      {
        name: "context",
        label: "What are you following up on?",
        type: "textarea",
        placeholder: "Paste the meeting notes, call summary, or last email you're following up from.",
      },
      { name: "recipient", label: "Recipient (optional)", type: "text", placeholder: "e.g. James Harrington" },
      {
        name: "actions",
        label: "Action items / next steps (optional)",
        type: "text",
        placeholder: "e.g. send proposal by Tuesday, book follow-up call",
      },
      TONE,
    ],
  },
  "Summarize Document": {
    howTo: "Paste any document or long text — the AI returns a concise summary with the key points.",
    fields: [
      {
        name: "document",
        label: "Document or text",
        type: "textarea",
        placeholder: "Paste the report, contract, article, or notes you want summarised.",
      },
      {
        name: "length",
        label: "Summary length",
        type: "select",
        options: ["One-line TL;DR", "Short paragraph", "Bullet points", "Detailed summary"],
      },
      {
        name: "focus",
        label: "Focus (optional)",
        type: "text",
        placeholder: "e.g. risks, financials, action items, decisions",
      },
    ],
  },

  // ---- Scheduling & Calendar ----
  "Suggest Meeting Slots": {
    howTo: "Describe availability and the AI proposes sensible meeting slots to offer.",
    fields: [
      { name: "purpose", label: "Meeting purpose", type: "text", placeholder: "e.g. 30-min intro call with Apex Capital" },
      {
        name: "availability",
        label: "Your availability",
        type: "textarea",
        placeholder: "e.g. Free Tue/Wed afternoons, avoid mornings, working hours 9–6 GMT",
      },
      { name: "timezone", label: "Time zone (optional)", type: "text", placeholder: "e.g. GMT, EST" },
    ],
  },
  "Optimize Daily Schedule": {
    howTo: "Paste today's tasks and meetings — the AI returns a focused, time-blocked plan.",
    fields: [
      {
        name: "schedule",
        label: "Today's tasks & meetings",
        type: "textarea",
        placeholder: "e.g. 10am board call, draft 3 emails, review deck, 2pm 1:1, prep travel itinerary",
      },
      { name: "priorities", label: "Top priorities (optional)", type: "text", placeholder: "e.g. board deck must ship today" },
      { name: "hours", label: "Working hours (optional)", type: "text", placeholder: "e.g. 9am–6pm" },
    ],
  },
  "Draft Calendar Block": {
    howTo: "Describe the event and the AI drafts a clear calendar block with title and details.",
    fields: [
      { name: "title", label: "What is the block for?", type: "text", placeholder: "e.g. Deep work: Q3 board deck" },
      { name: "when", label: "When", type: "text", placeholder: "e.g. Thursday 2–4pm" },
      { name: "details", label: "Details (optional)", type: "textarea", placeholder: "e.g. No meetings, prep financials section, attach last quarter's deck" },
    ],
  },
  "Rescheduling Email": {
    howTo: "Tell the AI what needs moving and it writes a polite rescheduling email.",
    fields: [
      { name: "meeting", label: "Meeting to reschedule", type: "text", placeholder: "e.g. Friday 3pm strategy call with David Osei" },
      { name: "reason", label: "Reason (optional)", type: "text", placeholder: "e.g. clash with board meeting" },
      { name: "newtimes", label: "Proposed new times", type: "text", placeholder: "e.g. Monday 10am or Tuesday 2pm" },
      TONE,
    ],
  },

  // ---- Research ----
  "Client Research Brief": {
    howTo: "Name the client and the AI compiles a research brief covering background, priorities and talking points.",
    fields: [
      { name: "client", label: "Client / person", type: "text", placeholder: "e.g. James Harrington, Harrington Capital" },
      { name: "purpose", label: "Why do you need it?", type: "text", placeholder: "e.g. prep for first meeting, quarterly review" },
      {
        name: "known",
        label: "What you already know (optional)",
        type: "textarea",
        placeholder: "e.g. PE firm, £400M fund, focus on B2B SaaS, met once at a conference",
      },
    ],
  },
  "Quick Company Brief": {
    howTo: "Name a company and the AI returns a concise brief on what they do, size and recent news.",
    fields: [
      { name: "company", label: "Company name", type: "text", placeholder: "e.g. NovaMed Health" },
      { name: "angle", label: "What to focus on (optional)", type: "text", placeholder: "e.g. funding, products, leadership, market position" },
    ],
  },
  "Competitor Snapshot": {
    howTo: "Give your company and rivals — the AI returns a side-by-side competitor snapshot.",
    fields: [
      { name: "company", label: "Your company / product", type: "text", placeholder: "e.g. MadeEA — premium EA services" },
      {
        name: "competitors",
        label: "Competitors to compare",
        type: "textarea",
        placeholder: "e.g. Athena, Time etc, Belay — compare on pricing, positioning, target client",
      },
      { name: "focus", label: "Comparison focus (optional)", type: "text", placeholder: "e.g. pricing, features, positioning" },
    ],
  },
  "Executive Briefing Doc": {
    howTo: "Give the topic and the AI builds a structured executive briefing document.",
    fields: [
      { name: "topic", label: "Briefing topic", type: "text", placeholder: "e.g. Entering the US enterprise market" },
      { name: "audience", label: "Audience (optional)", type: "text", placeholder: "e.g. Board, leadership team" },
      {
        name: "context",
        label: "Background & key facts",
        type: "textarea",
        placeholder: "e.g. Current ARR £8.2M, 3 enterprise leads, hiring 2 US reps, main risk is compliance",
      },
    ],
  },
  "LinkedIn Research": {
    howTo: "Name the person or role and the AI summarises likely background and conversation hooks.",
    fields: [
      { name: "person", label: "Person / role", type: "text", placeholder: "e.g. Priya Nair, COO at Apex Capital" },
      { name: "purpose", label: "Why (optional)", type: "text", placeholder: "e.g. cold outreach, meeting prep, hiring" },
      { name: "notes", label: "Anything you know (optional)", type: "textarea", placeholder: "e.g. ex-McKinsey, posts about fintech, based in London" },
    ],
  },

  // ---- Reporting ----
  "Weekly Summary Report": {
    howTo: "Paste the week's activity and the AI writes a clean weekly summary report.",
    fields: [
      { name: "period", label: "Week / period", type: "text", placeholder: "e.g. Week of 23 June 2026" },
      {
        name: "highlights",
        label: "What happened this week",
        type: "textarea",
        placeholder: "e.g. 12 tasks done, 4 meetings, board deck approved, 2 automations deployed, onboarded new client",
      },
      { name: "audience", label: "Audience (optional)", type: "text", placeholder: "e.g. James Harrington, leadership team" },
    ],
  },
  "KPI Snapshot": {
    howTo: "Paste your metrics and the AI returns a tidy KPI snapshot with quick commentary.",
    fields: [
      { name: "period", label: "Period", type: "text", placeholder: "e.g. June 2026, Q2 2026" },
      {
        name: "metrics",
        label: "Metrics & numbers",
        type: "textarea",
        placeholder: "e.g. ARR £8.2M (+12%), churn 1.8%, pipeline £1.4M, NPS 62, 18 demos booked",
      },
      { name: "goals", label: "Targets (optional)", type: "text", placeholder: "e.g. ARR target £10M, churn under 2%" },
    ],
  },
  "Expense Summary": {
    howTo: "Paste the raw expenses and the AI returns a categorised expense summary.",
    fields: [
      { name: "period", label: "Period", type: "text", placeholder: "e.g. October 2025, Q3 2025" },
      {
        name: "expenses",
        label: "Expenses",
        type: "textarea",
        placeholder: "e.g. Business class flights £4,200, Hotel SF £1,800, Client dinner £340, Software £120",
      },
      { name: "budget", label: "Budget (optional)", type: "text", placeholder: "e.g. £8,000 approved" },
    ],
  },
  "Project Status Update": {
    howTo: "Describe where the project stands — the AI writes a clear status update.",
    fields: [
      { name: "project", label: "Project", type: "text", placeholder: "e.g. CRM migration, Website relaunch" },
      {
        name: "progress",
        label: "Progress & status",
        type: "textarea",
        placeholder: "e.g. 70% complete, data migrated, testing this week, launch on track for 15 July",
      },
      { name: "blockers", label: "Risks / blockers (optional)", type: "text", placeholder: "e.g. waiting on legal sign-off" },
      { name: "next", label: "Next steps (optional)", type: "text", placeholder: "e.g. UAT, train team, go live" },
    ],
  },

  // ---- Basic Automations ----
  "Run Inbox Triage": {
    howTo: "Paste your unread emails — the AI sorts them by priority with a suggested next action for each.",
    fields: [
      {
        name: "emails",
        label: "Emails to triage",
        type: "textarea",
        placeholder: "Paste a list of emails (sender, subject, snippet) — one per line or pasted straight from your inbox.",
      },
      {
        name: "priorities",
        label: "What matters most (optional)",
        type: "text",
        placeholder: "e.g. anything from James, invoices, meeting requests",
      },
    ],
  },
  "Inbox Triage Automation": {
    howTo: "Describe the rules and the AI drafts an inbox-triage automation: triggers, categories and actions.",
    fields: [
      {
        name: "rules",
        label: "How should email be sorted?",
        type: "textarea",
        placeholder: "e.g. VIP senders → flag urgent; invoices → forward to finance; newsletters → archive; meeting requests → draft a reply",
      },
      { name: "vips", label: "VIP senders (optional)", type: "text", placeholder: "e.g. James Harrington, board@, key clients" },
      { name: "schedule", label: "When should it run? (optional)", type: "text", placeholder: "e.g. every morning at 8am, on every new email" },
    ],
  },
  "Meeting Prep Automation": {
    howTo: "Describe your meeting-prep routine and the AI drafts an automation that assembles briefs before each meeting.",
    fields: [
      {
        name: "routine",
        label: "What should it prepare?",
        type: "textarea",
        placeholder: "e.g. pull attendee bios, last meeting notes, open action items, relevant docs",
      },
      { name: "timing", label: "When (optional)", type: "text", placeholder: "e.g. 30 minutes before every meeting" },
      { name: "delivery", label: "Where to deliver (optional)", type: "text", placeholder: "e.g. email, Slack DM, calendar note" },
    ],
  },
  "Priority Alignment Automation": {
    howTo: "Describe your priorities and the AI drafts an automation that keeps tasks aligned to them.",
    fields: [
      {
        name: "priorities",
        label: "Current priorities / goals",
        type: "textarea",
        placeholder: "e.g. close Q3 fundraise, ship board deck, onboard 2 clients",
      },
      { name: "trigger", label: "When should it check? (optional)", type: "text", placeholder: "e.g. when a task or priority changes, every Monday" },
      { name: "action", label: "What should it do? (optional)", type: "text", placeholder: "e.g. re-rank tasks, flag misaligned work, notify me" },
    ],
  },
  "Social Post Scheduler": {
    howTo: "Give the theme and cadence — the AI drafts a scheduled set of social posts.",
    fields: [
      { name: "topic", label: "Topic / theme", type: "text", placeholder: "e.g. productivity tips for founders, MadeEA service launch" },
      { name: "platforms", label: "Platforms", type: "text", placeholder: "e.g. LinkedIn, X, Instagram" },
      { name: "cadence", label: "Cadence (optional)", type: "text", placeholder: "e.g. 3 posts/week for the next 2 weeks" },
      { name: "notes", label: "Key messages (optional)", type: "textarea", placeholder: "e.g. emphasise premium positioning, include a CTA to book a call" },
    ],
  },
  "Newsletter Draft": {
    howTo: "Paste the updates to include and the AI drafts a ready-to-send newsletter.",
    fields: [
      { name: "audience", label: "Audience", type: "text", placeholder: "e.g. clients, prospects, internal team" },
      {
        name: "content",
        label: "Updates to include",
        type: "textarea",
        placeholder: "e.g. new automation features, client win, upcoming webinar, hiring news",
      },
      TONE,
    ],
  },
  "Weekly Digest": {
    howTo: "Paste the week's items and the AI compiles a scannable weekly digest.",
    fields: [
      { name: "period", label: "Week / period", type: "text", placeholder: "e.g. Week of 23 June 2026" },
      {
        name: "items",
        label: "Items to include",
        type: "textarea",
        placeholder: "e.g. key wins, decisions made, action items, upcoming meetings, things to watch",
      },
      { name: "audience", label: "Audience (optional)", type: "text", placeholder: "e.g. leadership team, the whole company" },
    ],
  },

  // ---- Quick rail extras (shared labels) ----
  "Generate Meeting Brief": {
    howTo: "Paste the transcript or notes — the AI returns a structured brief with decisions and action items.",
    fields: [
      {
        name: "source",
        label: "Meeting transcript or notes",
        type: "textarea",
        placeholder: "Paste the meeting transcript, your notes, or the agenda.",
      },
      { name: "attendees", label: "Attendees (optional)", type: "text", placeholder: "e.g. James Harrington, CFO" },
      { name: "focus", label: "Focus (optional)", type: "text", placeholder: "e.g. decisions, action items, risks" },
    ],
  },
  "Create Expense Report": {
    howTo: "Paste the raw expenses and the AI builds a formatted expense report.",
    fields: [
      { name: "client", label: "Client / account (optional)", type: "text", placeholder: "e.g. James Harrington, Internal" },
      { name: "period", label: "Period", type: "text", placeholder: "e.g. October 2025, Q3 2025" },
      {
        name: "expenses",
        label: "Expenses",
        type: "textarea",
        placeholder: "e.g. Business class flights £4,200, Hotel SF £1,800, Client dinner £340",
      },
      { name: "budget", label: "Approved budget (optional)", type: "text", placeholder: "e.g. £8,000" },
    ],
  },
  "Draft Invoice": {
    howTo: "Give the billing details and the AI drafts a professional invoice.",
    fields: [
      { name: "billto", label: "Bill to", type: "text", placeholder: "e.g. Harrington Capital Ltd" },
      {
        name: "services",
        label: "Services rendered",
        type: "textarea",
        placeholder: "e.g. Monthly EA retainer October 2025, Travel coordination, Board deck preparation",
      },
      { name: "total", label: "Total amount", type: "text", placeholder: "e.g. £4,500" },
      { name: "due", label: "Payment due date (optional)", type: "text", placeholder: "e.g. 30 November 2025" },
    ],
  },
};

/**
 * Fallback schema for any action not explicitly listed above. A single rich
 * context field plus an optional tone selector keeps every action usable.
 */
export const DEFAULT_QUICK_ACTION: { howTo: string; fields: FormField[] } = {
  howTo: "Add the context and details for this action — the more you give the AI, the better the result.",
  fields: [
    {
      name: "context",
      label: "Context / details",
      type: "textarea",
      placeholder: "Describe what you need, paste any relevant text, and note who it's for or any constraints.",
    },
    {
      name: "tone",
      label: "Tone (optional)",
      type: "select",
      options: ["Formal", "Warm", "Concise", "Assertive", "Collaborative"],
    },
  ],
};
