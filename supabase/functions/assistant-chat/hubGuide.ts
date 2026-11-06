// How to use the Hub itself, for Madeline's hub_guide tool (19 Oct 2026 team
// meeting: "where does my EOD go?", "how do I pause?"). Written from the app as
// it is (lib/constants NAV, the pages and the header), not from lib/guides.ts,
// which predates the current menus. Keep it in step when a page moves.
//
// Sidebar groups: Today, Work, Time & Reports, Clients & Files (managers and
// up), Learn, Settings. Personal settings live under the initials, top right.

export interface HubGuideEntry {
  topic: string;
  keywords: string[];
  how: string;
}

export const HUB_GUIDE: HubGuideEntry[] = [
  {
    topic: "Finding your way around",
    keywords: ["menu", "sidebar", "navigation", "where", "find", "page", "tabs", "layout"],
    how:
      "The sidebar has six groups: Today (Dashboard, My workspace, Calendar), Work (Inbox, Tasks), Time & Reports (Time tracker, EOD reports), Clients & Files (managers and up only), Learn (SOP, Training videos) and Settings (Integrations, plus Admin Panel for admins). " +
      "Some pages have tabs along the top, for example Tasks → Routines and Time tracker → Screenshots. " +
      "Your own settings are under your initials, top right → Profile & settings.",
  },
  {
    topic: "Dashboard",
    keywords: ["dashboard", "home", "overview", "today", "priorities", "follow-up", "snapshot", "kpi"],
    how:
      "Today → Dashboard shows your day at a glance: your active tasks, meetings today, emails to answer, things that need a follow-up and automations running (managers also see clients at risk). " +
      "Below are the Needs follow-up, Priorities, Upcoming meetings and Client snapshot panels. Click a card to open the full list.",
  },
  {
    topic: "My workspace",
    keywords: ["workspace", "my workspace", "profile", "memory", "knowledge", "team member", "member"],
    how:
      "Today → My workspace shows your open tasks, overdue tasks, what you finished this week, whether today's EOD is sent, Madeline's memory and your knowledge base. " +
      "Your memory and personal files are private to you. Managers and up can pick any team member at the top to see their work and reports, but never their memory or personal files.",
  },
  {
    topic: "Madeline's memory",
    keywords: ["memory", "remember", "forget", "preferences", "madeline remembers", "pin"],
    how:
      "Today → My workspace → Madeline's memory: type a fact (for example a client's preferred call times) and add it, or just tell Madeline \"remember that…\" in chat. " +
      "You can pin an item to the top or forget it. Madeline checks this before drafting for you, and nobody else can see it.",
  },
  {
    topic: "Calendar and planning a day",
    keywords: ["calendar", "event", "meeting", "schedule", "plan", "plan this day", "book", "google calendar"],
    how:
      "Today → Calendar shows your Google Calendar once Google is connected in Settings → Integrations. Use New event to add one. " +
      "Plan this day hands that day's commitments to Madeline, who proposes time slots with Book buttons; nothing goes on the calendar until you press Book.",
  },
  {
    topic: "Meeting Intelligence (Fathom)",
    keywords: ["fathom", "meeting notes", "transcript", "recording", "decisions", "meeting intelligence"],
    how:
      "Today → Calendar → Meeting Intelligence tab. Press Sync from Fathom and the Hub reads your Fathom transcripts, puts action items on the task board and saves decisions and context to memory.",
  },
  {
    topic: "Inbox",
    keywords: ["inbox", "email", "mail", "messages", "reply", "unread", "compose", "summarize", "draft replies", "action items"],
    how:
      "Work → Inbox holds mail and chats from every channel you've connected, with tabs All, Needs reply, Waiting on others and Done, plus a search box and New message. " +
      "The AI buttons beside the title are Summarize unread, Draft replies and Find action items. The sidebar shows how many conversations are unread.",
  },
  {
    topic: "Switching between email accounts",
    keywords: ["switch", "account", "accounts", "mailbox", "multiple", "address", "all accounts"],
    how:
      "In Work → Inbox, use the account switcher next to New message. It lists every mailbox you can read by address: your Gmail, your Outlook, and any client mailbox shared with you. " +
      "Pick one to narrow the Inbox to it; All accounts shows everything together.",
  },
  {
    topic: "Connecting Gmail, Outlook or a second email",
    keywords: ["gmail", "google", "outlook", "microsoft", "connect", "second", "another", "email", "integrations", "mismatch"],
    how:
      "Settings → Integrations, then Connect on the Gmail or Outlook card and sign in. The Google account must be the same email you sign in to MadeEA with, and one Google sign-in connects both Gmail and Google Calendar. " +
      "For a second address, connect it as Outlook (any Microsoft account works, it doesn't have to match your login). " +
      "A client's own mailbox only appears if the client turns on mail sharing in their portal, and only their lead EA can see it.",
  },
  {
    topic: "Slack, Teams, WhatsApp and other channels",
    keywords: ["slack", "teams", "discord", "instagram", "whatsapp", "meta", "linkedin", "channel", "connect", "disconnect", "sync"],
    how:
      "Settings → Integrations → Message channels: press Connect on a card and sign in to that service. Teams uses the same Microsoft sign-in as Outlook, and Instagram and WhatsApp share one Meta login. " +
      "Disconnecting one sign-in stops everything it covers (for example, disconnecting Google stops Gmail and your calendar).",
  },
  {
    topic: "Tasks board",
    keywords: ["task", "tasks", "board", "new task", "column", "status", "assign", "due", "priority", "deleted", "repeat", "waiting"],
    how:
      "Work → Tasks has the columns To do, In progress, Waiting, Review and Done; drag a card to move it. Use New task to add one, and filter by assignee, client or search. " +
      "Hover a card to complete, edit or delete it. Recently deleted keeps deleted tasks for 30 days. In the task form you can set priority, due date, client, assignee, Repeat (daily, weekly, monthly) and Waiting on task.",
  },
  {
    topic: "AI buttons on Tasks",
    keywords: ["prioritize", "prioritise", "break down", "breakdown", "stuck", "find stuck", "ai", "order", "steps"],
    how:
      "On Work → Tasks, at the top: Prioritize board ranks your open tasks, marks where to start, and suggests up to 5 changes in a panel you can apply or discard (Undo after). " +
      "Break down a task asks you to pick a card, then writes 3 to 7 steps on it; Keep all adds them to the checklist (it may ask one question first). " +
      "Find stuck tasks lists up to 5 tasks that are overdue, blocked, untouched for 7+ days or waiting 3+ days for approval, with the next action for each, and outlines them on the board.",
  },
  {
    topic: "AI buttons (✦ quick actions) on every page",
    keywords: ["ai", "quick action", "sparkle", "plan my day", "catch me up", "follow-up", "summarize", "summarise", "draft replies", "action items", "missing hours", "shift note", "draft my report", "polish", "team", "weekly report"],
    how:
      "Up to three ✦ buttons sit next to each page title. Today → Dashboard: Plan my day, Catch me up, Draft follow-ups. " +
      "Work → Inbox: Summarize unread, Draft replies, Find action items. Work → Tasks: Prioritize board, Break down a task, Find stuck tasks. " +
      "Time & Reports → Time tracker: Summarize my week, Check missing hours, Write shift note. Time & Reports → EOD reports: Draft my report and Polish wording; " +
      "admins also get Summarize the team, Who needs attention? and Client weekly report on the team view. " +
      "A summary shows as a card at the top of the page; drafts and changes open in a side panel with a checkbox each and change nothing until you press Apply, Send or Create; " +
      "form helpers write into the form in light orange so you can edit before you submit. Click outside a result to close it. Each person has a daily AI allowance that resets every day.",
  },
  {
    topic: "Routines (repetitive tasks)",
    keywords: ["routine", "routines", "recurring", "repeat", "repetitive", "daily", "weekly", "monthly", "automatic"],
    how:
      "Work → Tasks → Routines tab (Beta) → New repetitive task. Set the schedule (for example every Monday, or a day of the month), who it's for and whether to create it in advance. " +
      "The task is then created for you automatically every time it's due. For a one-off task that repeats simply, the task form's Repeat field also works.",
  },
  {
    topic: "Quick note (voice or typed task)",
    keywords: ["quick note", "voice", "speak", "dictate", "microphone", "capture", "note"],
    how:
      "Press Quick note in the header on any page. Speak (or type if your browser can't listen) and the Hub turns it into a task with a title, due date, client and priority. " +
      "Check the details, then confirm to save it to your board.",
  },
  {
    topic: "Search and Ctrl/⌘K",
    keywords: ["search", "find", "ctrl", "cmd", "command", "palette", "shortcut", "favourites", "favorites", "keyboard"],
    how:
      "The search box in the header searches tasks, clients and messages; press / to jump to it. " +
      "Press Ctrl K (⌘K on a Mac) on any page to jump to a page, find a record, pin favourites, or ask Madeline about what you typed.",
  },
  {
    topic: "Clocking in",
    keywords: ["clock in", "clock", "start", "timer", "time tracker", "attendance", "focus", "shift"],
    how:
      "Press Clock in in the header on any page, or go to Time & Reports → Time tracker, choose the client, add an optional note and press Clock in. " +
      "You'll be asked \"What is today for?\"; the clock starts once you fill in your focus for the day. The browser then asks to share your screen in the same click.",
  },
  {
    topic: "Pausing for a break",
    keywords: ["pause", "break", "resume", "lunch", "stop", "time tracker", "paused"],
    how:
      "Press Pause next to the timer in the header, or Time & Reports → Time tracker → Pause. The clock and screenshots stop together and paused time isn't counted. " +
      "Press Resume to carry on with the same client and note; it asks you to share your screen again. If you stop screen sharing from the browser's bar, the clock pauses itself.",
  },
  {
    topic: "Clocking out",
    keywords: ["clock out", "end", "finish", "stop", "early", "leave", "shift"],
    how:
      "Press Clock out in the header or on Time & Reports → Time tracker. Before it clocks you out it asks for your EOD (Done today, Blockers, Plan for tomorrow, Notes), already drafted from your tasks. " +
      "If you're short of your daily hours, the Time tracker asks why. If you're on a break, clock out from the Time tracker page.",
  },
  {
    topic: "Screen sharing and screenshots",
    keywords: ["screenshot", "screenshots", "screen", "sharing", "share", "monitor", "capture", "privacy", "tab"],
    how:
      "While you're clocked in and sharing your screen, a screenshot is taken every few minutes (10 by default). Share your whole screen, not a single browser tab, or only that tab is captured. " +
      "Use Pause for a break or for privacy. See them under Time & Reports → Time tracker → Screenshots tab: you see your own, managers and up see the team's. The browser always asks permission first; the Hub can't skip that.",
  },
  {
    topic: "Timesheet, hours and automatic breaks",
    keywords: ["hours", "timesheet", "payroll", "total", "break deduction", "unpaid", "daily hours", "history"],
    how:
      "Time & Reports → Time tracker shows today's total and your sessions; pick a start and end date to see a longer range. Paused sessions are marked Paused. " +
      "If an admin has set an automatic unpaid break for long days (Settings → Admin Panel), it's taken off those days, and breaks you took with Pause count toward it.",
  },
  {
    topic: "EOD reports (where your EOD goes)",
    keywords: ["eod", "end of day", "report", "daily report", "submit", "where", "missed", "yesterday", "blockers"],
    how:
      "Time & Reports → EOD reports → My report: it's drafted from your tasks (Done today, Blockers, Plan for tomorrow); edit it and press Submit report. Submitting again updates it, and Today, Yesterday or the date picker lets you catch up on a missed day. You're also asked for it when you clock out. " +
      "Submitted reports are saved in the Hub, where managers and admins see them on the Team tab and in your workspace. Clients don't see your EOD; their portal builds its own daily report from their account's tasks and hours.",
  },
  {
    topic: "EOD Team tab (managers)",
    keywords: ["team tab", "team reports", "eod analytics", "submissions", "who submitted", "manager"],
    how:
      "Managers and admins only: Time & Reports → EOD reports → Team tab shows everyone's reports and submission analytics by month, with a filter per team member.",
  },
  {
    topic: "Client Vault (managers and up)",
    keywords: ["client", "clients", "client vault", "profile", "new client", "invite", "portal login", "lead ea", "scoreboard", "delegated"],
    how:
      "Managers and up: Clients & Files → Client Vault → New Client. Each client record holds their profile, tone, preferred channel, preferences, time zone, lead EA, response times, active tasks and what they've delegated. " +
      "Use Invite client login on a client's card to give them access to their portal. The Client Scoreboard tab shows how the work went per EA and per client.",
  },
  {
    topic: "Time zones (yours and your client's)",
    keywords: ["time zone", "timezone", "zone", "local time", "client time", "travel", "dubai"],
    how:
      "Your initials, top right → Profile & settings → Time zone → Show times in; by default the Hub uses your computer's zone, and the calendar and everything else follow it. " +
      "A client's zone is set on their record in Client Vault; their local time then shows on their card and on the Time tracker when you pick that client.",
  },
  {
    topic: "Password Manager (managers and up)",
    keywords: ["password", "passwords", "login", "logins", "credentials", "vault", "passphrase", "unlock"],
    how:
      "Managers and up: Clients & Files → Password Manager. One passphrase unlocks the vault; logins are encrypted in your browser and the passphrase is never sent to the server. It stays unlocked for that tab only. " +
      "Use Add a login to store one. Madeline can never see passwords.",
  },
  {
    topic: "Notes, Uploads and the knowledge base",
    keywords: ["notes", "files", "upload", "uploads", "knowledge base", "shelf", "team shelf", "personal", "document", "saved", "bookmark"],
    how:
      "Managers and up: Clients & Files → Notes & Files is the team's shared scratchpad. Its Uploads tab is the knowledge base, with a Team shelf (everyone can see it; you confirm you have permission before a file goes there) and a Personal shelf only you can open. The Saved tab keeps your bookmarks. " +
      "Everyone sees their personal shelf in Today → My workspace, and Madeline can find files on both shelves by name, though she doesn't read their contents.",
  },
  {
    topic: "SOPs",
    keywords: ["sop", "sops", "procedure", "checklist", "start sop", "pin to screen", "process"],
    how:
      "Learn → SOP lists the team's checklists. Open one, press Start SOP (pick the client if asked) and it lands on your board and in your EOD; Pin to screen keeps the checklist visible while you work. " +
      "Only admins can create or edit SOPs (New SOP), and the Video Instruction tab is admins only.",
  },
  {
    topic: "Training Center (Made Ready Academy)",
    keywords: ["training", "academy", "course", "made ready", "lesson", "quiz", "practical", "certificate", "onboarding"],
    how:
      "The Made Ready Academy is paused while it is redesigned as its own learning space, so the Training Center is hidden for now. " +
      "Training videos are still under Learn in the header → Training videos. Your manager will say when the new Academy opens.",
  },
  {
    topic: "Training videos and Loom",
    keywords: ["video", "videos", "loom", "record", "walkthrough", "tutorial", "screen recording"],
    how:
      "Learn in the header → Training videos opens the training videos; each SOP also has a Video walkthrough. Managers and up can Record a Loom or Add a Loom link there. " +
      "There's also a Loom card at the bottom of Settings → Integrations for recording your screen and camera; its Record a Loom button appears once the workspace's Loom app is set up.",
  },
  {
    topic: "Learn menu and guided tour",
    keywords: ["learn", "help", "tour", "guide", "how this page works", "tutorial"],
    how:
      "Press Learn in the header for How this page works, Replay the guided tour, Training videos and SOPs.",
  },
  {
    topic: "Settings, theme and password",
    keywords: ["settings", "theme", "dark mode", "light", "password", "change password", "sign out", "logout", "nudges", "analytics"],
    how:
      "Click your initials, top right: switch Theme (Light, Dark, System), Sign out, or open Profile & settings. " +
      "Settings has your account, Time zone, analytics consent, Password (change it), Gone-quiet nudges (how many days before an email or task is flagged), Alerts and Response-time targets.",
  },
  {
    topic: "Alerts and notifications",
    keywords: ["alert", "alerts", "notification", "notifications", "bell", "late reply", "sla", "clocked in"],
    how:
      "The bell in the header shows your notifications; Mark all read clears them. " +
      "Profile & settings → Alerts covers Late reply (to the EA and admins) and EA clocked in (to the client, once a day). Each is off until an admin chooses where it goes, and only admins can change them.",
  },
  {
    topic: "Admin Panel and roles (admins only)",
    keywords: ["admin", "admin panel", "role", "roles", "invite", "add member", "team", "reset password", "workload", "permissions", "automation"],
    how:
      "Admins only: Settings → Admin Panel to create accounts, set a new password for a member, change roles and job functions, remove members, see team workload, set the working day and automatic break, and see what each role (Owner, Admin, Manager, Employee) can do. " +
      "Settings → Integrations → Automation is admins only too. Employees don't see Clients & Files.",
  },
  {
    topic: "Using Madeline",
    keywords: ["madeline", "assistant", "ai", "chat", "ask", "history", "new chat", "create task"],
    how:
      "Press the orange button bottom-right on any page (or Ctrl K / ⌘K → Ask Madeline). Ask about your tasks, clients, meetings and mail, or tap an AI action chip. The clock icon shows chat history and New chat starts fresh. " +
      "She can read but not change anything: when she proposes a task, press Create task to save it.",
  },
  {
    topic: "Client portal and the Delegate tab",
    keywords: ["client portal", "portal", "delegate", "delegation", "coach", "hand over", "handoff", "client login", "daily reports"],
    how:
      "Clients sign in to their own portal with Overview, Tasks, Daily reports, Activity, Calendar, Notes, Delegate, Staff, People, Connected accounts and Messages. " +
      "In Delegate, the delegation coach helps the client write a plan for handing work over; handing it over creates a task for their lead EA with the handoff message attached. Managers can read the plan on the client's record in Client Vault.",
  },
];
