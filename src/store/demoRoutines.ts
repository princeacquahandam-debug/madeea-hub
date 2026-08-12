/**
 * Routines while running WITHOUT Supabase (demo mode).
 *
 * Materialised occurrences are tracked here too, because the uniqueness that
 * stops duplicates is a database index in live mode and there is no database
 * here. Without it, opening the app twice on a Monday would create Monday's
 * task twice — which is precisely the failure the index exists to prevent.
 */
import type { Routine } from "@/types/db";

const R_KEY = "madeea-demo-routines";
const M_KEY = "madeea-demo-routine-runs";

const read = <T,>(key: string): T[] => {
  try { return JSON.parse(localStorage.getItem(key) || "[]"); } catch { return []; }
};
const write = <T,>(key: string, rows: T[]) => localStorage.setItem(key, JSON.stringify(rows));

export const loadDemoRoutines = (): Routine[] => read<Routine>(R_KEY);
export const addDemoRoutine = (r: Routine): void => write(R_KEY, [r, ...loadDemoRoutines()]);
export const updateDemoRoutine = (id: string, patch: Partial<Routine>): void =>
  write(R_KEY, loadDemoRoutines().map((r) => (r.id === id ? { ...r, ...patch } : r)));
export const removeDemoRoutine = (id: string): void =>
  write(R_KEY, loadDemoRoutines().filter((r) => r.id !== id));

/** "<routineId>|<YYYY-MM-DD>" for every occurrence already turned into a task. */
export const loadDemoRuns = (): string[] => read<string>(M_KEY);

/** Returns false when this occurrence already exists — the index's job. */
export const claimDemoRun = (routineId: string, occurrence: string): boolean => {
  const key = `${routineId}|${occurrence}`;
  const runs = loadDemoRuns();
  if (runs.includes(key)) return false;
  write(M_KEY, [key, ...runs].slice(0, 500));
  return true;
};
