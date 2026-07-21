import {
  LayoutDashboard,
  CheckSquare,
  Mail,
  Zap,
  Users,
  Workflow,
  PenLine,
  Calculator,
  Plug,
  ClipboardCheck,
  GraduationCap,
  TrendingUp,
  Trophy,
  Plane,
  MailCheck,
  CalendarCheck,
  Crosshair,
  Mic,
  Sunrise,
  Brain,
  Scale,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  group: "Operations" | "AI Suite" | "Second Brain";
  badge?: string;
}

export const NAV: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, group: "Operations" },
  { to: "/tasks", label: "Task Manager", icon: CheckSquare, group: "Operations" },
  { to: "/communication", label: "Communication Center", icon: Mail, group: "Operations" },
  { to: "/quick-actions", label: "AI Quick Actions", icon: Zap, group: "Operations" },
  { to: "/clients", label: "Client Vault", icon: Users, group: "Operations" },
  { to: "/sops", label: "SOPs", icon: ClipboardCheck, group: "Operations" },
  { to: "/automation", label: "Automation", icon: Workflow, group: "Operations" },
  { to: "/integrations", label: "Integrations", icon: Plug, group: "Operations" },
  { to: "/studio", label: "Communication Studio", icon: PenLine, group: "AI Suite", badge: "Claude" },
  { to: "/bookkeeping", label: "Bookkeeping AI", icon: Calculator, group: "AI Suite", badge: "Claude" },
  // The three core-service helpers. They live in AI Suite rather than a group of
  // their own: they're Claude-powered tools like their neighbours here, and each
  // upgrades an Operations page above rather than replacing it.
  { to: "/email-helper", label: "Email Helper", icon: MailCheck, group: "AI Suite", badge: "Claude" },
  { to: "/meeting-helper", label: "Meeting Helper", icon: CalendarCheck, group: "AI Suite", badge: "Claude" },
  { to: "/focus", label: "Focus Helper", icon: Crosshair, group: "AI Suite" },
  // Second Brain — helpers that read the workspace's own data rather than a form.
  // Voice-Note first: it's the flagship demo, and the one to land on.
  { to: "/voice-notes", label: "Voice-Note Helper", icon: Mic, group: "Second Brain" },
  { to: "/briefing", label: "Daily Briefing Helper", icon: Sunrise, group: "Second Brain" },
  { to: "/memory", label: "Memory Helper", icon: Brain, group: "Second Brain" },
  { to: "/decision", label: "Decision Helper", icon: Scale, group: "Second Brain" },
  { to: "/homework", label: "Homework Helper", icon: GraduationCap, group: "Second Brain" },
  { to: "/investor-update", label: "Investor-Update Helper", icon: TrendingUp, group: "Second Brain" },
  { to: "/scoreboard", label: "Scoreboard Helper", icon: Trophy, group: "Second Brain" },
  { to: "/travel", label: "Travel Helper", icon: Plane, group: "Second Brain" },
];

export const QUICK_RAIL = [
  "Draft Email Response",
  "Generate Meeting Brief",
  "Create Expense Report",
  "Run Inbox Triage",
  "Client Research Brief",
  "Draft Invoice",
];

export const QUICK_ACTION_GROUPS: { title: string; actions: string[] }[] = [
  { title: "Drafting & Writing", actions: ["Draft Executive Email", "Write Meeting Agenda", "Compose Follow-Up", "Summarize Document"] },
  { title: "Scheduling & Calendar", actions: ["Suggest Meeting Slots", "Optimize Daily Schedule", "Draft Calendar Block", "Rescheduling Email"] },
  { title: "Research", actions: ["Quick Company Brief", "Competitor Snapshot", "Executive Briefing Doc", "LinkedIn Research"] },
  { title: "Reporting", actions: ["Weekly Summary Report", "KPI Snapshot", "Expense Summary", "Project Status Update"] },
  { title: "Basic Automations", actions: ["Inbox Triage Automation", "Meeting Prep Automation", "Priority Alignment Automation", "Social Post Scheduler", "Newsletter Draft", "Weekly Digest"] },
];

