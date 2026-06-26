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
};
