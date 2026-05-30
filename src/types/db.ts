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
  active_tasks: { title: string; status: string }[];
  schedule: { when: string; what: string }[];
}

export interface Task {
  id: string;
  title: string;
  client_name: string;
  due_label: string;
  priority: Priority;
  status: TaskStatus;
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

export interface Generation {
  id: string;
  tool: "quick_action" | "studio" | "bookkeeping";
  format: string;
  client_name?: string;
  inputs: Record<string, string>;
  output: string;
  created_at: string;
}
