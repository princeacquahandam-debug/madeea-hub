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
  /** Blocked and why (migration 0016). Rolls straight into the EOD draft. */
  blocked?: boolean;
  blocker_note?: string | null;
}

/**
 * One submitted end-of-day report (migration 0016). Drafted from task activity,
 * reviewed and submitted by a person — the submission is what compliance counts.
 */
export interface EodReport {
  id: string;
  owner_id: string;
  report_date: string;
  done: string[];
  blockers: string[];
  plans: string[];
  notes?: string | null;
  submitted_at?: string | null;
  /** Resolved for display; the July import carries names, not auth users. */
  person?: string;
  /** Original sheet text, kept verbatim for imported July reports. */
  raw?: string | null;
  /** Deliverable URLs mentioned in the report. Parsed on import. */
  links?: string[];
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
  // Set by the team email organiser (see n8n/README.md). `triaged_at` null means
  // it is still queued; `category_locked` means a person re-filed it by hand and
  // the organiser will leave it alone from now on.
  triage_reason?: string | null;
  triage_source?: "rules" | "ai" | "manual" | null;
  triage_confidence?: number | null;
  triaged_at?: string | null;
  category_locked?: boolean;
  is_bulk?: boolean;
}

// ---------- Meeting Intelligence ----------
// Everything carries a verbatim quote. An item the model couldn't quote is dropped
// server-side, so anything reaching the UI is checkable against what was said.
export interface ExtractedActionItem { title: string; owner: string; due: string; quote: string; priority: string }
export interface ExtractedDecision { decision: string; context: string; quote: string; timestamp: string }
export interface ExtractedQuestion { question: string; quote: string }
export interface ExtractedCommitment { who: string; commitment: string; quote: string }
export interface ExtractedInsight { insight: string; quote: string }

export interface MeetingExtraction {
  summary?: string;
  action_items?: ExtractedActionItem[];
  decisions?: ExtractedDecision[];
  open_questions?: ExtractedQuestion[];
  commitments?: ExtractedCommitment[];
  insights?: ExtractedInsight[];
}

export interface MeetingNote {
  id: string;
  fathom_recording_id: number;
  title: string;
  meeting_url: string | null;
  share_url: string | null;
  recorded_at: string | null;
  attendees: string[];
  transcript_chars: number;
  summary: string | null;
  extracted: MeetingExtraction;
  status: "extracted" | "routed" | "failed";
  error: string | null;
  created_at: string;
}

export interface MeetingDecision {
  id: string;
  meeting_note_id: string | null;
  decision: string;
  context: string | null;
  quote: string | null;
  timestamp_label: string | null;
  decided_at: string | null;
  created_at: string;
}

export interface FathomSyncState {
  last_created_at: string | null;
  last_synced_at: string | null;
  last_status: string | null;
  last_error: string | null;
  meetings_seen: number;
  tasks_created: number;
  decisions_logged: number;
  memories_written: number;
}

/** One row per teammate with Google connected — how their mailbox sync is doing. */
export interface MailboxSync {
  owner_id: string;
  name: string;
  last_synced_at: string | null;
  last_status: "ok" | "error" | null;
  last_error: string | null;
  messages_seen: number;
  messages_triaged: number;
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
  tool:
    | "quick_action" | "studio" | "bookkeeping"
    | "homework" | "scoreboard" | "investor_update" | "travel"
    | "email_reply" | "meeting_followup" | "focus"
    | "briefing" | "decision";
  format: string;
  client_name?: string;
  inputs: Record<string, string>;
  output: string;
  created_at: string;
}
