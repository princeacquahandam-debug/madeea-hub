/**
 * Task assignments made while running WITHOUT Supabase (demo mode).
 *
 * In live mode assignee_id is a real column and a DB trigger logs every change to
 * task_events. Demo mode has no database and no auth, so reassignment is kept here
 * and merged over the seed tasks — otherwise the reassign control would be a button
 * that visibly does nothing. The UI says so rather than implying it persisted.
 */
import type { TaskEvent } from "@/types/db";

const KEY = "madeea-demo-assignees";
const EVENTS_KEY = "madeea-demo-task-events";

export const loadAssignees = (): Record<string, string | null> => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}");
  } catch {
    return {};
  }
};

export const loadDemoTaskEvents = (): TaskEvent[] => {
  try {
    return JSON.parse(localStorage.getItem(EVENTS_KEY) || "[]");
  } catch {
    return [];
  }
};

/** Mirrors what the Postgres trigger does in live mode: change the field, log the move. */
export const saveAssignee = (
  taskId: string,
  from: string | null,
  to: string | null,
  actorId: string,
): void => {
  const next = { ...loadAssignees(), [taskId]: to };
  localStorage.setItem(KEY, JSON.stringify(next));

  const events = loadDemoTaskEvents();
  events.unshift({
    id: `local-${Date.now()}`,
    task_id: taskId,
    actor_id: actorId,
    from_user_id: from,
    to_user_id: to,
    created_at: new Date().toISOString(),
  });
  localStorage.setItem(EVENTS_KEY, JSON.stringify(events.slice(0, 100)));
};
