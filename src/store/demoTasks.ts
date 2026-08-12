/**
 * Tasks created while running WITHOUT Supabase (demo mode).
 *
 * In live mode every task goes to the database and this file is never touched.
 * In demo mode the mutations are no-ops, which would leave voice capture with a
 * Save button that visibly does nothing — so created tasks are kept in
 * localStorage instead, purely so the flow can be exercised in the preview.
 */
import type { Task } from "@/types/db";

const KEY = "madeea-demo-tasks";

export const loadDemoTasks = (): Task[] => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
};

export const addDemoTask = (t: Task): void => {
  const next = [t, ...loadDemoTasks()];
  localStorage.setItem(KEY, JSON.stringify(next));
};

/**
 * Edits to SEED tasks.
 *
 * The seed list is a module constant, so it cannot be written to. updateDemoTask
 * used to map over the created-tasks store alone, which meant editing a seed
 * task silently wrote nothing: the optimistic update painted the change, the
 * refetch that follows read the untouched seed value, and the card sprang back.
 *
 * On the board that looked exactly like drag-and-drop being broken, which is how
 * it was reported. Overrides are merged in useTasks(), the same way
 * demoAssignees already layers reassignments over the seed.
 */
const PATCH_KEY = "madeea-demo-task-patches";

export const loadTaskPatches = (): Record<string, Partial<Task>> => {
  try {
    return JSON.parse(localStorage.getItem(PATCH_KEY) || "{}");
  } catch {
    return {};
  }
};

export const updateDemoTask = (id: string, patch: Partial<Task>): void => {
  const created = loadDemoTasks();
  if (created.some((t) => t.id === id)) {
    localStorage.setItem(KEY, JSON.stringify(created.map((t) => (t.id === id ? { ...t, ...patch } : t))));
    return;
  }
  // A seed task. Record the change as an override instead of dropping it.
  const patches = loadTaskPatches();
  localStorage.setItem(PATCH_KEY, JSON.stringify({ ...patches, [id]: { ...patches[id], ...patch } }));
};

export const removeDemoTask = (id: string): void => {
  localStorage.setItem(KEY, JSON.stringify(loadDemoTasks().filter((t) => t.id !== id)));
};
