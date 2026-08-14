import type { Automation, Client, Meeting, Message, Task, Sop } from "@/types/db";
import * as demo from "@/data/demo";

// No dummy data. These empty arrays are the read-only fallback used ONLY in
// demo mode (no Supabase credentials). In live mode every page reads the user's
// real Supabase data. Real records are created through the app (CRUD) or synced
// from integrations (Gmail/Calendar). Never seeded.
//
// Sample data is loaded only in demo mode (no Supabase). I.e. local dev, or a
// build that explicitly opts into the public demo (VITE_ALLOW_DEMO=true /
// VITE_DEMO=1). A real deployment with Supabase env set never uses these arrays
// (the hooks read live data), so this stays out of production data paths.
const DEMO =
  import.meta.env.VITE_DEMO === "1" ||
  import.meta.env.VITE_ALLOW_DEMO === "true" ||
  import.meta.env.DEV;

export const CLIENTS: Client[] = DEMO ? demo.CLIENTS : [];
export const TASKS: Task[] = DEMO ? demo.TASKS : [];
export const MESSAGES: Message[] = DEMO ? demo.MESSAGES : [];
export const MEETINGS: Meeting[] = DEMO ? demo.MEETINGS : [];
export const AUTOMATIONS: Automation[] = DEMO ? demo.AUTOMATIONS : [];

// Default SOPs (product templates, not user data). Fallback for demo mode.
// In live mode these are seeded globally by migration 0007.
export const SOPS: Sop[] = [
  {
    id: "sop-inbox",
    title: "Inbox Triage",
    description: "Acknowledge, assess and action an incoming request to standard.",
    category: "Communication",
    steps: [
      { id: "ack", label: "Request acknowledged within 15 minutes", required: true },
      { id: "urgency", label: "Urgency assigned (Urgent / Standard / Low)", required: true },
      { id: "profile", label: "Client profile reviewed", required: true },
      { id: "ai", label: "AI support used (if applicable)", required: false, ai_action: "Triage the Inbox" },
      { id: "review", label: "Output reviewed against quality standards", required: true },
      { id: "deliver", label: "Response / action delivered", required: true },
      { id: "prefs", label: "Client preferences updated (if applicable)", required: false },
    ],
    success_criteria: [
      "Client has received a response",
      "Required action has been completed",
      "CRM / system has been updated",
      "Client profile updated with any new preferences",
    ],
  },
  /* The other four. Migration 0007 seeds five workflows into live mode and this
     array had one, so the tab looked nearly empty to everyone reviewing the app
     in demo mode, which is how the team reviews it. Kept in step with 0007 by
     hand: one copy is SQL, one is TypeScript, and there is no shared source. */
  {
    id: "sop-meeting",
    title: "Meeting Preparation",
    description: "Prepare an executive for an upcoming meeting.",
    category: "Scheduling",
    steps: [
      { id: "profiles", label: "Attendee profiles compiled", required: true },
      { id: "agenda", label: "Agenda drafted", required: true },
      { id: "docs", label: "Relevant documents attached", required: true },
      { id: "brief", label: "AI meeting brief generated", required: false, ai_action: "Meeting Prep" },
      { id: "reminder", label: "Pre-meeting reminder sent to participants", required: true },
    ],
    success_criteria: [
      "Meeting brief delivered to executive",
      "Reminders sent to all participants",
      "Documents shared",
    ],
  },
  {
    id: "sop-priority",
    title: "Executive Priority Alignment",
    description: "Produce the prioritised daily briefing for the executive.",
    category: "Operations",
    steps: [
      { id: "calendar", label: "Calendar reviewed", required: true },
      { id: "inbox", label: "Emails and tasks reviewed", required: true },
      { id: "flags", label: "Conflicts and urgent items flagged", required: true },
      { id: "brief", label: "Daily brief generated", required: true },
      { id: "deliver", label: "Brief delivered to executive", required: true },
    ],
    success_criteria: [
      "Prioritised daily brief delivered before 8 AM",
      "Conflicts surfaced and resolved or flagged",
    ],
  },
  {
    id: "sop-expense",
    title: "Expense & Bookkeeping",
    description: "Compile and submit an expense report.",
    category: "Finance",
    steps: [
      { id: "receipts", label: "Receipts collected", required: true },
      { id: "categorise", label: "Expenses categorised", required: true },
      { id: "report", label: "Expense report generated", required: true, ai_action: "Expense Report" },
      { id: "submit", label: "Submitted for approval", required: true },
      { id: "log", label: "Logged / filed in system", required: true },
    ],
    success_criteria: ["Expense report generated", "Submitted to finance", "Logged and filed"],
  },
  {
    id: "sop-onboarding",
    title: "Client Onboarding",
    description: "Bring a new client into the Vault and kick off the relationship.",
    category: "Clients",
    steps: [
      { id: "discovery", label: "Discovery call completed", required: true },
      { id: "vault", label: "Client profile created in Client Vault", required: true },
      { id: "prefs", label: "Communication preferences captured", required: true },
      { id: "kickoff", label: "Kickoff / welcome sent", required: true },
      { id: "checkin", label: "30-day check-in scheduled", required: true },
    ],
    success_criteria: [
      "Client profile complete in Vault",
      "Welcome / kickoff delivered",
      "Check-in on the calendar",
    ],
  },
];

export const USER = { name: "FJ Caballes", role: "Elite EA", initials: "FC" };
