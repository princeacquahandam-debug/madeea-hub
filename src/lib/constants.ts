import {
  Camera,
  LayoutDashboard,
  CheckSquare,
  Mail,
  Zap,
  Users,
  Workflow,
  Plug,
  ClipboardCheck,
  ClipboardList,
  Trophy,
  Brain,
  Clock,
  Video,
  Upload,
  Repeat,
  Bookmark,
  KeyRound,
  GraduationCap,
  StickyNote,
  type LucideIcon,
} from "lucide-react";

/* ---------------------------------------------------------------------------
   Nav groups, in sidebar order.

   The problem this solves: "Operations" held 18 of the 21 items. A group label
   that applies to almost everything sorts nothing, so the sidebar was one flat
   18-item scan every time, and the two items NOT in it were the two nobody
   could find.

   Each group answers a different question the EA is asking when they reach for
   the sidebar, which is what makes them scannable rather than arbitrary:

     My Day          what do I do now
     Clients & Files where is that thing for this client
     Playbook        how do we do this
     Insights        what does the work add up to
     Setup           configure once, then forget

   "AI Suite" is gone because the 09 Aug cut emptied it and an expandable group
   that opens onto nothing is worse than no group. "Second Brain" is gone
   because §7 removes it by name (8:39).
   --------------------------------------------------------------------------- */
export const NAV_GROUPS = ["My Day", "Clients & Files", "Playbook", "Insights", "Setup"] as const;
export type NavGroup = (typeof NAV_GROUPS)[number];

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  group: NavGroup;
  badge?: string;
}

export const NAV: NavItem[] = [
  /* ---- My Day -------------------------------------------------------------
     The daily loop, in the order §9.3 records the team working out by asking
     "pag ako EA, anong gagawin ko?" (Rowena 44:00, 1:15:46; Reichelle 45:24):
     email, then tasks, then research, then the EOD, with the clock around it.

     Communication sits ABOVE Tasks on purpose. An EA opens their inbox first
     and works out what the day is from it; the board is where that turns into
     work. The old order put the board first because it was built first.

     Calendar would be the first item here. It is §5.7, parked pending OQ-3. */
  { to: "/", label: "Dashboard", icon: LayoutDashboard, group: "My Day" },
  /* The route stays /inbox. Seventeen places link to it, the name is the
     only thing anyone sees, and renaming the path would buy nothing but a
     round of dead links. /communication already redirects here. */
  { to: "/inbox", label: "Communication Center", icon: Mail, group: "My Day" },
  { to: "/tasks", label: "Task Manager", icon: CheckSquare, group: "My Day" },
  { to: "/quick-actions", label: "AI Quick Actions", icon: Zap, group: "My Day" },
  // The day closes here: what you did, and that you were there to do it.
  { to: "/eod", label: "EOD Reports", icon: ClipboardList, group: "My Day" },
  { to: "/time", label: "Time Tracker", icon: Clock, group: "My Day" },
  // Beside the tracker, because a screenshot only means anything next to the
  // session that produced it.
  { to: "/screenshots", label: "Screenshots", icon: Camera, group: "My Day" },

  /* ---- Clients & Files ----------------------------------------------------
     Everything you go looking FOR rather than work you do. The client record
     and their logins sit together because that is how you arrive at them: you
     open the client, then you need to get into their tools. */
  { to: "/clients", label: "Client Vault", icon: Users, group: "Clients & Files" },
  { to: "/credentials", label: "Password Manager", icon: KeyRound, group: "Clients & Files" },
  { to: "/notes", label: "Notes", icon: StickyNote, group: "Clients & Files" },
  { to: "/uploads", label: "Uploads", icon: Upload, group: "Clients & Files" },
  { to: "/saved", label: "Saved", icon: Bookmark, group: "Clients & Files" },

  /* ---- Playbook -----------------------------------------------------------
     Work defined once and reused, which is the whole point of R-4.6.6: the SOP
     library must be linked to the Academy. Grouping them makes that link a
     thing you can see rather than a line in a spec. The loop reads top to
     bottom: record it, write it up, put it on a schedule, learn it.

     "Workflows", not "SOPs". PROJECT_PLAN §5.6 treats them as the same thing,
     and "workflow" is the word the team and the reference product use out
     loud. The route stays /sops so existing links still work. */
  { to: "/sops", label: "Workflows", icon: ClipboardCheck, group: "Playbook" },
  { to: "/videos", label: "Video Instruction", icon: Video, group: "Playbook" },
  { to: "/routines", label: "Routines", icon: Repeat, group: "Playbook" },
  /* The Academy was routed but never in the nav. The only way in was a promo
     card in the sidebar footer, which is dismissible, so dismissing it hid the
     training entirely. "Training Center" is what the team calls it. */
  { to: "/academy", label: "Training Center", icon: GraduationCap, group: "Playbook" },

  /* ---- Setup --------------------------------------------------------------
     Configured once, then forgotten. Bottom of the list, away from daily work
     (nav-hierarchy: primary and secondary navigation stay separated). */
  { to: "/automation", label: "Automation", icon: Workflow, group: "Setup" },
  { to: "/integrations", label: "Integrations", icon: Plug, group: "Setup" },
  /* Cut by the 09 Aug product direction, which judged every feature on two
     questions: does it prove the EA's work, and does it make the EA replaceable
     without pain. These answered neither, and each loses to a free tool:

       Communication Studio   Superhuman, Missive, Front
       Bookkeeping AI         Xero, QuickBooks - and an EA does not do bookkeeping
       Investor-Update        ChatGPT with a prompt; nobody asked for it
       Travel Helper          same

     Folded rather than dropped - the capability belongs inside the page it
     upgrades, not in a tab of its own:

       Email Helper     -> Inbox
       Meeting Helper   -> AI Quick Actions
       Daily Briefing   -> Dashboard

     Pages stay on disk and routes are unmounted in App.tsx, so any of them
     returns in one commit if Prince disagrees. Scoreboard is deliberately still
     here: it is to be REPURPOSED as the client proof surface, built from EOD and
     task data only, which is a build rather than a cut. */
  /* ---- Insights -----------------------------------------------------------
     Both of these read the workspace and hand back evidence, rather than taking
     a brief and writing something. That is the line between this group and My
     Day.

     P-4 for each, since §7 demands one:
       Meeting Intelligence  turns a call the EA sat through into tasks and
                             notes, so they do not retype it afterwards
       Client Scoreboard     shows a client what their EA moved this week,
                             computed from tasks and EOD data rather than
                             claimed                                          */
  { to: "/meeting-intelligence", label: "Meeting Intelligence", icon: Brain, group: "Insights" },
  /* Removed by the 10 Aug product audit (§7). The pages stay on disk and the
     routes are unmounted in App.tsx, so any of them returns by restoring one
     line here and one there. §6 asks for deferred work to be grayed out, not
     deleted, and nothing ships until Prince signs off.

       Focus Helper        "not designed for the needs of clients"      (13:00)
       Voice-Note Helper   same                                         (13:00)
       Memory Helper       Laura: no different from Notes               (9:17)
       Decision Helper     not a real EA daily job                      (9:17)
       Homework Helper     not an EA workflow at all; fails P-4         (9:17)

     Each also fails the §7 test: nobody could say in one sentence how it helps
     an EA do their job or a client manage their EA. */
  // Not "Helper" any more. It computes real numbers out of tasks, messages and
  // meetings (lib/scoreboard.ts); the AI only writes a narrative over the top.
  // "Helper" was the naming family the audit emptied, and this is not one.
  { to: "/scoreboard", label: "Client Scoreboard", icon: Trophy, group: "Insights" },
];

