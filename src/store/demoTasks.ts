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

export const updateDemoTask = (id: string, patch: Partial<Task>): void => {
  localStorage.setItem(
    KEY,
    JSON.stringify(loadDemoTasks().map((t) => (t.id === id ? { ...t, ...patch } : t))),
  );
};

export const removeDemoTask = (id: string): void => {
  localStorage.setItem(KEY, JSON.stringify(loadDemoTasks().filter((t) => t.id !== id)));
};
