/**
 * Academy progress and attempts while running WITHOUT Supabase (demo mode).
 *
 * Live, an attempt can only be created by grade_academy_attempt(), which is why
 * the attempts table has no insert policy. Here anything in this file can write
 * one. Demo mode reviews the app; it does not certify anybody.
 */
import type { AcademyAttempt } from "@/types/db";

const P_KEY = "madeea-demo-academy-progress";
const A_KEY = "madeea-demo-academy-attempts";

const read = <T,>(key: string): T[] => {
  try { return JSON.parse(localStorage.getItem(key) || "[]"); } catch { return []; }
};
const write = <T,>(key: string, rows: T[]) => localStorage.setItem(key, JSON.stringify(rows));

/** Lesson ids the demo user has finished. */
export const loadDemoProgress = (): string[] => read<string>(P_KEY);

export const setDemoProgress = (lessonId: string, done: boolean): void => {
  const now = loadDemoProgress().filter((id) => id !== lessonId);
  write(P_KEY, done ? [lessonId, ...now] : now);
};

export const loadDemoAttempts = (): AcademyAttempt[] => read<AcademyAttempt>(A_KEY);

export const addDemoAttempt = (a: AcademyAttempt): void =>
  write(A_KEY, [a, ...loadDemoAttempts()].slice(0, 100));