// ---- Communication Studio formats ----
export interface FormField {
  name: string;
  label: string;
  type: "text" | "textarea" | "select";
  placeholder?: string;
  options?: string[];
  help?: string;
}

export interface StudioFormat {
  key: string;
  title: string;
  desc: string;
  fields: FormField[];
  howTo?: string;
  example?: string;
}

export const STUDIO_FORMATS: StudioFormat[] = [
  {
    key: "email",
    title: "Executive Email",
    desc: "Draft polished professional emails in any tone",
    howTo: "Tell the AI who it's writing to, why, and the points to hit — it returns a ready-to-send email in your chosen tone.",
    example: "Recipient: James Harrington · Tone: Collaborative · Points: confirm agenda, request deck by Friday.",
    fields: [
      { name: "recipient", label: "Recipient", type: "text", placeholder: "e.g. James Harrington", help: "Who the email is addressed to. A name or role helps the AI pitch the greeting and formality." },
      { name: "subject", label: "Subject / Purpose", type: "text", placeholder: "e.g. Follow up on board meeting agenda", help: "The reason you're writing — this becomes the subject line and frames the message." },
      { name: "tone", label: "Tone", type: "select", options: ["Formal", "Collaborative", "Assertive", "Concise", "Warm"], help: "Sets the voice of the email, from buttoned-up formal to friendly and warm." },
      { name: "points", label: "Key Points to Cover", type: "textarea", placeholder: "e.g. Confirm agenda items, request deck by Friday, mention CFO attendance", help: "List every point to include — one per idea. The AI weaves them into a coherent message." },
    ],
  },
  {
    key: "technical",
    title: "Technical Writing",
    desc: "Process documents, SOPs, briefs and technical content",
    howTo: "Pick the document type, name the topic and audience, then add the facts to include — the AI structures it into a clean, formatted document.",
    example: "Document: SOP · Topic: Client onboarding · Audience: Senior EAs · Context: discovery call → setup → 30-day check-in.",
    fields: [
      { name: "doc_type", label: "Document Type", type: "select", options: ["Standard Operating Procedure", "Technical Brief", "White Paper", "Requirements Document", "Implementation Guide"], help: "The kind of document to produce — each uses a different structure and level of formality." },
      { name: "topic", label: "Topic / Subject", type: "text", placeholder: "e.g. Onboarding new executive assistant clients", help: "What the document is about, in a short phrase." },
      { name: "audience", label: "Audience", type: "text", placeholder: "e.g. Senior EAs, Management team", help: "Who will read it. The AI tunes vocabulary and detail to suit them." },
      { name: "context", label: "Key Information / Context", type: "textarea", placeholder: "e.g. Three-step onboarding: discovery call, system setup, 30-day check-in", help: "The steps, facts, or details to cover. The more specific, the more accurate the output." },
    ],
  },
  {
    key: "report",
    title: "Report Writing",
    desc: "Generate structured reports with executive summaries",
    howTo: "Choose a report type and timeframe, name the client, then paste your highlights and numbers — the AI shapes them into a structured report with an executive summary.",
    example: "Type: Weekly Status · Period: Week of Nov 4 · Highlights: 12 tasks done, 4 meetings, board deck approved.",
    fields: [
      { name: "report_type", label: "Report Type", type: "select", options: ["Executive Summary", "Weekly Status Report", "Project Report", "Board Report", "Performance Review"], help: "The report format to generate — sets the sections and tone." },
      { name: "period", label: "Period / Timeframe", type: "text", placeholder: "e.g. Q3 2025, Week of Nov 4", help: "The window the report covers." },
      { name: "org", label: "Client / Organisation", type: "text", placeholder: "e.g. James Harrington / Harrington Capital", help: "Who the report is for or about." },
      { name: "highlights", label: "Key Highlights & Data", type: "textarea", placeholder: "e.g. 12 tasks completed, 4 meetings, 2 new automations deployed, board deck approved", help: "The wins, metrics, and facts to report. Include numbers where you can — the AI turns them into prose." },
    ],
  },
  {
    key: "proposal",
    title: "Proposal / Pitch",
    desc: "Write business proposals and pitches",
    howTo: "Name the prospect and what you're offering, list the value they get, and optionally a price — the AI writes a persuasive proposal.",
    example: "Org: Apex Capital · Topic: EA Retainer · Value: saves 15 hrs/week, fewer scheduling errors · Investment: £3,500–£5,000/mo.",
    fields: [
      { name: "org", label: "Recipient / Organisation", type: "text", placeholder: "e.g. Apex Capital", help: "The company or person you're pitching to." },
      { name: "topic", label: "Service / Proposal Topic", type: "text", placeholder: "e.g. Executive Assistance Retainer Package", help: "What you're proposing — the offer or package." },
      { name: "value", label: "Key Value Propositions", type: "textarea", placeholder: "e.g. Saves 15 hours per week, reduces scheduling errors, premium AI automations included", help: "The concrete benefits the client gets. Lead with outcomes and numbers." },
      { name: "investment", label: "Investment Range (optional)", type: "text", placeholder: "e.g. £3,500 – £5,000 per month", help: "Optional pricing. Leave blank to omit cost from the proposal." },
    ],
  },
  {
    key: "pressrelease",
    title: "Press Release",
    desc: "Craft professional press releases and announcements",
    howTo: "Give the announcement, the company, the date/location dateline, and the supporting details or quotes — the AI formats a publication-ready press release.",
    example: "Headline: Closes £400M Fund IV · Company: Harrington Capital · Dateline: London, 4 Nov 2025.",
    fields: [
      { name: "headline", label: "Headline / Announcement", type: "text", placeholder: "e.g. Harrington Capital Closes £400M Fund IV", help: "The news in one line — this becomes the headline." },
      { name: "company", label: "Company / Organisation", type: "text", placeholder: "e.g. Harrington Capital", help: "The organisation making the announcement." },
      { name: "datelocation", label: "Date & Location", type: "text", placeholder: "e.g. London, 4 November 2025", help: "The dateline — where and when the release is issued." },
      { name: "details", label: "Key Details & Quotes", type: "textarea", placeholder: "e.g. Fund IV targets B2B SaaS, healthcare tech; James Harrington quote...", help: "The supporting facts and any quotes to include. Quotes make the release feel authentic." },
    ],
  },
];

