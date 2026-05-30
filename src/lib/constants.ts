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
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  group: "Operations" | "AI Suite";
  badge?: string;
}

export const NAV: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, group: "Operations" },
  { to: "/tasks", label: "Task Manager", icon: CheckSquare, group: "Operations" },
  { to: "/communication", label: "Communication Center", icon: Mail, group: "Operations" },
  { to: "/quick-actions", label: "AI Quick Actions", icon: Zap, group: "Operations" },
  { to: "/clients", label: "Client Vault", icon: Users, group: "Operations" },
  { to: "/automation", label: "Automation", icon: Workflow, group: "Operations" },
  { to: "/integrations", label: "Integrations", icon: Plug, group: "Operations" },
  { to: "/studio", label: "Communication Studio", icon: PenLine, group: "AI Suite", badge: "Claude" },
  { to: "/bookkeeping", label: "Bookkeeping AI", icon: Calculator, group: "AI Suite", badge: "Claude" },
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
}

export interface StudioFormat {
  key: string;
  title: string;
  desc: string;
  fields: FormField[];
}

export const STUDIO_FORMATS: StudioFormat[] = [
  {
    key: "email",
    title: "Executive Email",
    desc: "Draft polished professional emails in any tone",
    fields: [
      { name: "recipient", label: "Recipient", type: "text", placeholder: "e.g. James Harrington" },
      { name: "subject", label: "Subject / Purpose", type: "text", placeholder: "e.g. Follow up on board meeting agenda" },
      { name: "tone", label: "Tone", type: "select", options: ["Formal", "Collaborative", "Assertive", "Concise", "Warm"] },
      { name: "points", label: "Key Points to Cover", type: "textarea", placeholder: "e.g. Confirm agenda items, request deck by Friday, mention CFO attendance" },
    ],
  },
  {
    key: "technical",
    title: "Technical Writing",
    desc: "Process documents, SOPs, briefs and technical content",
    fields: [
      { name: "doc_type", label: "Document Type", type: "select", options: ["Standard Operating Procedure", "Technical Brief", "White Paper", "Requirements Document", "Implementation Guide"] },
      { name: "topic", label: "Topic / Subject", type: "text", placeholder: "e.g. Onboarding new executive assistant clients" },
      { name: "audience", label: "Audience", type: "text", placeholder: "e.g. Senior EAs, Management team" },
      { name: "context", label: "Key Information / Context", type: "textarea", placeholder: "e.g. Three-step onboarding: discovery call, system setup, 30-day check-in" },
    ],
  },
  {
    key: "report",
    title: "Report Writing",
    desc: "Generate structured reports with executive summaries",
    fields: [
      { name: "report_type", label: "Report Type", type: "select", options: ["Executive Summary", "Weekly Status Report", "Project Report", "Board Report", "Performance Review"] },
      { name: "period", label: "Period / Timeframe", type: "text", placeholder: "e.g. Q3 2025, Week of Nov 4" },
      { name: "org", label: "Client / Organisation", type: "text", placeholder: "e.g. James Harrington / Harrington Capital" },
      { name: "highlights", label: "Key Highlights & Data", type: "textarea", placeholder: "e.g. 12 tasks completed, 4 meetings, 2 new automations deployed, board deck approved" },
    ],
  },
  {
    key: "proposal",
    title: "Proposal / Pitch",
    desc: "Write business proposals and pitches",
    fields: [
      { name: "org", label: "Recipient / Organisation", type: "text", placeholder: "e.g. Apex Capital" },
      { name: "topic", label: "Service / Proposal Topic", type: "text", placeholder: "e.g. Executive Assistance Retainer Package" },
      { name: "value", label: "Key Value Propositions", type: "textarea", placeholder: "e.g. Saves 15 hours per week, reduces scheduling errors, premium AI automations included" },
      { name: "investment", label: "Investment Range (optional)", type: "text", placeholder: "e.g. £3,500 – £5,000 per month" },
    ],
  },
  {
    key: "pressrelease",
    title: "Press Release",
    desc: "Craft professional press releases and announcements",
    fields: [
      { name: "headline", label: "Headline / Announcement", type: "text", placeholder: "e.g. Harrington Capital Closes £400M Fund IV" },
      { name: "company", label: "Company / Organisation", type: "text", placeholder: "e.g. Harrington Capital" },
      { name: "datelocation", label: "Date & Location", type: "text", placeholder: "e.g. London, 4 November 2025" },
      { name: "details", label: "Key Details & Quotes", type: "textarea", placeholder: "e.g. Fund IV targets B2B SaaS, healthcare tech; James Harrington quote..." },
    ],
  },
];

