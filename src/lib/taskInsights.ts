import type { Priority, Task, TaskStatus } from "../types/db";

/**
 * The Tasks quick actions' answers, computed from the board itself (Abder's AI
 * answer spec for Tasks, 14 Oct 2026).
 *
 * "Plain, factual answers built only from the board's real data." The spec
 * fixes the ranking order, the limits and the stuck thresholds exactly, so
 * Prioritize board and Find stuck tasks are worked out here rather than asked
 * of a language model: the answer is always the same for the same board, it
 * cites only real facts, it is instant, and it costs no AI tokens. Only "Break
 * down a task" needs the AI, to write the steps.
 *
 * Pure functions, no app imports beyond types, so they can be checked on their
 * own (scratchpad tasks-insights test).
 */

export const STAGE_LABEL: Record<TaskStatus, string> = {
  todo: "To do", in_progress: "In progress", follow_up: "Waiting", review: "Review", done: "Done",
};
const PRIORITY_LABEL: Record<Priority, string> = { urgent: "Urgent", high: "High", normal: "Normal", low: "Low" };
const PRIORITY_RANK: Record<Priority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

/** Stuck = overdue, OR blocked, OR no update in 7+ days, OR waiting for approval 3+ days. */
export const STALE_DAYS = 7;
export const APPROVAL_DAYS = 3;
export const MAX_ROWS = 10;
export const MAX_CHANGES = 5;

const DAY = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");
export const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** Whole days between two YYYY-MM-DD keys, by calendar day (no timezone drift). */
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / DAY);
const dueKey = (t: Task) => (t.due_at ? t.due_at.slice(0, 10) : null);
const updatedMs = (t: Task) => Date.parse(t.updated_at ?? t.created_at ?? "") || 0;
const daysSinceUpdate = (t: Task, now: Date) => Math.max(0, Math.floor((now.getTime() - updatedMs(t)) / DAY));

