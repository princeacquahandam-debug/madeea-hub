# MadeEA EA Hub — Full Site Extraction

> **Source:** https://made-ea-hub--rowenapetran.replit.app/
> **Captured:** 2026-05-30
> **Purpose:** Complete content + structure reference for rebuilding this as a *functional* application.
> **Page title:** `MadeEA EA Hub`

---

## 1. What this is

A single-page **"Command Center" dashboard for an Elite Executive Assistant (EA)**, branded **MadeEA**. The demo persona is **Sarah Mitchell, Elite EA**, managing three executive clients. It is positioned as an AI-augmented EA operations suite ("powered by Claude").

### Current state (important for the rebuild)
- It is a **static front-end prototype only.** On load, **no backend/API calls fire** — all data is hardcoded mock data.
- **Tech stack detected:** React SPA, built with **Vite** (bundle `assets/index-C_FXwoUj.js`), using **Radix UI primitives** (shadcn/ui style components — Dialog, Select, etc.). Tailwind-style utility design.
- Navigation is **client-side view switching** (no URL routing / no route changes — URL stays `/` for every view).
- Console shows only accessibility warnings (`DialogContent` requires a `DialogTitle`) — confirms Radix Dialog usage.
- **"Generate with Claude" / "AI Draft Response" / "Run Now" buttons are non-functional placeholders** — they need real Claude API wiring in the rebuild.

---

## 2. Global Layout

Three-column app shell, persistent across all views:

```
┌──────────────┬─────────────────────────────────────┬──────────────────┐
│  LEFT SIDEBAR │           MAIN CONTENT (view)        │  RIGHT SIDEBAR    │
│  (nav)        │  (top bar + active view)             │  (Quick AI)       │
└──────────────┴─────────────────────────────────────┴──────────────────┘
                                          + floating AI Assistant button (bottom-right)
```

### 2.1 Left Sidebar (persistent)
- **Brand:** `MadeEA` (h1) / subtitle `Command Center`
- **User card (bottom):** avatar `SM` · `Sarah Mitchell` · `Elite EA`
- **Nav section label:** `Operations`
  - Dashboard *(testid: `nav-dashboard`)*
  - Task Manager *(`nav-tasks`)*
  - Communication Center *(`nav-communication`)*
  - AI Quick Actions *(`nav-ai-actions`)*
  - Client Vault *(`nav-client-vault`)*
  - Automation *(`nav-automation`)*
- **Nav section label:** `AI Suite`
  - Communication Studio — tagged **Claude** *(`nav-communication-studio`)*
  - Bookkeeping AI — tagged **Claude** *(`nav-bookkeeping`)*

### 2.2 Top Bar (persistent)
- Date label: `Saturday, May 30`
- Search input placeholder: `Search clients, tasks, emails...`
- One icon button (right of search — bell/notifications)

### 2.3 Right Sidebar — "Quick AI Actions" (persistent)
- Heading: `Quick AI Actions` / subtitle `Contextual shortcuts`
- Six action buttons, each labeled with subtitle `Run AI instantly`:
  1. Draft Email Response
  2. Generate Meeting Brief
  3. Create Expense Report
  4. Run Inbox Triage
  5. Client Research Brief
  6. Draft Invoice
- **Status card (bottom):** `Claude AI Online` — *"Communication Studio and Bookkeeping AI are powered by Claude. Chat assistant available 24/7."*

### 2.4 Floating AI Assistant (persistent, bottom-right) *(`button-open-assistant`)*
Opens a chat panel — see §11.

---

## 3. View: Dashboard

**Heading:** `Good afternoon, Sarah.` / subtitle `Here's your command center.`

### 3.1 Stat cards (4)
| Label | Value |
|---|---|
| Tasks Active | 12 |
| Meetings Today | 4 |
| Emails Pending | 23 |
| Automations Running | 3 |

### 3.2 Today's Priority Queue *(link: "View all")*
| Task | Client / Due | Status badge |
|---|---|---|
| Prepare board deck for James | James Harrington · Today, 3pm | Urgent |
| Research NovaMed competitors | Priya Nair · Today, EOD | In Progress |
| Book SF travel for David | David Osei · Tomorrow | Pending |
| Draft investor update email | James Harrington · Friday | Pending |
| Reschedule Monday call with James | James Harrington · Completed | Done |

