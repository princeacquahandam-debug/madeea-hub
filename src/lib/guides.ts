// Per-page quick guidance shown in a collapsible card at the top of each page.
export interface Guide {
  title: string;
  points: string[];
}

export const GUIDES: Record<string, Guide> = {
  "/": {
    title: "How the Dashboard works",
    points: [
      "Your command center — live counts, today's priority queue, upcoming meetings and clients.",
      "Click any task, meeting or client to jump straight to it.",
      "Numbers update automatically as your tasks, calendar and inbox change.",
    ],
  },
  "/tasks": {
    title: "How the Task Manager works",
    points: [
      "Drag a card between columns (To Do / In Progress / Done) to update its status — it saves instantly.",
      "“Add Task” to create one with a priority and a real due date.",
      "Hover a card for the ✏️ edit and 🗑️ delete controls.",
    ],
  },
  "/communication": {
    title: "How the Communication Center works",
    points: [
      "Filter with the tabs, click a message to open it, then “AI Draft Response” to generate a reply.",
      "Connect Gmail in Integrations to pull your real inbox here.",
    ],
  },
  "/quick-actions": {
    title: "How AI Quick Actions work",
    points: [
      "One-click AI generators grouped by category — click any to run it instantly.",
      "Each result can be viewed Formatted / Markdown / HTML, copied, or exported to PDF.",
    ],
  },
  "/clients": {
    title: "How the Client Vault works",
    points: [
      "Add a client with “New Client” — set their channel, tone, tags and notes.",
      "Add a photo by uploading or pasting an image URL (it falls back to initials).",
      "The AI uses each client's tone & preferences when drafting for them.",
    ],
  },
  "/sops": {
    title: "How SOPs work",
    points: [
      "Open a procedure, “Start workflow”, and tick each step — the deliverables show what “done” means.",
      "“Pin to screen” keeps the checklist floating while you work anywhere in the app.",
      "Steps tagged ✨ run the matching AI tool for you and auto-tick.",
    ],
  },
  "/automation": {
    title: "How Automations work",
    points: [
      "Toggle an automation Active/Paused; “Run Now” executes it on your live data and saves the result.",
      "Expand “View last result” to read the AI output; build your own below.",
    ],
  },
  "/integrations": {
    title: "How Integrations work",
    points: [
      "Connect Google to sync Gmail + Calendar; sync Slack to pull channel messages.",
      "OAuth runs server-side — your tokens never touch the browser.",
    ],
  },
  "/studio": {
    title: "How Communication Studio works",
    points: [
      "Pick a format, fill the fields, then “Generate with Claude”.",
      "Toggle Formatted / Markdown / HTML on the output, and export a branded PDF.",
    ],
  },
  "/admin": {
    title: "How the Admin panel works",
    points: [
      "See every account in your workspace, their role (Admin / EA), and activity at a glance.",
      "Invite teammates by email, promote/demote roles, or remove access.",
      "“Switch to user view” returns you to using the app normally — admins have both.",
      "Access is enforced server-side: only admins can make changes, and workspaces stay isolated.",
    ],
  },
  "/bookkeeping": {
    title: "How Bookkeeping AI works",
    points: [
      "Choose a document type (invoice, expense report, budget, brief), fill in the details and generate.",
      "Export the finished document to a branded PDF.",
    ],
  },
  "/email-helper": {
    title: "How the Email Helper works",
    points: [
      "Pick a message and the panel shows what the draft will know — the client's tone, the thread so far, and what you owe them.",
      "It also knows whether you're late, and adjusts the opening: no mention when you're on time, a real apology when you've breached.",
      "“What should this do?” changes the whole email — declining reads nothing like chasing.",
      "This is the Communication Center's draft with the client context added. Use that page for triage, this one to write.",
    ],
  },
  "/meeting-helper": {
    title: "How the Meeting Helper works",
    points: [
      "Before: open a prep packet for anything coming up — the same packet as on the Dashboard.",
      "After: paste your notes and action items appear, extracted in code, not by the AI.",
      "Dates come from your own wording (“by Friday”), so they can't be silently wrong. Edit anything before creating.",
      "“Create tasks” writes the ticked items into the Task Manager. The AI only writes the recap prose.",
    ],
  },
  "/focus": {
    title: "How the Focus Helper works",
    points: [
      "One ranked list across tasks and unanswered mail, so you don't have to compare three pages.",
      "Click “why?” on any row to see exactly which factors produced its score — you can disagree with it.",
      "Blocked work is ranked down but still shown, with the blocker named; clearing it is often the real job.",
      "Work with no due date, priority or waiting time isn't ranked at all rather than given a made-up position.",
    ],
  },
  "/voice-notes": {
    title: "How the Voice-Note Helper works",
    points: [
      "Hit record and speak naturally — “remind me to send Priya the board pack by Friday, it's urgent”.",
      "Dates are worked out on your device from today's real date, not guessed by the AI.",
      "One note can become a task or something the desk remembers — you choose after reading it back.",
      "Nothing is saved until you press the button. Anything the parser overrode is shown in amber.",
    ],
  },
  "/briefing": {
    title: "How the Daily Briefing works",
    points: [
      "Your day in one place — diary, what to do first, who's waiting, what's owed today.",
      "Every section is composed from the same maths as the page it came from, so nothing disagrees.",
      "“Since your last briefing” compares against your previous visit, not this one.",
      "If a section is empty because data is missing rather than because there's nothing to do, it says so at the bottom.",
    ],
  },
  "/memory": {
    title: "How the Memory Helper works",
    points: [
      "A curated memory: nothing is remembered unless you write it here.",
      "Recall matches keywords and client, not meaning — “doesn't like early calls” won't be found by searching “scheduling”.",
      "Entries against a client flow into that client's email drafts automatically, and never into anyone else's.",
      "Always record where a fact came from. A fact nobody can trace is a fact nobody will act on.",
    ],
  },
  "/decision": {
    title: "How the Decision Helper works",
    points: [
      "You set the options, the criteria and the weights — those are judgements and they stay yours.",
      "The app only multiplies and sorts. The scoring is visible and editable, never a black box.",
      "“What would change the answer” is the useful bit: it shows how fragile the ranking is.",
      "When two options are within 5 points it says the numbers don't decide it — and the AI writes a record, never a recommendation.",
    ],
  },
  "/homework": {
    title: "How the Homework Helper works",
    points: [
      "Everything you owe before a fixed deadline — built from meetings with a start time and tasks with a due date.",
      "Different from Follow-ups: that's work that went quiet, this is work not started yet.",
      "“Brief me” writes a short 'where to start' summary from the list, nothing more.",
      "A meeting or task with no date on it produces nothing here — it isn't guessed at.",
    ],
  },
  "/investor-update": {
    title: "How the Investor-Update Helper works",
    points: [
      "The right panel shows every fact the draft is allowed to use — read it before you generate.",
      "The app can't see your finances, so type headline metrics yourself; blanks are omitted, never invented.",
      "Risks and blockers are pulled from your data and included by default — an update with no lowlights reads as evasive.",
      "The draft is a starting point. Check every figure before it leaves your outbox.",
    ],
  },
  "/scoreboard": {
    title: "How the Scoreboard Helper works",
    points: [
      "Real performance over a period, compared against the period before it.",
      "“—” means no data, not zero. A missing average is never shown as 0h.",
      "Point-in-time numbers (open, overdue, waiting) show no comparison — last week's backlog can't be reconstructed.",
      "Read the amber caveat box first; it says what the numbers can't see.",
    ],
  },
  "/travel": {
    title: "How the Travel Helper works",
    points: [
      "Enter each flight with its local times and both timezones — durations, layovers and clock changes are calculated for you.",
      "Warnings flag impossible connections, tight layovers, late arrivals and passports inside the six-month rule.",
      "“Add all to Tasks” turns the checklist into real tasks with due dates counted back from departure.",
      "The AI writes the document but does no maths — it copies the calculated times exactly.",
    ],
  },
};