/** In the user's own date format: "Oct 14" in en-US, "14 Oct" in en-GB. */
export const shortDate = (key: string) =>
  new Date(`${key}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/** The next weekday after today. New due dates are never today or in the past. */
export function nextWorkingDay(now: Date): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return dayKey(d);
}

const isOpen = (t: Task) => t.status !== "done";
const overdueDays = (t: Task, today: string) => {
  const due = dueKey(t);
  return due && due < today ? daysBetween(due, today) : 0;
};
const dueToday = (t: Task, today: string) => dueKey(t) === today;
const waitingApproval = (t: Task) => Boolean(t.requires_approval && !t.approved_at && t.status === "review");
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/* ─────────────────────────── Prioritize board ─────────────────────────── */

export type ChangeField = "assignee" | "due" | "priority" | "stage";

export interface Change {
  field: ChangeField;
  label: string;
  from: string;
  to: string;
  /** What to write to the task. */
  patch: Partial<Pick<Task, "assignee_id" | "due_at" | "priority" | "status">>;
  /** What to write back on Undo. */
  undo: Partial<Pick<Task, "assignee_id" | "due_at" | "priority" | "status">>;
}

export interface RankedRow {
  task: Task;
  rank: number | null;
  /** Max 15 words, a fact: days overdue, due date, stage, approval. */
  reason: string;
  change: Change | null;
}

export interface PrioritizeResult {
  /** "Madeline · {n} tasks reviewed · {time}" */
  reviewed: number;
  summary: string;
  rows: RankedRow[];
  changes: number;
}

export interface Assignable { user_id: string; name: string }
export interface ClientLead { id: string; lead_ea_id?: string | null }

/** 1 overdue (urgent/high first, by the priority sort) · 2 due today ·
    3 blocked or waiting for approval · 4 the rest. Abder's mockup ranks an
    overdue Normal task above one due today, so every overdue task is group 1. */
function group(t: Task, today: string): number {
  if (overdueDays(t, today) > 0) return 1;
  if (dueToday(t, today)) return 2;
  if (t.blocked || waitingApproval(t)) return 3;
  return 4;
}

function facts(t: Task, today: string): string[] {
  const out: string[] = [];
  if (t.priority === "urgent" || t.priority === "high") out.push(PRIORITY_LABEL[t.priority]);
  const od = overdueDays(t, today);
  if (od > 0) out.push(`${plural(od, "day")} overdue`);
  else if (dueToday(t, today)) out.push("due today");
  if (waitingApproval(t)) out.push("still waiting on approval");
  else if (t.blocked) out.push("marked Blocked");
  return out;
}
const sentence = (parts: string[]) => {
  const s = parts.join(", ");
  return s ? `${s[0].toUpperCase()}${s.slice(1)}.` : "";
};

export function prioritize(
  visible: Task[],
  opts: { now: Date; members: Assignable[]; clients: ClientLead[] },
): PrioritizeResult {
  const today = dayKey(opts.now);
  const name = (id: string | null | undefined) => opts.members.find((m) => m.user_id === id)?.name ?? "Unassigned";

  const ranked = visible
    .filter(isOpen)
    .sort((a, b) => group(a, today) - group(b, today)
      || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
      // Ties: oldest last update first.
      || updatedMs(a) - updatedMs(b));
  const done = visible.filter((t) => !isOpen(t));

  let changes = 0;
  const rows: RankedRow[] = [];
  for (const t of ranked.slice(0, MAX_ROWS)) {
    const od = overdueDays(t, today);
    let change: Change | null = null;
    let reason = "";

    if (changes < MAX_CHANGES) {
      // Assign only to someone who can see that client: the client's own EA.
      const lead = !t.assignee_id && t.client_id
        ? opts.clients.find((c) => c.id === t.client_id)?.lead_ea_id ?? null
        : null;
      if (lead && opts.members.some((m) => m.user_id === lead)) {
        change = { field: "assignee", label: "Assign to", from: "Unassigned", to: name(lead), patch: { assignee_id: lead }, undo: { assignee_id: null } };
        reason = sentence(facts(t, today)) || "Nobody is assigned yet.";
      } else if (od > 0) {
        // New due dates only for overdue tasks: the next working day.
        const next = nextWorkingDay(opts.now);
        change = { field: "due", label: "Due date", from: shortDate(dueKey(t)!), to: shortDate(next), patch: { due_at: next }, undo: { due_at: t.due_at } };
        reason = `${plural(od, "day")} overdue in ${STAGE_LABEL[t.status]}. Probably needs a new date.`;
      } else if (t.blocked && dueToday(t, today) && (t.priority === "normal" || t.priority === "low")) {
        change = { field: "priority", label: "Priority", from: PRIORITY_LABEL[t.priority], to: "High", patch: { priority: "high" }, undo: { priority: t.priority } };
        reason = "Due today but marked Blocked. Flag the blocker.";
      } else if (t.blocked && t.status !== "follow_up" && t.status !== "review") {
        change = { field: "stage", label: "Stage", from: STAGE_LABEL[t.status], to: "Waiting", patch: { status: "follow_up" }, undo: { status: t.status } };
        reason = `Marked Blocked but still in ${STAGE_LABEL[t.status]}. Move it to Waiting.`;
      }
      if (change) changes++;
    }

    if (!change) {
      const due = dueKey(t);
      reason = waitingApproval(t) ? "Waiting on approval. Nothing to change."
        : od > 0 ? `${plural(od, "day")} overdue in ${STAGE_LABEL[t.status]}.`
        : dueToday(t, today) ? "Due today. Keep it moving."
        : t.blocked ? "Blocked, already in Waiting."
        : due ? `On track, due ${shortDate(due)}.`
        : `No due date, last update ${plural(daysSinceUpdate(t, opts.now), "day")} ago.`;
    }
    rows.push({ task: t, rank: rows.length + 1, reason, change });
  }
  // Done tasks last, greyed, while there's room.
  for (const t of done) {
    if (rows.length >= MAX_ROWS) break;
    rows.push({ task: t, rank: null, reason: "Already done. No change.", change: null });
  }

  const open = visible.filter(isOpen);
  const overdue = open.filter((t) => overdueDays(t, today) > 0).length;
  const blocked = open.filter((t) => t.blocked).length;
  const summary = changes === 0
    ? "Your board is in good order. Nothing to change."
    : `${overdue} overdue, ${blocked} blocked. Here's the order I'd work in, with ${plural(changes, "suggested change")}.`;

  return { reviewed: visible.length, summary, rows, changes };
}

/* ─────────────────────────── Find stuck tasks ─────────────────────────── */

export type StuckAction = "set_date" | "nudge" | "open";

export interface StuckRow {
  task: Task;
  why: string;
  days: number;
  action: StuckAction;
  /** The next step, when the AI found it (lib/taskStuckAi). The rules leave it out. */
  next?: string;
}

export function findStuck(visible: Task[], now: Date): { checked: number; rows: StuckRow[] } {
  const today = dayKey(now);
  const open = visible.filter(isOpen);
  const rows: StuckRow[] = [];
  for (const t of open) {
    const od = overdueDays(t, today);
    const idle = daysSinceUpdate(t, now);
    if (od > 0) {
      rows.push({ task: t, why: `Overdue since ${shortDate(dueKey(t)!)}`, days: od, action: "set_date" });
    } else if (t.blocked) {
      const note = t.blocker_note?.trim();
      rows.push({ task: t, why: note ? `Blocked: ${note}` : "Blocked", days: idle, action: t.assignee_id ? "nudge" : "open" });
    } else if (waitingApproval(t) && idle >= APPROVAL_DAYS) {
      rows.push({ task: t, why: "Waiting for approval", days: idle, action: "open" });
    } else if (idle >= STALE_DAYS) {
      rows.push({ task: t, why: `No update since ${shortDate(dayKey(new Date(updatedMs(t))))}`, days: idle, action: t.assignee_id ? "nudge" : "open" });
    }
  }
  rows.sort((a, b) => b.days - a.days);
  return { checked: open.length, rows };
}