export const BOOKKEEPING_TYPES: StudioFormat[] = [
  {
    key: "expense",
    title: "Expense Report",
    desc: "Generate formatted expense reports from raw data",
    fields: [
      { name: "client", label: "Client / Account", type: "select", options: ["James Harrington", "Priya Nair", "David Osei", "Internal"] },
      { name: "period", label: "Period", type: "text", placeholder: "e.g. October 2025, Q3 2025" },
      { name: "expenses", label: "Expenses (comma separated)", type: "textarea", placeholder: "e.g. Business class flights £4,200, Hotel SF £1,800, Client dinner £340" },
      { name: "budget", label: "Approved Budget", type: "text", placeholder: "e.g. £8,000" },
    ],
  },
  {
    key: "invoice",
    title: "Invoice Generator",
    desc: "Create professional invoices for client billing",
    fields: [
      { name: "billto", label: "Bill To", type: "text", placeholder: "e.g. Harrington Capital Ltd" },
      { name: "services", label: "Services Rendered", type: "textarea", placeholder: "e.g. Monthly EA retainer October 2025, Travel coordination, Board deck preparation" },
      { name: "total", label: "Total Amount", type: "text", placeholder: "e.g. £4,500" },
      { name: "due", label: "Payment Due Date", type: "text", placeholder: "e.g. 30 November 2025" },
    ],
  },
  {
    key: "budget",
    title: "Budget Summary",
    desc: "Summarise and analyse budget allocations",
    fields: [
      { name: "dept", label: "Client / Department", type: "text", placeholder: "e.g. Harrington Capital Executive Office" },
      { name: "period", label: "Period", type: "text", placeholder: "e.g. Q4 2025" },
      { name: "categories", label: "Budget Categories & Limits", type: "textarea", placeholder: "e.g. Travel: £20,000, Entertainment: £8,000, Professional Services: £15,000" },
      { name: "notes", label: "Additional Notes", type: "text", placeholder: "e.g. 10% contingency approved by CFO" },
    ],
  },
  {
    key: "financial",
    title: "Financial Brief",
    desc: "Create concise financial overview documents",
    fields: [
      { name: "company", label: "Company / Portfolio Co.", type: "text", placeholder: "e.g. NovaMed Health" },
      { name: "period", label: "Period", type: "text", placeholder: "e.g. Q3 2025" },
      { name: "metrics", label: "Key Financial Metrics", type: "textarea", placeholder: "e.g. ARR: £8.2M, Growth: 140% YoY, Burn: £420K/month, Runway: 14 months" },
      { name: "context", label: "Context / Purpose", type: "text", placeholder: "e.g. Pre-meeting brief for James, investor due diligence" },
    ],
  },
];

export const AUTOMATION_TRIGGERS = ["New Email Received", "Daily at 8:00 AM", "Before Every Meeting", "New Task Created", "Every Monday Morning", "When Priority Changes", "End of Business Day"];
export const AUTOMATION_ACTIONS = ["Draft & Send Summary", "Send Slack Notification", "Update Task List", "Create Calendar Block", "Generate Report", "Flag for Review", "Archive & Log"];
