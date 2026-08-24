// Product version history. Surfaced in the in-app "What's new" page.
// Bump APP_VERSION and prepend a release whenever something ships.
export const APP_VERSION = "1.12.0";

export interface Release {
  version: string;
  date: string; // YYYY-MM-DD
  title: string;
  changes: string[];
}

export const CHANGELOG: Release[] = [
  {
    version: "1.12.0",
    date: "2026-08-24",
    title: "Team connections",
    changes: [
      "Integrations now lists every teammate and which mailbox each one has connected, so setting somebody up no longer means asking them whether it worked.",
      "It shows who has connected nothing, which is the half that actually needs chasing.",
      "Your colleagues mail stays private. This says whether the plumbing is attached, never what is in anyone inbox.",
      "Instagram DMs are now shared with the team, like Slack, Discord and WhatsApp. They arrive at the business account rather than a person, so whoever pressed Sync should not have been the only one able to see them.",
    ],
  },
  {
    version: "1.11.0",
    date: "2026-08-24",
    title: "Instagram and WhatsApp",
    changes: [
      "Instagram DMs sync into the Inbox and can be answered from the reading pane, like every other channel.",
      "WhatsApp arrives too, by webhook. There is no Sync button for it and there will not be one: Meta keeps no history to fetch, so messages appear as they are delivered.",
      "Both cards show what Meta can actually see, which account and which number, instead of a tick computed from whether a setting is filled in.",
      "Meta's reply windows are reported honestly. Instagram allows a reply for 24 hours (7 days for one you wrote yourself) and WhatsApp for 24 hours, after which only an approved template goes through. A send that Meta will refuse says so and why, rather than failing vaguely.",
      "LinkedIn remains the one channel with no route: it publishes no messaging API, and its card says that rather than promising a queue.",
    ],
  },
  {
    version: "1.10.0",
    date: "2026-08-24",
    title: "Teams and Discord, and replying to chats",
    changes: [
      "Microsoft Teams chats now arrive in the Inbox. No second sign-in: it runs on the same Microsoft connection as Outlook, so if you connected Outlook before today, reconnect once from the Teams card and it switches on.",
      "Discord is connected the way Slack is, with one bot for the whole team. The card lists every channel the bot can see and says separately whether it can read and post in each one.",
      "Slack, Discord and Teams messages can be answered from the reading pane. The reply goes back into the channel or chat it came from, named above the box, instead of being retyped into a composer at the bottom of the page.",
      "Instagram, WhatsApp and LinkedIn now say what is actually blocking them rather than \"coming later\": Meta app review, Meta business verification, and, for LinkedIn, the fact that no messaging API exists to build against.",
    ],
  },
  {
    version: "1.9.0",
    date: "2026-08-24",
    title: "Outlook mailboxes",
    changes: [
      "Connect Outlook as well as Gmail. Both now connect from their own card under Message channels in Integrations, which is also where you sync or disconnect them.",
      "Outlook mail lands in the Inbox alongside Gmail and Slack, and replies go back through the account the message arrived in, in the original thread.",
      "Your Outlook address does not have to match the email you sign into MadeEA with, so a work Microsoft mailbox works with a Gmail login. Google still has to match.",
      "With both mailboxes connected, the composer gains a From picker so you choose which one a new email goes out from.",
      "Replies now carry the original's message id, so they thread properly in the recipient's mail client instead of arriving as a new conversation, and Reply all reaches everyone who was actually on the message.",
    ],
  },
  {
    version: "1.8.0",
    date: "2026-07-25",
    title: "EOD Reports & self-serve password change",
    changes: [
      "New EOD Reports page. Your end-of-day report is drafted from your Task Manager (completed, blocked, and open tasks), and you review, add notes, and submit. Plus team submission compliance, a blocker feed and a coverage grid.",
      "Mark a task blocked with a reason on the board, it flags there and rolls into your EOD by itself.",
      "Change your own password from Settings. No reset email needed. Handy if you were set up with a temporary password: sign in, then set your own.",
    ],
  },
  {
    version: "1.7.0",
    date: "2026-07-23",
    title: "Notes, voice input & accessibility",
    changes: [
      "New Notes area, a shared team scratchpad for anything that doesn't belong on a task, client or the calendar yet. Pin the ones you keep coming back to, and everything shows up in global search.",
      "Voice input. Press the mic in the command bar (⌘K / Ctrl-K) and dictate your command instead of typing it, in browsers that support it.",
      "Every form field across the app now has a proper label for screen readers, and the timezone warning on the Travel Helper is announced with its field.",
      "Saving in the Memory Helper is now reliable. If a save is refused it tells you and keeps what you typed, instead of quietly losing it.",
      "Focus Helper checks the diary against stated goals, and the Decision Helper now states which option comes out ahead on your own weights.",
    ],
  },
  {
    version: "1.6.0",
    date: "2026-06-26",
    title: "Shared team workspace & email invites",
    changes: [
      "Everyone now works in one shared workspace. Each EA can see the whole team's tasks, clients, messages and meetings.",
      "Email invitations are live. Admins invite a teammate by email from the Admin panel and they're added to the team automatically.",
      "Admins keep the Admin panel for managing accounts and roles.",
    ],
  },
  {
    version: "1.5.0",
    date: "2026-06-26",
    title: "Admin panel & version history",
    changes: [
      "New Admin area for workspace administrators. See every team account, their role, and activity (open tasks, clients) at a glance.",
      "Admins can promote/demote members, remove accounts, and invite teammates by email.",
      "Admin & user views. Administrators use the app normally and switch to the Admin panel any time from the sidebar.",
      "This “What's new” page so the team can follow every update.",
    ],
  },
  {
    version: "1.4.0",
    date: "2026-06-25",
    title: "Guided tour polish + mobile",
    changes: [
      "The guided tour never covers the area it's highlighting, it repositions around it.",
      "On mobile the sidebar now opens automatically during the tour so you can see the menu it points to.",
      "Settings page. Replay the tutorial and sign out.",
    ],
  },
  {
    version: "1.3.0",
    date: "2026-06-20",
    title: "Power-user features",
    changes: [
      "Command palette (⌘K / Ctrl-K), pinned favorites, and a first-run guided tour.",
      "Task Manager depth. Checklists, repeating tasks, “blocked by” dependencies, and ready-made templates.",
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
