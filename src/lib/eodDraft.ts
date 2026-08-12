/**
 * Turns Kanban activity into a draft end-of-day report.
 *
 * The mapping the team asked for:
 *   Done      <- your tasks stamped completed_at today (migration 0014)
 *   Blockers  <- your tasks flagged blocked, with their reason (migration 0016)
 *   Plan      <- your tasks that aren't done and aren't blocked
 *
 * This only ever produces a DRAFT. The person edits it and submits, because an
 * EOD carries things the board never will ("attended the Monday meeting") and
 * because compliance only means something if submitting is a deliberate act.
 */
import type { Task } from "@/types/db";

export interface EodDraft {
  done: string[];
  blockers: string[];
  plans: string[];
}

/** Local YYYY-MM-DD. Not toISOString(), which shifts the day across timezones. */
export function todayIso(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

function isSameDay(ts: string | null | undefined, iso: string): boolean {
  if (!ts) return false;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return false;
  return todayIso(d) === iso;
}

const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

/**
 * A task is blocked either because someone SAID so (blocked + blocker_note, new
 * in 0016) or because it's waiting on a dependency that isn't done, the board
 * already derives and shows that second kind. Both are worth reporting, so the
 * draft picks up both, with the reason spelled out.
 */
function blockerLine(t: Task, byId: Map<string, Task>): string | null {
  if (t.blocked) return t.blocker_note?.trim() ? `${t.title}: ${t.blocker_note.trim()}` : t.title;
  const dep = t.depends_on ? byId.get(t.depends_on) : undefined;
  if (dep && dep.status !== "done") return `${t.title}: waiting on "${dep.title}"`;
  return null;
}

export function draftFromTasks(tasks: Task[], myId: string | undefined, day: string): EodDraft {
  // No identity means we can't tell whose work is whose; an empty draft is the
  // honest answer rather than everyone's tasks.
  const mine = myId ? tasks.filter((t) => t.assignee_id === myId) : [];
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const byPriority = (a: Task, b: Task) =>
    (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9);

  const open = mine.filter((t) => t.status !== "done").sort(byPriority);
  const blocked = open.filter((t) => blockerLine(t, byId) !== null);
  const blockedIds = new Set(blocked.map((t) => t.id));

  return {
    done: mine
      .filter((t) => t.status === "done" && isSameDay(t.completed_at, day))
      .map((t) => t.title),
    blockers: blocked.map((t) => blockerLine(t, byId)!),
    // Anything blocked is already reported above; the plan is what you can move.
    plans: open.filter((t) => !blockedIds.has(t.id)).map((t) => t.title),
  };
}