### 3.3 Upcoming Meetings *(link: "Calendar")*
| Time | Meeting | With | Status |
|---|---|---|---|
| 9:00 AM | Board Prep Call | James Harrington | Prepared |
| 11:30 AM | Product Review | Priya Nair | Needs Prep |
| 2:00 PM | Travel Brief | David Osei | Prepared |
| 4:30 PM | Team Sync | Internal | Pending |

### 3.4 Client Snapshot
| Name | Role | Note |
|---|---|---|
| James Harrington | CEO, Harrington Capital | Board deck preparation |
| Priya Nair | Founder, NovaMed Health | Competitor research in progress |
| David Osei | Managing Director, Osei Global | SF travel booking |

---

## 4. View: Task Manager

**Heading:** `Task Manager` / subtitle `Manage and track all client tasks`
**Primary action:** `Add Task` button
**Layout:** Kanban-style 3 columns. Each task card has a checkbox, title, client·due line, a priority chip, and quick status-change buttons.

### Column: To Do (4)
| Task | Client · Due | Priority | Quick actions |
|---|---|---|---|
| Book SF flights for David | David Osei · Tomorrow | Normal | → In Progress / Done |
| Draft investor update email | James Harrington · Friday | High | → In Progress / Done |
| Prepare Q3 expense report | James Harrington · Next week | Normal | → In Progress / Done |
| Write NovaMed briefing doc | Priya Nair · Thursday | High | → In Progress / Done |

### Column: In Progress (2)
| Task | Client · Due | Priority | Quick actions |
|---|---|---|---|
| Prepare board deck slides | James Harrington · Today, 3pm | Urgent | → To Do / Done |
| Research NovaMed competitors | Priya Nair · Today, EOD | High | → To Do / Done |

### Column: Done (2)
| Task | Client · Due | Priority | Quick actions |
|---|---|---|---|
| Reschedule Monday call | James Harrington · Completed | Low | → To Do / In Progress |
| Send travel itinerary | David Osei · Completed | Normal | → To Do / In Progress |

**Priority levels observed:** Urgent, High, Normal, Low.
**Status values:** To Do, In Progress, Done.

---

## 5. View: Communication Center

**Heading:** `Communication Center` / subtitle `Triage, draft, and manage executive communications`
**Filter tabs:** All · Urgent · Awaiting Reply · Delegated
**Layout:** Two-pane — message list (left) + reading/draft pane (right).

### 5.1 Message list — `6 messages`
| Sender | Time | Subject | Preview | Action tag |
|---|---|---|---|---|
| James Harrington (JH) | 8:42 AM | Board Meeting Agenda Request | "Could you please send over the agenda for Thursday's board meeting by tomorrow morning?" | Urgent |
| Priya Nair (PN) | 9:15 AM | Postponing Thursday meeting | "I need to reschedule our Thursday check-in. Can we move it to next Monday instead?" | Reply |
| CFO Office (CO) | 10:03 AM | Q3 Expense Report Due | "Reminder: Q3 expense reports are due by end of month. Please ensure all receipts are submitted." | Delegate |
| Travel Agent (TA) | 11:20 AM | SF Flight Options — David Osei | "Here are three flight options for Mr. Osei's San Francisco trip. Please confirm preference." | Reply |
| Newsletter Service (NS) | 12:00 PM | Weekly industry digest — Issue #142 | "This week in executive leadership: AI adoption trends, market analysis, and more." | Archive |
| HR Team (HT) | 1:30 PM | Team offsite planning — Q4 | "We're planning the Q4 team offsite and need input on preferred dates and venues." | Delegate |

**Action tag values:** Urgent, Reply, Delegate, Archive.

