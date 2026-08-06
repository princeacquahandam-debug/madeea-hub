import type { Automation, Client, Meeting, Message, Task, Sop } from "@/types/db";
import * as demo from "@/data/demo";

// No dummy data. These empty arrays are the read-only fallback used ONLY in
// demo mode (no Supabase credentials). In live mode every page reads the user's
// real Supabase data. Real records are created through the app (CRUD) or synced
// from integrations (Gmail/Calendar) — never seeded.
//
// Sample data is loaded only in demo mode (no Supabase) — i.e. local dev, or a
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

// Default SOPs (product templates, not user data) — fallback for demo mode.
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
      { id: "ai", label: "AI support used (if applicable)", required: false, ai_action: "Run Inbox Triage" },
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
];

export const USER = { name: "FJ Caballes", role: "Elite EA", initials: "FC" };
