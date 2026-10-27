import { generate } from "@/lib/ai";
import type { Priority, Task, TaskStatus } from "@/types/db";
import { MAX_CHANGES, MAX_ROWS, STAGE_LABEL, dayKey, prioritize, shortDate, type Assignable, type Change, type ClientLead, type PrioritizeResult, type RankedRow } from "@/lib/taskInsights";
import { fetchStageSince } from "@/lib/taskStageSince";

/**
 * "Prioritize board" with the AI doing the thinking (Abder, 21 Oct 2026 call).
 *
 * The rules-only version ranked what anyone can see by eye. Abder asked for a
 * real read of the board: a task sitting in In progress for a month, something
 * forgotten in Review, a blocker nobody chased. So every open task goes to the
 * AI with its facts worked out here (stage, days since its last update, due
 * date, blocker, approval, checklist), and it decides today's order and why.
 *
 * What comes back is checked, never trusted: unknown ids are dropped, reasons
 * are trimmed, and a change is only offered if it's one the board allows
 * (a future due date, a real priority, a stage other than Done). If the AI
 * can't be reached, the rules-based order is shown and says so.
 */
const MAX_TASKS = 50;
const PRIORITY_LABEL: Record<Priority, string> = { urgent: "Urgent", high: "High", normal: "Normal", low: "Low" };
const PRIORITY_RANK: Record<Priority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
const STAGES: TaskStatus[] = ["todo", "in_progress", "follow_up", "review"];
const DAY = 86_400_000;