### 5.2 Reading / Draft pane (default selection = James Harrington)
- Header: `JH · James Harrington · CEO, Harrington Capital` · badge `Urgent`
- **Original Message** block: "Board Meeting Agenda Request — Could you please send over the agenda for Thursday's board meeting by tomorrow morning?"
- **AI Draft Response** block with a `AI Draft Response` button.
  - Empty state: *"Click 'AI Draft Response' to generate a professional reply"* → **needs Claude wiring.**

---

## 6. View: AI Quick Actions

**Heading:** `AI Quick Actions` / subtitle `Instant AI-powered outputs for executive operations`
Grouped into 5 categories of action buttons:

### Drafting & Writing
- Draft Executive Email
- Write Meeting Agenda
- Compose Follow-Up
- Summarize Document

### Scheduling & Calendar
- Suggest Meeting Slots
- Optimize Daily Schedule
- Draft Calendar Block
- Rescheduling Email

### Research
- Quick Company Brief
- Competitor Snapshot
- Executive Briefing Doc
- LinkedIn Research

### Reporting
- Weekly Summary Report
- KPI Snapshot
- Expense Summary
- Project Status Update

### Basic Automations
- Inbox Triage Automation
- Meeting Prep Automation
- Priority Alignment Automation
- Social Post Scheduler
- Newsletter Draft
- Weekly Digest

*(All are buttons that should trigger an AI generation flow in the rebuild.)*

---

## 7. View: Client Vault

**Heading:** `Client Vault` / subtitle `Complete profiles and preferences for every client`
**Layout:** Grid of 3 client cards; each has a `View Full Profile` button opening a modal dialog *(testids `button-view-profile-1/2/3`)*.

### Card summary
| Avatar | Name | Title | Company | Prefers | Tone | Tags |
|---|---|---|---|---|---|---|
| JH | James Harrington | CEO | Harrington Capital | Email | Formal | Board Prep, Investor Relations, Travel |
| PN | Priya Nair | Founder & CEO | NovaMed Health | Slack | Direct, collaborative | Product Roadmap, Media, Fundraising |
| DO | David Osei | Managing Director | Osei Global Ventures | WhatsApp | Concise, informal | Travel, Deal Flow, Events |

### 7.1 Full Profile — James Harrington
- **Header:** James Harrington · CEO, Harrington Capital · `Email · Formal tone`
- **Biography:** "James Harrington is the founding CEO of Harrington Capital, a $2.4B growth equity firm focused on B2B SaaS and healthcare technology. A Harvard Business School alumnus with 22 years in private equity, James sits on 6 portfolio company boards and is an active speaker at industry conferences. He values precision, punctuality, and brevity in all communications."
- **Active Tasks:** Prepare Q4 board deck (Urgent) · Review NovaMed investment memo (In Progress) · Draft investor letter (Pending)
- **Preferences & Notes:** "Prefers to receive the morning briefing before 8 AM. Never call without pre-scheduling. Always copy the CFO on financial communications. Allergic to vague language — be specific with numbers and dates."
- **Upcoming Schedule:** Mon 10:15 AM — Investor call, Apex Capital · Thu 9:00 AM — Q4 Board Review Meeting · Fri 4:30 PM — EOW debrief with Sarah

### 7.2 Full Profile — Priya Nair
- **Header:** Priya Nair · Founder & CEO, NovaMed Health · `Slack · Direct, collaborative tone`
- **Biography:** "Priya Nair is the founder of NovaMed Health, a fast-growing digital health platform serving enterprise clients across North America. A former McKinsey healthcare consultant and Stanford Medicine alumna, Priya leads a 62-person team and is currently closing a $22M Series B round. She's highly responsive but time-poor — concise, actionable communication is essential."
- **Active Tasks:** Competitor research — digital health (In Progress) · Series B investor deck review (Pending) · Media brief for Forbes interview (Pending)
- **Preferences & Notes:** "Prefers Slack for day-to-day; email for formal/external. Responds quickly but expects the same. Always lead with the ask or key point — no preamble. Available for calls Tue/Thu 9–11 AM only. Vegetarian (note for meeting catering)."
- **Upcoming Schedule:** Wed 11:30 AM — Product Review, NovaMed · Thu 2:00 PM — Investor call (Series B) · Fri 9:00 AM — Forbes interview prep

