/**
 * Academy progress and attempts while running WITHOUT Supabase (demo mode).
 *
 * Live, an attempt can only be created by grade_academy_attempt(), which is why
 * the attempts table has no insert policy. Here anything in this file can write
 * one. Demo mode reviews the app; it does not certify anybody.
 */
import type { AcademyAttempt, AcademyPlan, AcademySubmission } from "@/types/db";

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

// ── Practical submissions and resource links (0095) ──
// Live, a learner can only write 'submitted' and only another admin can pass
// it. Demo mode lets the one demo user play both sides so the review flow can
// be seen; it certifies nobody.
const S_KEY = "madeea-demo-academy-submissions";
const R_KEY = "madeea-demo-academy-resource-links";

export const loadDemoSubmissions = (): AcademySubmission[] => read<AcademySubmission>(S_KEY);

export const saveDemoSubmission = (s: AcademySubmission): void =>
  write(S_KEY, [s, ...loadDemoSubmissions().filter((x) => x.id !== s.id)]);

export const loadDemoResourceLinks = (): Record<string, string> => {
  try { return JSON.parse(localStorage.getItem(R_KEY) || "{}"); } catch { return {}; }
};

export const setDemoResourceLink = (id: string, url: string | null): void => {
  const links = loadDemoResourceLinks();
  if (url) links[id] = url; else delete links[id];
  localStorage.setItem(R_KEY, JSON.stringify(links));
};

// ── Due dates and approval for client work (0097) ──
const PL_KEY = "madeea-demo-academy-plans";

export const loadDemoPlans = (): AcademyPlan[] => read<AcademyPlan>(PL_KEY);

export const saveDemoPlan = (userId: string, change: Partial<AcademyPlan>): void => {
  const rows = loadDemoPlans();
  const was = rows.find((p) => p.user_id === userId)
    ?? { user_id: userId, due_date: null, approved_by: null, approved_at: null, approval_note: null };
  write(PL_KEY, [{ ...was, ...change }, ...rows.filter((p) => p.user_id !== userId)]);
};
