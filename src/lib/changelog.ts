// Product version history — surfaced in the in-app "What's new" page.
// Bump APP_VERSION and prepend a release whenever something ships.
export const APP_VERSION = "1.7.0";

export interface Release {
  version: string;
  date: string; // YYYY-MM-DD
  title: string;
  changes: string[];
}

export const CHANGELOG: Release[] = [
  {
    version: "1.7.0",
    date: "2026-07-23",
    title: "Notes, voice input & accessibility",
    changes: [
      "New Notes area — a shared team scratchpad for anything that doesn't belong on a task, client or the calendar yet. Pin the ones you keep coming back to, and everything shows up in global search.",
      "Voice input — press the mic in the command bar (⌘K / Ctrl-K) and dictate your command instead of typing it, in browsers that support it.",
      "Every form field across the app now has a proper label for screen readers, and the timezone warning on the Travel Helper is announced with its field.",
      "Saving in the Memory Helper is now reliable — if a save is refused it tells you and keeps what you typed, instead of quietly losing it.",
      "Focus Helper checks the diary against stated goals, and the Decision Helper now states which option comes out ahead on your own weights.",
    ],
  },
  {
    version: "1.6.0",
    date: "2026-06-26",
    title: "Shared team workspace & email invites",
    changes: [
      "Everyone now works in one shared workspace — each EA can see the whole team's tasks, clients, messages and meetings.",
      "Email invitations are live — admins invite a teammate by email from the Admin panel and they're added to the team automatically.",
      "Admins keep the Admin panel for managing accounts and roles.",
    ],
  },
  {
    version: "1.5.0",
    date: "2026-06-26",
    title: "Admin panel & version history",
    changes: [
      "New Admin area for workspace administrators — see every team account, their role, and activity (open tasks, clients) at a glance.",
      "Admins can promote/demote members, remove accounts, and invite teammates by email.",
      "Admin & user views — administrators use the app normally and switch to the Admin panel any time from the sidebar.",
      "This “What's new” page so the team can follow every update.",
    ],
  },
  {
    version: "1.4.0",
    date: "2026-06-25",
    title: "Guided tour polish + mobile",
    changes: [
      "The guided tour never covers the area it's highlighting — it repositions around it.",
      "On mobile the sidebar now opens automatically during the tour so you can see the menu it points to.",
      "Settings page — replay the tutorial and sign out.",
    ],
  },
  {
    version: "1.3.0",
    date: "2026-06-20",
    title: "Power-user features",
    changes: [
      "Command palette (⌘K / Ctrl-K), pinned favorites, and a first-run guided tour.",
      "Task Manager depth — checklists, repeating tasks, “blocked by” dependencies, and ready-made templates.",
      "Notification center with your own reminders and follow-ups; saveable AI prompts.",
    ],
  },
  {
    version: "1.2.0",
    date: "2026-06-12",
    title: "Working SOPs & guidance",
    changes: [
      "SOPs run as executable checklists with success criteria; pin one to the screen while you work.",
      "Guided forms, examples and tips across the AI Suite; results export to branded PDF.",
      "A collapsible “How this page works” guide on every page.",
    ],
  },
  {
    version: "1.1.0",
    date: "2026-06-02",
    title: "Automations & client vault",
    changes: [
      "On-demand automations that run against your live data and save the result.",
      "Client Vault profiles with photos (upload or link).",
      "Drag-and-drop Kanban task board.",
    ],
  },
  {
    version: "1.0.0",
    date: "2026-05-26",
    title: "Command Center launch",
    changes: [
      "Secure, invite-only multi-user app: Dashboard, Tasks, Clients, Communication, SOPs, AI Suite.",
      "Per-EA data isolation with workspace + role access control.",
    ],
  },
];