### 7.3 Full Profile — David Osei
- **Header:** David Osei · Managing Director, Osei Global Ventures · `WhatsApp · Concise, informal tone`
- **Biography:** "David Osei is the Managing Director of Osei Global Ventures, a pan-African private equity firm with $800M under management. Based between London and Accra, David travels extensively and manages a complex multi-timezone schedule. A Cambridge economics graduate and former Bain consultant, he values efficiency above all. Most comfortable communicating via WhatsApp for speed."
- **Active Tasks:** Book SF travel (flights + hotel) (In Progress) · Prepare AGOA conference materials (Pending) · Coordinate Accra LP meetings (Pending)
- **Preferences & Notes:** "Primary contact: WhatsApp (+44 7700 900 142). Email for contracts and formal docs only. Always book business class — no exceptions. Hotel preference: Rosewood, Four Seasons, or St. Regis. Time zones: GMT/WAT primarily. Keep messages under 3 sentences where possible."
- **Upcoming Schedule:** Tue 2:00 PM — Travel Brief, SF Trip · Thu 10:00 AM — AGOA Conference prep call · Next Mon — Departs for San Francisco

---

## 8. View: Automation

**Heading:** `Automation Dashboard` / subtitle `MadeEA's core automation suite — built for elite executive operations`

### 8.1 MadeEA Core Automations (3 cards)
Each card: icon, title, description, toggle, status pill, "Last run" line, total-runs count, and a `Run Now` button.

| Automation | Description | Status | Last run | Total runs |
|---|---|---|---|---|
| **Executive Priority Alignment Automation™** | "Every morning at 7:30 AM, analyses your calendar, emails, and task list to generate a prioritised daily briefing for your executive. Flags conflicts, urgent items, and suggested schedule optimisations." | Active | 2 hours ago | 247 |
| **Meeting Preparation Automation™** | "Triggered 24 hours before every scheduled meeting. Automatically compiles attendee profiles, agenda drafts, relevant documents, and sends pre-meeting reminders to all participants." | Active | This morning | 183 |
| **Executive Summary Inbox Automation™** | "Runs every 2 hours during business hours to triage new emails, auto-archive newsletters, delegate routine requests, and surface only the communications requiring direct executive attention." | Paused | 4 hours ago | 312 |

**Status values:** Active, Paused. Each has an enable/disable toggle.

### 8.2 Custom Automation Builder
Form with three fields + a (disabled until valid) `Save Automation` button:

- **Trigger** (select): New Email Received *(default)* · Daily at 8:00 AM · Before Every Meeting · New Task Created · Every Monday Morning · When Priority Changes · End of Business Day
- **Action** (select): Draft & Send Summary *(default)* · Send Slack Notification · Update Task List · Create Calendar Block · Generate Report · Flag for Review · Archive & Log
- **Automation Name** (text): placeholder `e.g. Daily Briefing Digest`

---

## 9. View: Communication Studio (AI Suite — Claude)

**Heading:** `Communication Studio` / subtitle `AI-powered writing for every executive communication need — powered by Claude`
**Badge:** `Claude AI Connected`
**Layout:** Format selector (left) + dynamic form + output pane (right).

### 9.1 Select Format (5 options)
| Format | Description |
|---|---|
| Executive Email *(default)* | Draft polished professional emails in any tone |
| Technical Writing | Process documents, SOPs, briefs and technical content |
| Report Writing | Generate structured reports with executive summaries |
| Proposal / Pitch | Write business proposals and pitches |
| Press Release | Craft professional press releases and announcements |

Each format swaps the form fields. Shared elements: a `Generate with Claude` button and an output pane ("Output will appear here" / *"Fill in the fields above and click Generate to create your {format}"*) → **needs Claude wiring.** Format buttons have testids `button-tool-{email|technical|report|proposal|pressrelease}`.

### 9.2 Executive Email form (default)
- **Recipient** (text): `e.g. James Harrington`
- **Subject / Purpose** (text): `e.g. Follow up on board meeting agenda`
- **Tone** (select): Select Tone... · Formal · Collaborative · Assertive · Concise · Warm
- **Key Points to Cover** (textarea): `e.g. Confirm agenda items, request deck by Friday, mention CFO attendance`

