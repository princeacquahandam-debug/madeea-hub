/**
 * Task comments and activity while running WITHOUT Supabase (demo mode).
 *
 * Live, triggers write the activity. Demo has no database and therefore no
 * triggers, so the equivalent events are recorded here. Otherwise the feed
 * would sit empty in the one mode the team actually reviews the app in, and
 * "the activity log is the transparency product" would be a claim nobody can
 * see working.
 */
import type { TaskActivity, TaskComment } from "@/types/db";

const C_KEY = "madeea-demo-task-comments";
const A_KEY = "madeea-demo-task-activity";

function read<T>(key: string): T[] {
  try { return JSON.parse(localStorage.getItem(key) || "[]"); } catch { return []; }
}
const write = <T,>(key: string, rows: T[]) => localStorage.setItem(key, JSON.stringify(rows));

export const loadDemoComments = (): TaskComment[] => read<TaskComment>(C_KEY);
export const loadDemoActivity = (): TaskActivity[] => read<TaskActivity>(A_KEY);

/** Mirrors the trigger: an event is appended for every recorded change. */
export const addDemoActivity = (a: TaskActivity): void =>
  write(A_KEY, [a, ...loadDemoActivity()].slice(0, 500));

export const addDemoComment = (c: TaskComment): void => {
  write(C_KEY, [...loadDemoComments(), c]);
  addDemoActivity({
    id: `act-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    task_id: c.task_id,
    actor_id: c.author_id,
    verb: "commented",
    from_value: null,
    to_value: c.body.slice(0, 120),
    created_at: c.created_at,
  });
};

export const removeDemoComment = (id: string): void =>
  write(C_KEY, loadDemoComments().filter((c) => c.id !== id));
