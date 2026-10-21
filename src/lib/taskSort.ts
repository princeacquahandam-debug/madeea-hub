import type { Task } from "@/types/db";

/**
 * The board's order (Reich's testing feedback, 20 Oct 2026): earliest due date
 * first, then priority, so of three tasks due today the Urgent one is on top,
 * then High, then Normal. Tasks with no date go last. Applies in every column.
 *
 * Ties keep the order they were created in, so the board doesn't reshuffle
 * between visits.
 */
const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

export function compareTasks(a: Task, b: Task): number {
  const da = a.due_at?.slice(0, 10) ?? null;
  const db = b.due_at?.slice(0, 10) ?? null;
  if (da !== db) {
    if (da === null) return 1;
    if (db === null) return -1;
    return da < db ? -1 : 1;
  }
  const pa = PRIORITY_RANK[a.priority] ?? 9;
  const pb = PRIORITY_RANK[b.priority] ?? 9;
  if (pa !== pb) return pa - pb;
  return (a.created_at ?? "").localeCompare(b.created_at ?? "");
}

export const sortTasks = (tasks: Task[]): Task[] => [...tasks].sort(compareTasks);

/**
 * "My tasks": assigned to me, or created by me and not yet given to anyone.
 * One definition, used by the board's filter and the Dashboard's count, so the
 * two numbers agree.
 */
export function isMine(t: Task, userId: string | null | undefined): boolean {
  if (!userId) return false;
  if (t.assignee_id) return t.assignee_id === userId;
  return t.owner_id === userId;
}