### 9.3 Technical Writing form
- **Document Type** (select): Select Document Type... · Standard Operating Procedure · Technical Brief · White Paper · Requirements Document · Implementation Guide
- **Topic / Subject** (text): `e.g. Onboarding new executive assistant clients`
- **Audience** (text): `e.g. Senior EAs, Management team`
- **Key Information / Context** (textarea): `e.g. Three-step onboarding: discovery call, system setup, 30-day check-in`

### 9.4 Report Writing form
- **Report Type** (select): Select Report Type... · Executive Summary · Weekly Status Report · Project Report · Board Report · Performance Review
- **Period / Timeframe** (text): `e.g. Q3 2025, Week of Nov 4`
- **Client / Organisation** (text): `e.g. James Harrington / Harrington Capital`
- **Key Highlights & Data** (textarea): `e.g. 12 tasks completed, 4 meetings, 2 new automations deployed, board deck approved`

### 9.5 Proposal / Pitch form
- **Recipient / Organisation** (text): `e.g. Apex Capital`
- **Service / Proposal Topic** (text): `e.g. Executive Assistance Retainer Package`
- **Key Value Propositions** (textarea): `e.g. Saves 15 hours per week, reduces scheduling errors, premium AI automations included`
- **Investment Range (optional)** (text): `e.g. £3,500 – £5,000 per month`

### 9.6 Press Release form
- **Headline / Announcement** (text): `e.g. Harrington Capital Closes £400M Fund IV`
- **Company / Organisation** (text): `e.g. Harrington Capital`
- **Date & Location** (text): `e.g. London, 4 November 2025`
- **Key Details & Quotes** (textarea): `e.g. Fund IV targets B2B SaaS, healthcare tech; James Harrington quote: "This represents our most ambitious fund to date"`

---

## 10. View: Bookkeeping AI (AI Suite — Claude)

**Heading:** `Bookkeeping AI` / subtitle `AI-powered financial documents — expense reports, invoices, budgets and financial briefs`
**Badge:** `Claude AI Connected`
**Layout:** Document-type selector (left) + dynamic form + output pane (right).

### 10.1 Document Type (4 options)
| Type | Description |
|---|---|
| Expense Report *(default)* | Generate formatted expense reports from raw data |
| Invoice Generator | Create professional invoices for client billing |
| Budget Summary | Summarise and analyse budget allocations |
| Financial Brief | Create concise financial overview documents |

Each type swaps the form fields. Shared elements: a `Generate with Claude` button and an output pane ("Output" / *"Fill in the fields and generate your {type}"*) → **needs Claude wiring.** Type buttons have testids `button-bk-tool-{invoice|budget-summary|financial-summary}` (Expense Report is default).

### 10.2 Expense Report form (default)
- **Client / Account** (select): Select Client / Account... · James Harrington · Priya Nair · David Osei · Internal
- **Period** (text): `e.g. October 2025, Q3 2025`
- **Expenses (comma separated)** (textarea): `e.g. Business class flights £4,200, Hotel SF £1,800, Client dinner £340, Ground transport £120`
- **Approved Budget** (text): `e.g. £8,000`

### 10.3 Invoice Generator form
- **Bill To** (text): `e.g. Harrington Capital Ltd`
- **Services Rendered** (textarea): `e.g. Monthly EA retainer October 2025, Travel coordination, Board deck preparation`
- **Total Amount** (text): `e.g. £4,500`
- **Payment Due Date** (text): `e.g. 30 November 2025`

### 10.4 Budget Summary form
- **Client / Department** (text): `e.g. Harrington Capital Executive Office`
- **Period** (text): `e.g. Q4 2025`
- **Budget Categories & Limits** (textarea): `e.g. Travel: £20,000, Entertainment: £8,000, Professional Services: £15,000, Operations: £5,000`
- **Additional Notes** (text): `e.g. 10% contingency approved by CFO`

