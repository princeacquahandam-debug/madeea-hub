export type Priority = "urgent" | "high" | "normal" | "low";
/** `review` (migration 0030) is where work that needs sign-off waits. */
export type TaskStatus = "todo" | "in_progress" | "review" | "done";
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
   * The EA accountable for this client (migration 0015). Informational only,
   * RLS is unchanged, so every EA still sees every client.
   */
  lead_ea_id?: string | null;
  /** The address this client is known by. */
  email?: string | null;
  /**
   * Domains that identify this client's people, used to match an incoming
   * message to them when nothing stored the link. Free-mail hosts are ignored
   * at match time: half a dozen clients on gmail.com would otherwise collapse
   * onto whichever one was checked first.
   */
  domains?: string[] | null;
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
  /**
   * Client-facing output that needs sign-off (migration 0030). A task with this
   * set cannot reach `done` without an approval. Enforced by a DB trigger, not
   * by the button.
   */
  requires_approval?: boolean;
  approved_by?: string | null;
  approved_at?: string | null;
  /**
   * Free-text working notes (migration 0026, R-4.7.3). Deliberately separate
   * from blocker_note: that one means blocked-and-why and feeds the EOD's
   * blockers, so general notes must not land there.
   */
  notes?: string | null;
  /** Day-stamped progress, newest first (R-4.7.4), where a multi-day task got to. */
  progress?: TaskProgress[];
  /** Reference links and files produced by the task (R-4.7.2). */
  attachments?: TaskAttachment[];
}

/**
 * A comment on a task (migration 0029).
 *
 * The conversation lives on the work. A general chat loses to the Slack the
 * client already has open; a thread pinned to a specific task does not.
 */
export interface TaskComment {
  id: string;
  task_id: string;
  author_id: string | null;
  body: string;
  mentions?: string[];
  created_at: string;
  edited_at?: string | null;
  /** Joined for display; never written. */
  author_name?: string | null;
}

/**
 * One thing that happened to a task (migration 0029). Written by triggers, so
 * it records what actually changed rather than what the UI remembered to say.
 * Append-only: there is a read policy and no other, and absent means denied.
 */
export interface TaskActivity {
  id: string;
  task_id: string;
  actor_id: string | null;
  verb: "created" | "status" | "priority" | "due" | "blocked" | "unblocked" | "commented" | string;
  from_value: string | null;
  to_value: string | null;
  created_at: string;
  actor_name?: string | null;
}

/**
 * Work that comes back on a schedule (migration 0032).
 *
 * Distinct from tasks.recurrence, which is completion-driven ("when this is
 * done, make another"). A routine is calendar-driven: Monday's report is due on
 * Monday whether or not last Monday's got finished.
 */
export interface Routine {
  id: string;
  name: string;
  /** Task template: { title, priority, notes }. */
  task_template: { title?: string; priority?: Priority; notes?: string };
  /** RFC 5545, e.g. FREQ=WEEKLY;BYDAY=MO. See lib/recurrence.ts for the subset. */
  rrule: string;
  timezone: string;
  client_id: string | null;
  assignee_id: string | null;
  is_active: boolean;
  lead_days: number;
  last_run_on: string | null;
  created_at: string;
}

/**
 * A stored login (migration 0033). The secret is ciphertext; the key lives only
 * in the browser. See lib/vault.ts for what that does and does not protect.
 */
export interface Credential {
  id: string;
  label: string;
  url: string | null;
  username: string | null;
  category: string | null;
  notes: string | null;
  secret_ciphertext: string;
  secret_nonce: string;
  key_version: number;
  client_id: string | null;
  rotated_at: string | null;
  created_at: string;
}

/** A document the workspace owns, rather than a link that rots (migration 0031). */
export interface WorkspaceFile {
  id: string;
  folder_id: string | null;
  client_id: string | null;
  task_id: string | null;
  name: string;
  mime_type: string | null;
  size_bytes: number;
  storage_key: string;
  uploaded_by: string | null;
  created_at: string;
  /** Demo mode only: an in-memory object URL, gone on reload. */
  local_url?: string | null;
}

export interface Folder {
  id: string;
  parent_id: string | null;
  name: string;
  client_id: string | null;
  created_at: string;
}

/**
 * A pointer to something worth finding again (migration 0031).
 *
 * Deliberately a reference and not a copy: saving a task must not freeze it as
 * it was, because a stale copy is worse than no bookmark.
 */
export interface SavedItem {
  id: string;
  kind: "task" | "recording" | "file" | "sop" | "note" | "eod";
  target_id: string;
  label: string | null;
  created_at: string;
}

/**
 * A screen recording that becomes an SOP (migration 0028).
 *
 * EA-only by design: a recording of someone working shows their inbox and
 * other clients' names. The SOP written from it is the shareable artifact, and
 * the file is purged after 30 days while the row and the SOP remain.
 */
export interface Recording {
  id: string;
  title: string;
  /** Path in the private bucket. Null once purged, or in demo mode. */
  storage_path: string | null;
  duration_seconds: number;
  has_audio: boolean;
  sop_id: string | null;
  created_at: string;
  expires_at: string;
  /** Demo mode only: an in-memory object URL, gone on reload. */
  local_url?: string | null;
}

/**
 * One clock-in / clock-out span (migration 0027).
 *
 * `ended_at: null` means it is running right now, and the database allows only
 * one such row per person. There is deliberately no screenshot or activity
 * field: whether the tracker monitors behaviour as well as time is OQ-5, still
 * open, and a privacy decision rather than an implementation detail.
 */
