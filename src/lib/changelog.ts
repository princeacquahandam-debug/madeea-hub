// Product version history — surfaced in the in-app "What's new" page.
// Bump APP_VERSION and prepend a release whenever something ships.
export const APP_VERSION = "1.6.0";

export interface Release {
  version: string;
  date: string; // YYYY-MM-DD
  title: string;
  changes: string[];
}

export const CHANGELOG: Release[] = [
  {
    version: "1.6.0",
    date: "2026-06-26",
    title: "Shared team workspace",
    changes: [
      "Everyone now works in one shared workspace — each EA can see the whole team's tasks, clients, messages and meetings.",
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
