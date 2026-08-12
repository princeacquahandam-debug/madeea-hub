/**
 * Time entries recorded while running WITHOUT Supabase (demo mode).
 *
 * Same reason as demoTasks: in live mode every entry goes to the database and
 * this file is never touched. In demo the mutations would be no-ops, which
 * would leave a clock-in button that visibly does nothing — and the tracker is
 * the one feature whose whole point is that starting it is required.
 */
import type { TimeEntry } from "@/types/db";

const KEY = "madeea-demo-time-entries";

export const loadDemoTime = (): TimeEntry[] => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
};

const save = (rows: TimeEntry[]) => localStorage.setItem(KEY, JSON.stringify(rows));

export const addDemoTime = (e: TimeEntry): void => save([e, ...loadDemoTime()]);

export const updateDemoTime = (id: string, patch: Partial<TimeEntry>): void =>
  save(loadDemoTime().map((e) => (e.id === id ? { ...e, ...patch } : e)));

export const removeDemoTime = (id: string): void =>
  save(loadDemoTime().filter((e) => e.id !== id));
