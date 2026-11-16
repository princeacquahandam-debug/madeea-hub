import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";

// ── types (mirror supabase/migrations/0103_academy_platform.sql) ───────────
export type Role = "learner" | "trainer" | "admin";
export type Level = "beginner" | "intermediate" | "advanced";
export type Difficulty = "easy" | "medium" | "hard";

export type Block =
  | { type: "text"; md: string }
  | { type: "image"; path: string; caption?: string }
  | { type: "video"; url?: string; path?: string; caption?: string }
  | { type: "table"; rows: string[][] };

export interface Course {
  id: string; workspace_id: string; title: string; description: string | null; level: Level; icon: string;
  cover_path: string | null; status: "draft" | "published"; created_at: string; updated_at: string; published_at: string | null;
}
export interface Module { id: string; course_id: string; title: string; position: number; pass_pct: number }
export interface Lesson { id: string; module_id: string; title: string; minutes: number; blocks: Block[]; position: number }
export interface Flashcard { id: string; module_id: string; front: string; back: string; position: number }
export interface Question {
  id: string; module_id: string | null; path_id: string | null; kind: "choice" | "text"; prompt: string;
  choices: string[]; explanation: string | null; difficulty: Difficulty; position: number;
}
export interface AnswerKey { question_id: string; correct_index: number | null; model_answer: string | null }
export interface Path {
  id: string; workspace_id: string; title: string; kind: string | null; description: string | null; status: "draft" | "published";
  has_final: boolean; pass_pct: number; time_limit_min: number | null; attempts_allowed: number | null; exam_size: number;
  audience: "all" | "selected"; due_days: number | null; created_at: string; updated_at: string; published_at: string | null;
}
export interface PathCourse { path_id: string; course_id: string; position: number }
export interface Audience { path_id: string; kind: "user" | "region" | "team"; value: string }
export interface Certificate { id: string; user_id: string; path_id: string; score: number | null; code: string; issued_at: string }
export interface Exam { id: string; path_id: string; started_at: string; submitted_at: string | null; score: number | null; total: number | null; passed: boolean | null }
export interface Me { user_id: string; role: Role | null; workspace_id: string | null; name: string | null; email: string | null }
export interface Person {
  user_id: string; name: string; email: string; hub_role: string; role: Role; region: string | null; team: string | null;
  paths_assigned: number; lessons_total: number; lessons_done: number; certificates: number; last_active: string | null;
}
export interface Settings { workspace_id: string; academy_name: string; signer_name: string | null; signer_title: string | null; signature_path: string | null }

export const LEVELS: { value: Level; label: string }[] = [
  { value: "beginner", label: "Beginner" },
  { value: "intermediate", label: "Intermediate" },
  { value: "advanced", label: "Advanced" },
];

async function must<T>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data as T;
}

// ── a whole course in one go (Studio editor and the player) ────────────────
export interface CourseTree {
  course: Course;
  modules: (Module & { lessons: Lesson[]; flashcards: Flashcard[]; questions: Question[] })[];
}

export async function fetchCourseTree(id: string): Promise<CourseTree | null> {
  const course = await must(supabase.from("acad_courses").select("*").eq("id", id).maybeSingle());
  if (!course) return null;
  const modules = await must(supabase.from("acad_modules").select("*").eq("course_id", id).order("position"));
  const ids = (modules as Module[]).map((m) => m.id);
  const [lessons, cards, questions] = ids.length
    ? await Promise.all([
        must(supabase.from("acad_lessons").select("*").in("module_id", ids).order("position")),
        must(supabase.from("acad_flashcards").select("*").in("module_id", ids).order("position")),
        must(supabase.from("acad_questions").select("*").in("module_id", ids).order("position")),
      ])
    : [[], [], []];
  return {
    course: course as Course,
    modules: (modules as Module[]).map((m) => ({
      ...m,
      lessons: (lessons as Lesson[]).filter((l) => l.module_id === m.id),
      flashcards: (cards as Flashcard[]).filter((f) => f.module_id === m.id),
      questions: (questions as Question[]).filter((q) => q.module_id === m.id),
    })),
  };
}

export const useCourseTree = (id: string | undefined) =>
  useQuery({ queryKey: ["course", id], enabled: !!id, queryFn: () => fetchCourseTree(id!) });

export const useCourses = () =>
  useQuery({
    queryKey: ["courses"],
    queryFn: async () => (await must(supabase.from("acad_courses").select("*").order("updated_at", { ascending: false }))) as Course[],
  });

export const usePaths = () =>
  useQuery({
    queryKey: ["paths"],
    queryFn: async () => (await must(supabase.from("acad_paths").select("*").order("created_at", { ascending: false }))) as Path[],
  });

export const usePathCourses = () =>
  useQuery({
    queryKey: ["path-courses"],
    queryFn: async () => (await must(supabase.from("acad_path_courses").select("*").order("position"))) as PathCourse[],
  });

/** Lesson ids the signed-in person has finished. */
export const useMyProgress = () =>
  useQuery({
    queryKey: ["my-progress"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      const rows = (await must(supabase.from("acad_progress").select("lesson_id, completed_at").eq("user_id", u.user?.id ?? ""))) as { lesson_id: string; completed_at: string }[];
      return new Set(rows.map((r) => r.lesson_id));
    },
  });

/** Lesson ids per course, for progress bars (only courses you can see). */
export const useLessonIndex = () =>
  useQuery({
    queryKey: ["lesson-index"],
    queryFn: async () => {
      const mods = (await must(supabase.from("acad_modules").select("id, course_id"))) as { id: string; course_id: string }[];
      const lessons = (await must(supabase.from("acad_lessons").select("id, module_id"))) as { id: string; module_id: string }[];
      const courseOf = new Map(mods.map((m) => [m.id, m.course_id]));
      const byCourse = new Map<string, string[]>();
      for (const l of lessons) {
        const c = courseOf.get(l.module_id);
        if (!c) continue;
        byCourse.set(c, [...(byCourse.get(c) ?? []), l.id]);
      }
      return byCourse;
    },
  });

export const useMyCertificates = () =>
  useQuery({
    queryKey: ["my-certs"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      return (await must(supabase.from("acad_certificates").select("*").eq("user_id", u.user?.id ?? "").order("issued_at", { ascending: false }))) as Certificate[];
    },
  });

export const useMyExams = (pathId: string | undefined) =>
  useQuery({
    queryKey: ["my-exams", pathId],
    enabled: !!pathId,
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      return (await must(supabase.from("acad_exams").select("id, path_id, started_at, submitted_at, score, total, passed")
        .eq("user_id", u.user?.id ?? "").eq("path_id", pathId!).order("started_at", { ascending: false }))) as Exam[];
    },
  });

export const useSettings = () =>
  useQuery({
    queryKey: ["settings"],
    queryFn: async () => (await must(supabase.from("acad_settings").select("*").maybeSingle())) as Settings | null,
  });

export const usePeople = (enabled = true) =>
  useQuery({
    queryKey: ["people"],
    enabled,
    queryFn: async () => (await must(supabase.rpc("acad_people"))) as Person[],
  });

export function pct(done: number, total: number) {
  return total ? Math.round((done * 100) / total) : 0;
}

export function fmtDate(iso: string | null | undefined) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
