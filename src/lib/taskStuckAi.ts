import { generate } from "@/lib/ai";
import type { Task } from "@/types/db";
import { dayKey, findStuck, type Assignable, type StuckAction, type StuckRow } from "@/lib/taskInsights";
import { fetchStageSince } from "@/lib/taskStageSince";
import { taskLine } from "@/lib/taskPrioritizeAi";

/**
 * "Find stuck tasks" with the AI doing the judging (Abder, 21 Oct 2026 call).
 *
 * The rules version flags anything overdue, blocked, or untouched for 7 days.
 * Abder asked for the read a manager would give the board: the task that has
 * sat in In progress for five weeks, the review nobody picked up, the blocker
 * nobody chased. So every open task goes to the AI with how long it has been
 * in its current stage (lib/taskStageSince), and it says which are stuck, why,
 * and the next step.
 *
 * Checked, never trusted: unknown ids are dropped, text is trimmed, and the
 * action is only one the task allows (a new date only if it's overdue, a nudge
 * only if someone is assigned). If the AI can't be reached, the rules answer
 * and the card says so.
 */
const MAX_TASKS = 60;
const MAX_ROWS = 15;
const DAY = 86_400_000;

export interface StuckResult { checked: number; rows: StuckRow[]; summary: string; ai: boolean }

const ageDays = (iso: string | null | undefined, now: Date) => {
  const t = Date.parse(iso ?? "");
  return Number.isFinite(t) ? Math.max(0, Math.floor((now.getTime() - t) / DAY)) : 0;
};
const words = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().split(" ").slice(0, n).join(" ");

interface AiRow { id?: unknown; why?: unknown; next?: unknown; action?: unknown }

/** Only well-formed answers get through; anything else throws and the rules take over. */
export function parseStuck(
  output: string,
  byRef: Map<string, Task>,
  since: Map<string, string>,
  now: Date,
): { summary: string; rows: StuckRow[] } {
  const today = dayKey(now);
  const raw = String(output ?? "").trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  const data = JSON.parse(raw) as { summary?: unknown; rows?: unknown };
  if (!Array.isArray(data.rows)) throw new Error("no rows");
  const seen = new Set<string>();
  const rows: StuckRow[] = [];
  for (const r of data.rows as AiRow[]) {
    const ref = String(r?.id ?? "").trim().toUpperCase();
    const t = byRef.get(ref);
    if (!t || seen.has(ref)) continue;
    seen.add(ref);
    const due = t.due_at?.slice(0, 10);
    const overdue = Boolean(due && due < today);
    let action = String(r.action ?? "").trim().toLowerCase() as StuckAction;
    if (action === "set_date" && !overdue) action = "open";
    if (action === "nudge" && !t.assignee_id) action = "open";
    if (action !== "set_date" && action !== "nudge") action = "open";
    // "Days stuck": how long it's been overdue for a new-date row, otherwise
    // how long it has sat in its stage (or since its last update, without history).
    const days = action === "set_date" && due
      ? Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${due}T12:00:00Z`)) / DAY)
      : ageDays(since.get(t.id) ?? t.updated_at ?? t.created_at, now);
    rows.push({
      task: t,
      why: words(r.why, 16) || "Hasn't moved in a while",
      next: words(r.next, 16) || undefined,
      days,
      action,
    });
    if (rows.length >= MAX_ROWS) break;
  }
  const summary = typeof data.summary === "string" && data.summary.trim() ? data.summary.trim().slice(0, 300) : "";
  return { summary, rows };
}

export async function findStuckWithAi(tasks: Task[], opts: { now: Date; members: Assignable[] }): Promise<StuckResult> {
  const { now } = opts;
  const open = tasks.filter((t) => t.status !== "done");
  const rules = (): StuckResult => ({ ...findStuck(tasks, now), summary: "", ai: false });
  if (!open.length) return rules();

  const today = dayKey(now);
  const name = (id: string | null | undefined) => opts.members.find((m) => m.user_id === id)?.name ?? "Unassigned";
  try {
    const since = await fetchStageSince(open.map((t) => t.id));
    // The longest-sitting first, in case the board is bigger than one request.
    const age = (t: Task) => ageDays(since.get(t.id) ?? t.updated_at ?? t.created_at, now);
    const sent = [...open].sort((a, b) => age(b) - age(a)).slice(0, MAX_TASKS);
    const byRef = new Map(sent.map((t, i) => [`T${i + 1}`, t]));
    const output = await generate({
      tool: "task_stuck",
      format: "Find stuck tasks",
      inputs: {
        Today: `${today} (${now.toLocaleDateString("en-GB", { weekday: "long" })})`,
        "Open tasks": "\n" + [...byRef].map(([ref, t]) => taskLine(ref, t, now, today, name, since.get(t.id))).join("\n"),
        ...(open.length > sent.length ? { Note: `${open.length - sent.length} more open tasks, all moved more recently, not listed.` } : {}),
      },
    });
    const { summary, rows } = parseStuck(output, byRef, since, now);
    return { checked: open.length, rows, summary, ai: true };
  } catch (e) {
    console.error("AI stuck check failed, using the rules", e);
    return { ...rules(), summary: "Madeline couldn't be reached, so these are the board's own rules." };
  }
}