export const BOOKKEEPING_TYPES: StudioFormat[] = [
  {
    key: "expense",
    title: "Expense Report",
    desc: "Generate formatted expense reports from raw data",
    howTo: "Pick the client and period, paste your expenses as a comma-separated list, and give the approved budget — the AI totals them and formats a clean report with a budget comparison.",
    example: "Client: James Harrington · Period: October 2025 · Expenses: Flights £4,200, Hotel £1,800 · Budget: £8,000.",
    fields: [
      { name: "client", label: "Client / Account", type: "select", options: ["James Harrington", "Priya Nair", "David Osei", "Internal"], help: "Which client or account the expenses belong to." },
      { name: "period", label: "Period", type: "text", placeholder: "e.g. October 2025, Q3 2025", help: "The timeframe the expenses cover." },
      { name: "expenses", label: "Expenses (comma separated)", type: "textarea", placeholder: "e.g. Business class flights £4,200, Hotel SF £1,800, Client dinner £340", help: "List each expense with its amount, separated by commas. The AI itemises and totals them." },
      { name: "budget", label: "Approved Budget", type: "text", placeholder: "e.g. £8,000", help: "The approved spend limit, so the report can flag whether you're over or under." },
    ],
  },
  {
    key: "invoice",
    title: "Invoice Generator",
    desc: "Create professional invoices for client billing",
    howTo: "Enter who to bill, the services delivered, the total, and the due date — the AI lays it out as a professional invoice ready to send.",
    example: "Bill to: Harrington Capital Ltd · Services: EA retainer, travel coordination · Total: £4,500 · Due: 30 Nov 2025.",
    fields: [
      { name: "billto", label: "Bill To", type: "text", placeholder: "e.g. Harrington Capital Ltd", help: "The client or company being invoiced — appears in the bill-to block." },
      { name: "services", label: "Services Rendered", type: "textarea", placeholder: "e.g. Monthly EA retainer October 2025, Travel coordination, Board deck preparation", help: "The work delivered, as line items. Each becomes a row on the invoice." },
      { name: "total", label: "Total Amount", type: "text", placeholder: "e.g. £4,500", help: "The amount due, including currency." },
      { name: "due", label: "Payment Due Date", type: "text", placeholder: "e.g. 30 November 2025", help: "When payment is expected." },
    ],
  },
  {
    key: "budget",
    title: "Budget Summary",
    desc: "Summarise and analyse budget allocations",
    howTo: "Name the client and period, list each budget category with its limit, and add any notes — the AI produces a summarised, analysed budget overview.",
    example: "Dept: Harrington Exec Office · Period: Q4 2025 · Categories: Travel £20,000, Entertainment £8,000.",
    fields: [
      { name: "dept", label: "Client / Department", type: "text", placeholder: "e.g. Harrington Capital Executive Office", help: "Whose budget this is — the client, team, or department." },
      { name: "period", label: "Period", type: "text", placeholder: "e.g. Q4 2025", help: "The timeframe the budget covers." },
      { name: "categories", label: "Budget Categories & Limits", type: "textarea", placeholder: "e.g. Travel: £20,000, Entertainment: £8,000, Professional Services: £15,000", help: "Each spending category with its allocated limit. The AI tallies and analyses them." },
      { name: "notes", label: "Additional Notes", type: "text", placeholder: "e.g. 10% contingency approved by CFO", help: "Any extra context, such as contingencies or approvals." },
    ],
  },
  {
    key: "financial",
    title: "Financial Brief",
    desc: "Create concise financial overview documents",
    howTo: "Name the company and period, paste the key metrics, and say what the brief is for — the AI writes a concise financial overview tailored to that purpose.",
    example: "Company: NovaMed Health · Period: Q3 2025 · Metrics: ARR £8.2M, 140% YoY, runway 14 mo · Purpose: investor brief.",
    fields: [
      { name: "company", label: "Company / Portfolio Co.", type: "text", placeholder: "e.g. NovaMed Health", help: "The business the brief covers." },
      { name: "period", label: "Period", type: "text", placeholder: "e.g. Q3 2025", help: "The reporting window for the figures." },
      { name: "metrics", label: "Key Financial Metrics", type: "textarea", placeholder: "e.g. ARR: £8.2M, Growth: 140% YoY, Burn: £420K/month, Runway: 14 months", help: "The numbers to feature — revenue, growth, burn, runway, etc. The AI explains and contextualises them." },
      { name: "context", label: "Context / Purpose", type: "text", placeholder: "e.g. Pre-meeting brief for James, investor due diligence", help: "Why the brief is needed and who reads it, so the AI frames it appropriately." },
    ],
  },
];

export const AUTOMATION_TRIGGERS = ["New Email Received", "Daily at 8:00 AM", "Before Every Meeting", "New Task Created", "Every Monday Morning", "When Priority Changes", "End of Business Day"];
export const AUTOMATION_ACTIONS = ["Draft & Send Summary", "Send Slack Notification", "Update Task List", "Create Calendar Block", "Generate Report", "Flag for Review", "Archive & Log"];
