import type { Priority } from "@/types/db";

// Common EA workflows. One-click starting points for a task + its checklist.
export interface TaskTemplate {
  name: string;
  title: string;
  priority: Priority;
  subtasks: string[];
}

export const TASK_TEMPLATES: TaskTemplate[] = [
  {
    name: "Onboard new client",
    title: "Onboard new client",
    priority: "high",
    subtasks: ["Discovery call", "Create profile in Client Vault", "Capture communication preferences", "Send welcome / kickoff", "Schedule 30-day check-in"],
  },
  {
    name: "Weekly report",
    title: "Prepare weekly report",
    priority: "normal",
    subtasks: ["Gather highlights", "Pull KPIs", "Draft summary", "Send to executive"],
  },
  {
    name: "Prepare for meeting",
    title: "Prepare for meeting",
    priority: "high",
    subtasks: ["Compile attendee profiles", "Draft agenda", "Attach documents", "Send pre-meeting reminder"],
  },
  {
    name: "Book travel",
    title: "Book travel",
    priority: "normal",
    subtasks: ["Confirm dates", "Book flights", "Book hotel", "Arrange ground transport", "Send itinerary"],
  },
  {
    name: "Process expenses",
    title: "Process expenses",
    priority: "normal",
    subtasks: ["Collect receipts", "Categorise", "Generate report", "Submit for approval"],
  },
];