// The scrolling rail in the assistant panel. These have to be labels that exist
// in QUICK_ACTION_GROUPS, otherwise the rail offers actions the menu cannot
// open. Four of the six pointed at names retired by the §5.1 consolidation.
export const QUICK_RAIL = [
  "Write Email",
  "Triage the Inbox",
  "Meeting Preparation",
  "Research Brief",
  "Status Report",
  "Draft Social Content",
];

/* Audit §5.1: 22 down to 11, with the groups ordered by R-5.1.4's list of what
   EAs actually work in daily (email and comms, social, research) rather than by
   what happened to be built first.

   The old 22 are still in lib/quickActions.ts and restoring any of them is one
   entry here, per §6. What each replacement absorbed is documented beside it.

   Brian's 70+ bot library is the real subject of §5.1 and is not in this repo.
   Its shortlist is OQ-6, for Rowena and Brian. */
export const QUICK_ACTION_GROUPS: { title: string; actions: string[] }[] = [
  { title: "Email & Communication", actions: ["Write Email", "AI Draft Response", "Triage the Inbox", "Newsletter Draft"] },
  { title: "Research", actions: ["Research Brief", "Summarize Document"] },
  { title: "Social & LinkedIn", actions: ["Draft Social Content"] },
  { title: "Meetings & Calendar", actions: ["Meeting Preparation", "Plan the Calendar"] },
  { title: "Reporting", actions: ["Status Report", "Expense Report", "Draft Invoice"] },
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
    howTo: "Tell the AI who it's writing to, why, and the points to hit, it returns a ready-to-send email in your chosen tone.",
    example: "Recipient: James Harrington · Tone: Collaborative · Points: confirm agenda, request deck by Friday.",
    fields: [
      { name: "recipient", label: "Recipient", type: "text", placeholder: "e.g. James Harrington", help: "Who the email is addressed to. A name or role helps the AI pitch the greeting and formality." },
      { name: "subject", label: "Subject / Purpose", type: "text", placeholder: "e.g. Follow up on board meeting agenda", help: "The reason you're writing, this becomes the subject line and frames the message." },
      { name: "tone", label: "Tone", type: "select", options: ["Formal", "Collaborative", "Assertive", "Concise", "Warm"], help: "Sets the voice of the email, from buttoned-up formal to friendly and warm." },
      { name: "points", label: "Key Points to Cover", type: "textarea", placeholder: "e.g. Confirm agenda items, request deck by Friday, mention CFO attendance", help: "List every point to include. One per idea. The AI weaves them into a coherent message." },
    ],
  },
  {
    key: "technical",
    title: "Technical Writing",
    desc: "Process documents, SOPs, briefs and technical content",
    howTo: "Pick the document type, name the topic and audience, then add the facts to include, the AI structures it into a clean, formatted document.",
    example: "Document: SOP · Topic: Client onboarding · Audience: Senior EAs · Context: discovery call → setup → 30-day check-in.",
    fields: [
      { name: "doc_type", label: "Document Type", type: "select", options: ["Standard Operating Procedure", "Technical Brief", "White Paper", "Requirements Document", "Implementation Guide"], help: "The kind of document to produce. Each uses a different structure and level of formality." },
      { name: "topic", label: "Topic / Subject", type: "text", placeholder: "e.g. Onboarding new executive assistant clients", help: "What the document is about, in a short phrase." },
      { name: "audience", label: "Audience", type: "text", placeholder: "e.g. Senior EAs, Management team", help: "Who will read it. The AI tunes vocabulary and detail to suit them." },
      { name: "context", label: "Key Information / Context", type: "textarea", placeholder: "e.g. Three-step onboarding: discovery call, system setup, 30-day check-in", help: "The steps, facts, or details to cover. The more specific, the more accurate the output." },
    ],
  },
  {
    key: "report",
    title: "Report Writing",
    desc: "Generate structured reports with executive summaries",
    howTo: "Choose a report type and timeframe, name the client, then paste your highlights and numbers, the AI shapes them into a structured report with an executive summary.",
    example: "Type: Weekly Status · Period: Week of Nov 4 · Highlights: 12 tasks done, 4 meetings, board deck approved.",
    fields: [
      { name: "report_type", label: "Report Type", type: "select", options: ["Executive Summary", "Weekly Status Report", "Project Report", "Board Report", "Performance Review"], help: "The report format to generate. Sets the sections and tone." },
      { name: "period", label: "Period / Timeframe", type: "text", placeholder: "e.g. Q3 2025, Week of Nov 4", help: "The window the report covers." },
      { name: "org", label: "Client / Organisation", type: "text", placeholder: "e.g. James Harrington / Harrington Capital", help: "Who the report is for or about." },
      { name: "highlights", label: "Key Highlights & Data", type: "textarea", placeholder: "e.g. 12 tasks completed, 4 meetings, 2 new automations deployed, board deck approved", help: "The wins, metrics, and facts to report. Include numbers where you can, the AI turns them into prose." },
    ],
  },
  {
    key: "proposal",
    title: "Proposal / Pitch",
    desc: "Write business proposals and pitches",
    howTo: "Name the prospect and what you're offering, list the value they get, and optionally a price, the AI writes a persuasive proposal.",
    example: "Org: Apex Capital · Topic: EA Retainer · Value: saves 15 hrs/week, fewer scheduling errors · Investment: £3,500–£5,000/mo.",
    fields: [
      { name: "org", label: "Recipient / Organisation", type: "text", placeholder: "e.g. Apex Capital", help: "The company or person you're pitching to." },
      { name: "topic", label: "Service / Proposal Topic", type: "text", placeholder: "e.g. Executive Assistance Retainer Package", help: "What you're proposing, the offer or package." },
      { name: "value", label: "Key Value Propositions", type: "textarea", placeholder: "e.g. Saves 15 hours per week, reduces scheduling errors, premium AI automations included", help: "The concrete benefits the client gets. Lead with outcomes and numbers." },
      { name: "investment", label: "Investment Range (optional)", type: "text", placeholder: "e.g. £3,500 – £5,000 per month", help: "Optional pricing. Leave blank to omit cost from the proposal." },
    ],
  },
  {
    key: "pressrelease",
    title: "Press Release",
    desc: "Craft professional press releases and announcements",
    howTo: "Give the announcement, the company, the date/location dateline, and the supporting details or quotes, the AI formats a publication-ready press release.",
    example: "Headline: Closes £400M Fund IV · Company: Harrington Capital · Dateline: London, 4 Nov 2025.",
    fields: [
      { name: "headline", label: "Headline / Announcement", type: "text", placeholder: "e.g. Harrington Capital Closes £400M Fund IV", help: "The news in one line, this becomes the headline." },
      { name: "company", label: "Company / Organisation", type: "text", placeholder: "e.g. Harrington Capital", help: "The organisation making the announcement." },
      { name: "datelocation", label: "Date & Location", type: "text", placeholder: "e.g. London, 4 November 2025", help: "The dateline, where and when the release is issued." },
      { name: "details", label: "Key Details & Quotes", type: "textarea", placeholder: "e.g. Fund IV targets B2B SaaS, healthcare tech; James Harrington quote...", help: "The supporting facts and any quotes to include. Quotes make the release feel authentic." },
    ],
  },
];

