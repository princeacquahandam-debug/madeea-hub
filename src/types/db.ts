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
  /** Per-client SLA overrides. Null/absent = fall back to the global thresholds. */
  sla_ok_hours?: number | null;
  sla_risk_hours?: number | null;
  /**
   * The EA accountable for this client (migration 0015). Informational only —
   * RLS is unchanged, so every EA still sees every client.
   */
  lead_ea_id?: string | null;
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
  /** Bumped by a DB trigger on any change (migration 0013). Drives staleness. */
  updated_at?: string | null;
  /** The FK the frontend used to drop, matching tasks to clients by name string instead. */
  client_id?: string | null;
  created_at?: string | null;
  /** Stamped by a trigger when status flips to done (migration 0014). */
  completed_at?: string | null;
  /**
   * Who the task is FOR (migration 0015). Distinct from owner_id, which is who
   * created it. Null is a legitimate state: nobody has picked it up yet.
   */
  assignee_id?: string | null;
}

/** One reassignment, written by a DB trigger on every assignee_id change. */
export interface TaskEvent {
  id: string;
  task_id: string;
  actor_id: string | null;
  from_user_id: string | null;
  to_user_id: string | null;
  created_at: string;
}

export interface Message {
  id: string;
  sender_name: string;
  time: string;
  received_at: string | null;
  subject: string;
  preview: string;
  body: string;
  category: MessageCategory;
  client_id?: string | null;
  client_name?: string;
  client_title?: string;
  // SLA fields. Absent on every row today — nothing populates them yet (see
  // lib/sla.ts). `first_reply_at` is the timestamp of the FIRST message we sent
  // back on this thread; null means still unanswered, which is not the same as
  // a response time of zero.
  thread_id?: string | null;
  sender_email?: string | null;
  first_reply_at?: string | null;
  /** 'inbound' = they wrote to us. 'outbound' = we wrote to them. */
  direction?: "inbound" | "outbound";
  /** Outbound only: when THEY replied. Null on an old outbound = a dead thread. */
  reply_received_at?: string | null;
}

export interface Snooze {
  id: string;
  item_type: "message" | "task";
  item_id: string;
  snooze_until: string;
}

export interface Meeting {
  id: string;
  time: string;
  starts_at: string | null;
  title: string;
  with: string;
  client_id: string | null;
  status: MeetingStatus;
  /** Populated by calendar-sync; how a meeting resolves to a client. */
  attendee_emails?: string[] | null;
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
  tool: "quick_action" | "studio" | "bookkeeping" | "homework" | "scoreboard" | "investor_update" | "travel";
  format: string;
  client_name?: string;
  inputs: Record<string, string>;
  output: string;
  created_at: string;
}
