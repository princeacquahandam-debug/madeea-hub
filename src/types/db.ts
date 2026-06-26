export type Priority = "urgent" | "high" | "normal" | "low";
export type TaskStatus = "todo" | "in_progress" | "done";
export type MessageCategory = "urgent" | "reply" | "delegate" | "archive";
export type MeetingStatus = "prepared" | "needs_prep" | "pending";
export type AutomationStatus = "active" | "paused";

export interface Client {
  id: string;
  name: string;
  title: string;
  company: string;
  preferred_channel: string;
  tone: string;
  tags: string[];
  bio: string;
  preferences_notes: string;
  avatar_url: string | null;
  active_tasks: { title: string; status: string }[];
  schedule: { when: string; what: string }[];
}

export interface AutomationRun {
  id: string;
  automation_id: string;
  ran_at: string;
  summary: string | null;
  output: { text?: string } | null;
}

export interface Subtask {
  id: string;
  label: string;
  done: boolean;
}

export type Recurrence = "none" | "daily" | "weekly" | "monthly";

export interface Task {
  id: string;
  title: string;
  client_name: string;
  due_label: string;
  due_at: string | null;
  priority: Priority;
  status: TaskStatus;
  subtasks: Subtask[];
  recurrence: Recurrence;
  depends_on: string | null;
}

export interface Message {
  id: string;
  sender_name: string;
  time: string;
  subject: string;
  preview: string;
  body: string;
  category: MessageCategory;
  client_name?: string;
  client_title?: string;
}

export interface Meeting {
  id: string;
  time: string;
  title: string;
  with: string;
  status: MeetingStatus;
}

export interface Automation {
  id: string;
  name: string;
  description: string;
  status: AutomationStatus;
  last_run: string;
  total_runs: number;
  trigger?: string;
  action?: string;
  is_custom?: boolean;
}

export interface SopStep {
  id: string;
  label: string;
  required: boolean;
  ai_action?: string;
}

export interface Sop {
  id: string;
  title: string;
  description: string;
  category: string;
  steps: SopStep[];
  success_criteria: string[];
}

export interface SopRun {
  id: string;
  sop_id: string;
  client_id: string | null;
  checked: string[];
  status: "in_progress" | "completed";
  started_at: string;
  completed_at: string | null;
}

export interface Reminder {
  id: string;
  label: string;
  remind_at: string;
  dismissed: boolean;
  task_id: string | null;
}

export interface Generation {
  id: string;
  tool: "quick_action" | "studio" | "bookkeeping";
  format: string;
  client_name?: string;
  inputs: Record<string, string>;
  output: string;
  created_at: string;
}