export interface TimeEntry {
  id: string;
  owner_id?: string | null;
  task_id?: string | null;
  client_id?: string | null;
  started_at: string;
  ended_at: string | null;
  note?: string | null;
  /** The working day this belongs to, in the EA's own local date. */
  work_date: string;
  /** Why the EA clocked out before finishing the expected day. Free text on
      purpose: the reasons worth reading are the ones no dropdown anticipated. */
  early_reason?: string | null;
  /** Joined for display; never written. */
  task_title?: string | null;
  client_name?: string | null;
  person_name?: string | null;
}

/** One dated line of progress on a task that spans more than a day. */
export interface TaskProgress {
  at: string;
  body: string;
}

/**
 * A link or a file hanging off a task. Both share a shape on purpose: to an EA
 * the deliverable is "attached to the task", whether it lives in Drive or here.
 */
export interface TaskAttachment {
  id: string;
  kind: "link" | "file";
  label: string;
  url: string;
}

/**
 * One submitted end-of-day report (migration 0016). Drafted from task activity,
 * reviewed and submitted by a person, the submission is what compliance counts.
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
  // SLA fields. Absent on every row today. Nothing populates them yet (see
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
  /** Which channel it arrived on: 'gmail', 'outlook', 'slack', 'manual'. */
  source?: string;
  /* Graph's message id, on Outlook rows only. It is what a threaded reply is
     built from (outlook-send opens a reply draft against it), which is why it
     is on the type rather than cast at the one call site that needs it. */
  outlook_id?: string | null;
  /** RFC 2822 Message-ID of the original. See 0042. */
  rfc_message_id?: string | null;
  /** Everyone else who was on it. What Reply all is built from. */
  to_emails?: string[];
  cc_emails?: string[];
  /* Where a reply goes on a channel that has no address and no room id: an
     Instagram IGSID, a WhatsApp wa_id. Deliberately not sender_email, which
     every other screen treats as something you can put in a mail client. */
  reply_target?: string | null;
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

/** One row per teammate with Google connected. How their mailbox sync is doing. */
export interface MailboxSync {
  owner_id: string;
  name: string;
  last_synced_at: string | null;
  last_status: "ok" | "error" | null;
  last_error: string | null;
  messages_seen: number;
  messages_triaged: number;
}

/**
 * Which mailbox a message came from, and which one can answer it.
 *
 * Two providers now, and the pair is deliberately a union rather than a boolean
 * `isOutlook`: a third mailbox is a value here and a case in two switches, not
 * a second boolean that can disagree with the first.
 */
export type MailProvider = "gmail" | "outlook";

/** One provider's connection for the signed-in person. */
export interface MailConnection {
  provider: MailProvider;
  connected: boolean;
  /** The mailbox address. Null on Gmail, where the login email IS the account. */
  account_email: string | null;
  connected_at: string | null;
  /* What the provider actually granted, as it said it at consent time. Read by
     the Teams card, which rides on the Microsoft connection: whether Teams
     works is a question about this string rather than a second connection. */
  scopes: string | null;
}

/**
 * One third-party account, connected by one person (migration 0058).
 *
 * The identity is (workspace, user, provider, provider_account_id). Never
 * workspace + provider: that shape means the second colleague to connect
 * overwrites the first, and everybody sends through whichever account was
 * attached last.
 *
 * No token field exists on this type, and that is not an omission. The three
 * token columns are not granted to the browser at all, so there is nothing to
 * model: a card renders from the account's name and status.
 */
export interface Integration {
  id: string;
  provider: "google" | "microsoft" | "slack" | "discord" | "meta" | "linkedin";
  /** The third-party account's own id. Part of the identity. */
  provider_account_id: string;
  provider_account_name: string | null;
  provider_email: string | null;
  status: "connected" | "disconnected" | "error" | "reauth_required" | "pending";
  scopes: string | null;
  /** Non-secret ids a provider needs at call time. Never a credential. */
  metadata: Record<string, string | null>;
  last_sync_at: string | null;
  last_error: string | null;
  created_at: string;
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
  /** The task this run is doing (0035). How a finished workflow reaches the EOD. */
  task_id?: string | null;
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

/**
 * The Made Ready Academy (migration 0034). Audit §5.2.
 *
 * Note what is missing: AcademyQuestion has no correct answer on it. The key
 * lives in a table the API cannot read, and grading happens in Postgres. That
 * is the difference between a gate and a suggestion.
 */
export type LessonKind = "reading" | "video" | "simulation";

export interface AcademyModule {
  id: string;
  /** 1, 2 or 3. Reichelle: three days, roughly three hours each. */
  day: number;
  title: string;
  summary: string | null;
  /** Percentage needed to pass, per module. */
  pass_pct: number;
  is_published: boolean;
  position: number;
}

export interface AcademyLesson {
  id: string;
  module_id: string;
  title: string;
  kind: LessonKind;
  body: string | null;
  /** Null until FJ publishes the recording. The player says so rather than faking a play button. */
  video_url: string | null;
  minutes: number;
  position: number;
}

export interface AcademyQuestion {
  id: string;
  module_id: string;
  prompt: string;
  choices: string[];
  explanation: string | null;
  position: number;
}

export interface AcademyAttempt {
  id: string;
  user_id: string;
  module_id: string;
  score: number;
  passed: boolean;
  created_at: string;
}

/** What grade_academy_attempt() hands back. Never includes the correct index. */
export interface GradeResult {
  score: number;
  passed: boolean;
  correct: number;
  total: number;
  pass_pct: number;
  questions: Record<string, { correct: boolean; explanation: string | null }>;
}

/** One row per team member, from the academy_status view. R-5.2.3. */
export interface AcademyStatus {
  user_id: string;
  modules_total: number;
  modules_passed: number;
  last_passed_at: string | null;
}