### 10.5 Financial Brief form
- **Company / Portfolio Co.** (text): `e.g. NovaMed Health`
- **Period** (text): `e.g. Q3 2025`
- **Key Financial Metrics** (textarea): `e.g. ARR: £8.2M, Growth: 140% YoY, Burn: £420K/month, Runway: 14 months`
- **Context / Purpose** (text): `e.g. Pre-meeting brief for James, investor due diligence`

> Note: currency uses **£ (GBP)** throughout placeholders — consistent with UK/London-based personas.

---

## 11. Floating AI Assistant (chat widget)

Opens from the bottom-right floating button.
- **Header:** `MadeEA AI Assistant` · `Powered by Claude · Online`
- **Greeting message:** "Hello Sarah. I'm your MadeEA AI Assistant — powered by Claude. I can help you draft communications, summarise client info, manage tasks, and much more. What can I help with today?"
- **Suggested prompt chips:**
  - "Draft a follow-up email to James about the board deck"
  - "What are Sarah's tasks for today?"
  - "Summarise NovaMed's key details"
- **Input:** placeholder `Ask anything...` + send button (disabled until text)
- **Footer:** `Claude AI · MadeEA Private`

---

## 12. Design System Notes

- **Persona / brand voice:** premium, executive, "elite EA" tone. British spellings in automations ("analyses", "prioritised", "summarise").
- **Avatars:** two-letter initials in colored circles (SM, JH, PN, DO, CO, TA, NS, HT).
- **Status/priority chips** are color-coded badges throughout (Urgent, High, Normal, Low / Active, Paused / To Do, In Progress, Done).
- **Iconography:** lucide-style icons (each nav item, action, and stat card has one).
- **Components:** Radix UI / shadcn (Dialog, Select, Tabs/filter pills, Textarea, Button variants).
- **Accessibility gap to fix in rebuild:** Dialogs lack `DialogTitle` (console error) — add titles or VisuallyHidden wrappers.

---

## 13. Rebuild Checklist ("make it functional")

Everything below is currently mock/static and must be wired up:

1. **State & data layer** — replace hardcoded arrays with a real data store (DB + API). Entities: Clients, Tasks, Messages/Communications, Meetings, Automations, AI generation history.
2. **Routing** — give each view a real route (currently all `/`).
3. **Task Manager** — make Add Task, status toggles, and drag/move between columns persist.
4. **Communication Center** — wire `AI Draft Response`, filter tabs (All/Urgent/Awaiting Reply/Delegated), and message selection. Integrate a real mailbox source if desired.
5. **AI Quick Actions** (right rail + main grid) — each button should call the Claude API with a templated prompt and stream output.
6. **Client Vault** — CRUD for client profiles; fix dialog accessibility.
7. **Automation** — real scheduling/trigger engine for the 3 core automations (toggle, Run Now, run history/counts) + persist Custom Automation Builder entries.
8. **Communication Studio** — wire all 5 formats to Claude with the per-format forms; render + allow copy/export of output.
9. **Bookkeeping AI** — wire all 4 document types to Claude; format currency; allow export (PDF) of invoices/expense reports.
10. **AI Assistant chat** — real conversational endpoint (Claude) with context about Sarah's clients/tasks; make suggested chips functional.
11. **Top bar** — implement global search across clients/tasks/emails; notifications.
12. **Auth / multi-user** — currently single hardcoded user (Sarah Mitchell).

---

### Appendix: Detected testid hooks (useful when rebuilding/migrating)
- **Nav:** `nav-dashboard`, `nav-tasks`, `nav-communication`, `nav-ai-actions`, `nav-client-vault`, `nav-automation`, `nav-communication-studio`, `nav-bookkeeping`
- **Client Vault:** `button-view-profile-1/2/3`
- **Assistant:** `button-open-assistant`
- **Communication Studio formats:** `button-tool-email`, `button-tool-technical`, `button-tool-report`, `button-tool-proposal`, `button-tool-pressrelease`
- **Bookkeeping AI types:** Expense Report (default), `button-bk-tool-invoice`, `button-bk-tool-budget-summary`, `button-bk-tool-financial-summary`