export const BOOKKEEPING_TYPES: StudioFormat[] = [
  {
    key: "expense",
    title: "Expense Report",
    desc: "Generate formatted expense reports from raw data",
    howTo: "Pick the client and period, paste your expenses as a comma-separated list, and give the approved budget, the AI totals them and formats a clean report with a budget comparison.",
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
    howTo: "Enter who to bill, the services delivered, the total, and the due date, the AI lays it out as a professional invoice ready to send.",
    example: "Bill to: Harrington Capital Ltd · Services: EA retainer, travel coordination · Total: £4,500 · Due: 30 Nov 2025.",
    fields: [
      { name: "billto", label: "Bill To", type: "text", placeholder: "e.g. Harrington Capital Ltd", help: "The client or company being invoiced. Appears in the bill-to block." },
      { name: "services", label: "Services Rendered", type: "textarea", placeholder: "e.g. Monthly EA retainer October 2025, Travel coordination, Board deck preparation", help: "The work delivered, as line items. Each becomes a row on the invoice." },
      { name: "total", label: "Total Amount", type: "text", placeholder: "e.g. £4,500", help: "The amount due, including currency." },
      { name: "due", label: "Payment Due Date", type: "text", placeholder: "e.g. 30 November 2025", help: "When payment is expected." },
    ],
  },
  {
    key: "budget",
    title: "Budget Summary",
    desc: "Summarise and analyse budget allocations",
    howTo: "Name the client and period, list each budget category with its limit, and add any notes, the AI produces a summarised, analysed budget overview.",
    example: "Dept: Harrington Exec Office · Period: Q4 2025 · Categories: Travel £20,000, Entertainment £8,000.",
    fields: [
      { name: "dept", label: "Client / Department", type: "text", placeholder: "e.g. Harrington Capital Executive Office", help: "Whose budget this is, the client, team, or department." },
      { name: "period", label: "Period", type: "text", placeholder: "e.g. Q4 2025", help: "The timeframe the budget covers." },
      { name: "categories", label: "Budget Categories & Limits", type: "textarea", placeholder: "e.g. Travel: £20,000, Entertainment: £8,000, Professional Services: £15,000", help: "Each spending category with its allocated limit. The AI tallies and analyses them." },
      { name: "notes", label: "Additional Notes", type: "text", placeholder: "e.g. 10% contingency approved by CFO", help: "Any extra context, such as contingencies or approvals." },
    ],
  },
  {
    key: "financial",
    title: "Financial Brief",
    desc: "Create concise financial overview documents",
    howTo: "Name the company and period, paste the key metrics, and say what the brief is for, the AI writes a concise financial overview tailored to that purpose.",
    example: "Company: NovaMed Health · Period: Q3 2025 · Metrics: ARR £8.2M, 140% YoY, runway 14 mo · Purpose: investor brief.",
    fields: [
      { name: "company", label: "Company / Portfolio Co.", type: "text", placeholder: "e.g. NovaMed Health", help: "The business the brief covers." },
      { name: "period", label: "Period", type: "text", placeholder: "e.g. Q3 2025", help: "The reporting window for the figures." },
      { name: "metrics", label: "Key Financial Metrics", type: "textarea", placeholder: "e.g. ARR: £8.2M, Growth: 140% YoY, Burn: £420K/month, Runway: 14 months", help: "The numbers to feature. Revenue, growth, burn, runway, etc. The AI explains and contextualises them." },
      { name: "context", label: "Context / Purpose", type: "text", placeholder: "e.g. Pre-meeting brief for James, investor due diligence", help: "Why the brief is needed and who reads it, so the AI frames it appropriately." },
    ],
  },
];

export const AUTOMATION_TRIGGERS = ["New Email Received", "Daily at 8:00 AM", "Before Every Meeting", "New Task Created", "Every Monday Morning", "When Priority Changes", "End of Business Day"];
export const AUTOMATION_ACTIONS = ["Draft & Send Summary", "Send Slack Notification", "Update Task List", "Create Calendar Block", "Generate Report", "Flag for Review", "Archive & Log"];