const daysAgo = (iso: string | null | undefined, now: Date) => {
  const t = Date.parse(iso ?? "");
  return Number.isFinite(t) ? Math.max(0, Math.floor((now.getTime() - t) / DAY)) : null;
};
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** One task as the AI reads it. `since` = when it entered its current stage (lib/taskStageSince). */
export function taskLine(ref: string, t: Task, now: Date, today: string, name: (id: string | null | undefined) => string, since?: string): string {
  const inStage = since ? daysAgo(since, now) : null;
  const stage = `stage: ${STAGE_LABEL[t.status]}${inStage !== null ? ` (in this stage ${inStage === 0 ? "since today" : `for ${plural(inStage, "day")}`})` : ""}`;
  const parts = [`${ref} | "${t.title.slice(0, 80)}"`, stage, `priority: ${PRIORITY_LABEL[t.priority]}`];
  const due = t.due_at?.slice(0, 10);
  if (due) {
    const d = Math.round((Date.parse(`${due}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / DAY);
    parts.push(`due: ${due}${d < 0 ? ` (${plural(-d, "day")} overdue)` : d === 0 ? " (today)" : ""}`);
  } else parts.push("due: none");
  const upd = daysAgo(t.updated_at ?? t.created_at, now);
  if (upd !== null) parts.push(`last update: ${upd === 0 ? "today" : `${plural(upd, "day")} ago`}`);
  const made = daysAgo(t.created_at, now);
  if (made !== null) parts.push(`created: ${plural(made, "day")} ago`);
  if (t.blocked) parts.push(`BLOCKED: ${t.blocker_note?.trim() || "no reason given"}`);
  if (t.requires_approval && !t.approved_at) parts.push("needs approval, not approved yet");
  if (t.subtasks.length) parts.push(`checklist: ${t.subtasks.filter((s) => s.done).length}/${t.subtasks.length} done`);
  parts.push(`assignee: ${name(t.assignee_id)}`);
  if (t.client_name && t.client_name !== "Unassigned") parts.push(`client: ${t.client_name}`);
  return parts.join(" | ");
}

interface AiRow { id?: unknown; reason?: unknown; change?: { field?: unknown; to?: unknown } | null }

function toChange(t: Task, raw: AiRow["change"], today: string): Change | null {
  if (!raw || typeof raw !== "object") return null;
  const to = typeof raw.to === "string" ? raw.to.trim().toLowerCase() : "";
  if (raw.field === "due" && /^\d{4}-\d{2}-\d{2}$/.test(to) && to > today) {
    const from = t.due_at?.slice(0, 10);
    if (from === to) return null;
    return { field: "due", label: "Due date", from: from ? shortDate(from) : "None", to: shortDate(to), patch: { due_at: to }, undo: { due_at: t.due_at } };
  }
  if (raw.field === "priority" && to in PRIORITY_RANK && to !== t.priority) {
    const p = to as Priority;
    return { field: "priority", label: "Priority", from: PRIORITY_LABEL[t.priority], to: PRIORITY_LABEL[p], patch: { priority: p }, undo: { priority: t.priority } };
  }
  const stage = to === "waiting" ? "follow_up" : to.replace(/\s+/g, "_");
  if (raw.field === "stage" && (STAGES as string[]).includes(stage) && stage !== t.status) {
    const s = stage as TaskStatus;
    return { field: "stage", label: "Stage", from: STAGE_LABEL[t.status], to: STAGE_LABEL[s], patch: { status: s }, undo: { status: t.status } };
  }
  return null;
}

/** Only well-formed answers get through; anything else throws and the rules take over. */
export function parsePrioritize(output: string, byRef: Map<string, Task>, today: string): { summary: string; rows: RankedRow[]; changes: number } {
  const raw = String(output ?? "").trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  const data = JSON.parse(raw) as { summary?: unknown; rows?: unknown };
  if (!Array.isArray(data.rows)) throw new Error("no rows");
  const seen = new Set<string>();
  const rows: RankedRow[] = [];
  let changes = 0;
  for (const r of data.rows as AiRow[]) {
    const ref = String(r?.id ?? "").trim().toUpperCase();
    const t = byRef.get(ref);
    if (!t || seen.has(ref)) continue;
    seen.add(ref);
    const reason = String(r.reason ?? "").replace(/\s+/g, " ").trim().split(" ").slice(0, 22).join(" ");
    let change = changes < MAX_CHANGES ? toChange(t, r.change, today) : null;
    if (change) changes++;
    else change = null;
    rows.push({ task: t, rank: rows.length + 1, reason: reason || "Worth looking at today.", change });
    if (rows.length >= MAX_ROWS) break;
  }
  if (!rows.length) throw new Error("no usable rows");
  const summary = typeof data.summary === "string" && data.summary.trim() ? data.summary.trim().slice(0, 300) : "Here's the order I'd work in today.";
  return { summary, rows, changes };
}

export async function prioritizeWithAi(
  visible: Task[],
  opts: { now: Date; members: Assignable[]; clients: ClientLead[] },
): Promise<PrioritizeResult & { ai: boolean }> {
  const today = dayKey(opts.now);
  const open = visible.filter((t) => t.status !== "done");
  if (!open.length) return { ...prioritize(visible, opts), ai: false };

  // The most relevant first if the board is very large: the rules' order.
  const ordered = prioritize(open, opts).rows.map((r) => r.task);
  const rest = open.filter((t) => !ordered.includes(t));
  const sent = [...ordered, ...rest].slice(0, MAX_TASKS);
  const name = (id: string | null | undefined) => opts.members.find((m) => m.user_id === id)?.name ?? "Unassigned";
  const byRef = new Map(sent.map((t, i) => [`T${i + 1}`, t]));

  try {
    const since = await fetchStageSince(sent.map((t) => t.id));
    const output = await generate({
      tool: "task_prioritize",
      format: "Prioritize board",
      inputs: {
        Today: `${today} (${opts.now.toLocaleDateString("en-GB", { weekday: "long" })})`,
        "Open tasks": "\n" + [...byRef].map(([ref, t]) => taskLine(ref, t, opts.now, today, name, since.get(t.id))).join("\n"),
        ...(open.length > sent.length ? { Note: `${open.length - sent.length} more open tasks not listed.` } : {}),
      },
    });
    const { summary, rows, changes } = parsePrioritize(output, byRef, today);
    return { reviewed: visible.length, summary, rows, changes, ai: true };
  } catch (e) {
    console.error("AI prioritize failed, using the rules", e);
    const fallback = prioritize(visible, opts);
    return { ...fallback, summary: `Madeline couldn't be reached, so this is the board's own order. ${fallback.summary}`, ai: false };
  }
}
