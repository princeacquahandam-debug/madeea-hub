import { useMemo, useState } from "react";
import {
  ArrowLeft, ArrowRight, BookOpen, Check, CircleCheckBig, FlaskConical, Lock,
  Play, RotateCcw, ShieldCheck, Users, Video, type LucideIcon,
} from "lucide-react";
import { PageHeader, Badge } from "@/components/ui";
import {
  useAcademyAttempts, useAcademyCourse, useAcademyMutations, useAcademyProgress,
  useAcademyRoster, useMyRole, useWorkspaceMembers,
} from "@/data/hooks";
import type { AcademyLesson, AcademyModule, GradeResult, LessonKind } from "@/types/db";
import { cn } from "@/lib/utils";

/**
 * The Made Ready Academy. Audit §5.2.
 *
 * Every EA finishes this before they are handed to a client, which makes it a
 * sales-call talking point (Reichelle 18:00) rather than an optional extra.
 *
 * What was here before was six cards with "Read guide" buttons that did
 * nothing. That is the facade principle P-1 rules out, so it is gone.
 *
 * The days unlock in order. That is what gives R-5.2.2's pass/fail gate
 * something to gate: without it, "you must pass Day 1" means nothing because
 * Day 2 was open the whole time. Grading happens in Postgres against a key the
 * browser cannot read, so passing costs you the course rather than devtools.
 */

const KIND: Record<LessonKind, { icon: LucideIcon; label: string }> = {
  reading: { icon: BookOpen, label: "Reading" },
  video: { icon: Video, label: "Video" },
  simulation: { icon: FlaskConical, label: "Simulation" },
};

const hhmm = (mins: number) => (mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60 ? `${mins % 60}m` : ""}`.trim() : `${mins}m`);

export default function Academy() {
  const { data: course, isLoading } = useAcademyCourse();
  const { data: doneIds = [] } = useAcademyProgress();
  const { data: attempts = [] } = useAcademyAttempts();
  const { data: role } = useMyRole();
  const { setLessonDone, grade } = useAcademyMutations();
  const isAdmin = role === "admin";

  const [openLesson, setOpenLesson] = useState<AcademyLesson | null>(null);
  const [quizModule, setQuizModule] = useState<AcademyModule | null>(null);
  const [tab, setTab] = useState<"course" | "team">("course");

  const done = useMemo(() => new Set(doneIds), [doneIds]);
  const modules = useMemo(
    () => (course?.modules ?? []).filter((m) => m.is_published).sort((a, b) => a.position - b.position),
    [course],
  );
  const lessonsOf = (id: string) =>
    (course?.lessons ?? []).filter((l) => l.module_id === id).sort((a, b) => a.position - b.position);

  /** Best attempt per module. Retries are unlimited, so the best one is the one that counts. */
  const passedModules = useMemo(() => {
    const s = new Set<string>();
    for (const a of attempts) if (a.passed) s.add(a.module_id);
    return s;
  }, [attempts]);

  // A day opens once the day before it is passed. Day 1 is always open.
  const unlockedUpTo = useMemo(() => {
    let i = 0;
    while (i < modules.length && passedModules.has(modules[i].id)) i++;
    return i; // index of the first module not yet passed
  }, [modules, passedModules]);

  const allLessons = course?.lessons ?? [];
  const totalDone = allLessons.filter((l) => done.has(l.id)).length;
  const madeReady = modules.length > 0 && passedModules.size >= modules.length;

  if (isLoading) return <div><PageHeader title="Training Center" subtitle="Loading the course…" /></div>;

  // ---------------------------------------------------------------- lesson
  if (openLesson) {
    const siblings = lessonsOf(openLesson.module_id);
    const idx = siblings.findIndex((l) => l.id === openLesson.id);
    const K = KIND[openLesson.kind];
    const isDone = done.has(openLesson.id);
    return (
      <div className="mx-auto max-w-3xl">
        <button onClick={() => setOpenLesson(null)} className="btn-ghost mb-5 border border-border">
          <ArrowLeft size={16} /> Back to the course
        </button>

        <p className="mb-1 text-[11px] font-extrabold uppercase tracking-[0.14em] text-accent">
          {K.label} · {hhmm(openLesson.minutes)}
        </p>
        <h1 className="mb-5 text-[27px] font-extrabold leading-tight tracking-[-0.02em]">{openLesson.title}</h1>

        {openLesson.kind === "video" && (
          openLesson.video_url ? (
            <video src={openLesson.video_url} controls className="mb-5 w-full rounded-2xl border border-border" />
          ) : (
            // No fake play button. FJ owns video production (Rowena 52:34) and
            // until a recording exists the honest thing is to say so.
            <div className="mb-5 flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-black/20 text-center">
              <Video size={26} className="text-faint" />
              <p className="text-sm font-medium">Recording not published yet</p>
              <p className="max-w-sm text-xs text-faint">The notes below cover the same ground. Read them and mark the lesson complete.</p>
            </div>
          )
        )}

        {openLesson.body && (
          <p className="mb-6 whitespace-pre-line text-[15px] leading-relaxed text-muted">{openLesson.body}</p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button
            className={cn("btn-primary", isDone && "opacity-60")}
            onClick={() => setLessonDone.mutate({ lessonId: openLesson.id, done: !isDone })}
          >
            {isDone ? <><RotateCcw size={15} /> Mark not done</> : <><Check size={15} /> Mark complete</>}
          </button>
          {idx < siblings.length - 1 && (
            <button className="btn-ghost border border-border" onClick={() => setOpenLesson(siblings[idx + 1])}>
              Next lesson <ArrowRight size={15} />
            </button>
          )}
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------ assessment
  if (quizModule) {
    return (
      <Assessment
        module={quizModule}
        questions={(course?.questions ?? []).filter((q) => q.module_id === quizModule.id).sort((a, b) => a.position - b.position)}
        onGrade={(answers) => grade.mutateAsync({ moduleId: quizModule.id, answers })}
        onExit={() => setQuizModule(null)}
      />
    );
  }

  // -------------------------------------------------------------- overview
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Training Center"
        subtitle="Made Ready. Finish this before your first day with a client."
        action={isAdmin && (
          <div className="flex rounded-xl border border-border p-0.5">
            {(["course", "team"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn("rounded-lg px-3 py-1.5 text-[13px] font-semibold capitalize transition-colors",
                  tab === t ? "bg-accent text-white" : "text-muted hover:text-fg")}
              >
                {t === "team" ? <><Users size={14} className="mr-1 inline" />Team</> : "Course"}
              </button>
            ))}
          </div>
        )}
      />

      {tab === "team" && isAdmin ? <Roster /> : (
        <>
          {/* Status */}
          <div className={cn("card mb-6 flex flex-wrap items-center gap-4 p-5",
            madeReady && "border-emerald-500/40 bg-emerald-500/[0.04]")}>
            <span className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-xl",
              madeReady ? "bg-emerald-500/15 text-emerald-400" : "bg-[color:var(--nav-active-bg)] text-accent")}>
              <ShieldCheck size={24} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-bold">{madeReady ? "Made Ready" : "Not yet Made Ready"}</p>
              <p className="text-[13px] text-muted">
                {passedModules.size} of {modules.length} days passed · {totalDone} of {allLessons.length} lessons complete
              </p>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className={cn("h-full rounded-full transition-all", madeReady ? "bg-emerald-400" : "bg-accent")}
                  style={{ width: `${modules.length ? (passedModules.size / modules.length) * 100 : 0}%` }}
                />
              </div>
            </div>
          </div>

          {/* Days */}
          <div className="space-y-4">
            {modules.map((m, i) => {
              const lessons = lessonsOf(m.id);
              const locked = i > unlockedUpTo;
              const passed = passedModules.has(m.id);
              const lessonsDone = lessons.filter((l) => done.has(l.id)).length;
              const allRead = lessons.length > 0 && lessonsDone === lessons.length;
              const best = attempts.filter((a) => a.module_id === m.id).reduce((b, a) => Math.max(b, a.score), -1);
              const hasQuiz = (course?.questions ?? []).some((q) => q.module_id === m.id);

              return (
                <section key={m.id} className={cn("card overflow-hidden", locked && "opacity-55")}>
                  <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4">
                    <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[13px] font-extrabold",
                      passed ? "bg-emerald-500/15 text-emerald-400" : "bg-[color:var(--nav-active-bg)] text-accent")}>
                      {passed ? <Check size={17} /> : m.day}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-bold leading-tight">Day {m.day}. {m.title}</p>
                      {m.summary && <p className="mt-0.5 text-[12.5px] leading-snug text-faint">{m.summary}</p>}
                    </div>
                    {locked ? <Badge tone="low"><Lock size={11} className="mr-1 inline" />Locked</Badge>
                      : passed ? <Badge tone="done">Passed {best}%</Badge>
                      : <span className="text-[12.5px] text-faint">{lessonsDone}/{lessons.length}</span>}
                  </div>

                  {locked ? (
                    <p className="px-5 py-4 text-[13px] text-faint">
                      Pass the Day {modules[i - 1]?.day} assessment to open this.
                    </p>
                  ) : (
                    <>
                      <ul className="divide-y divide-border">
                        {lessons.map((l) => {
                          const K = KIND[l.kind];
                          const isDone = done.has(l.id);
                          return (
                            <li key={l.id}>
                              <button
                                onClick={() => setOpenLesson(l)}
                                className="group flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-white/[0.03]"
                              >
                                <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full border",
                                  isDone ? "border-emerald-400/60 bg-emerald-500/15 text-emerald-400" : "border-border text-faint")}>
                                  {isDone ? <Check size={13} /> : <K.icon size={12} />}
                                </span>
                                <span className={cn("min-w-0 flex-1 truncate text-[14px]", isDone ? "text-muted" : "font-medium")}>
                                  {l.title}
                                </span>
                                <span className="shrink-0 text-[12px] text-faint">{K.label} · {hhmm(l.minutes)}</span>
                                <ArrowRight size={14} className="shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />
                              </button>
                            </li>
                          );
                        })}
                      </ul>

                      <div className="flex flex-wrap items-center gap-3 border-t border-border bg-black/10 px-5 py-3">
                        {!hasQuiz ? (
                          <p className="text-[13px] text-faint">No assessment written for this day yet.</p>
                        ) : (
                          <>
                            <button
                              className={cn(allRead ? "btn-primary" : "btn-ghost border border-border")}
                              onClick={() => setQuizModule(m)}
                              disabled={!allRead}
                            >
                              {passed ? <><RotateCcw size={15} /> Retake</> : <><Play size={15} /> Day {m.day} assessment</>}
                            </button>
                            <span className="text-[12.5px] text-faint">
                              {allRead
                                ? `${m.pass_pct}% to pass. Retries are unlimited.`
                                : `Finish all ${lessons.length} lessons to unlock the assessment.`}
                            </span>
                          </>
                        )}
                      </div>
                    </>
                  )}
                </section>
              );
            })}
          </div>

          {modules.length === 0 && (
            <div className="card p-8 text-center">
              <BookOpen size={24} className="mx-auto mb-3 text-faint" />
              <p className="font-medium">No course published</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-faint">
                Run migration 0034 to load the Made Ready outline.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ quiz
function Assessment({
  module: m, questions, onGrade, onExit,
}: {
  module: AcademyModule;
  questions: { id: string; prompt: string; choices: string[] }[];
  onGrade: (answers: Record<string, number>) => Promise<GradeResult>;
  onExit: () => void;
}) {
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [result, setResult] = useState<GradeResult | null>(null);
  const [busy, setBusy] = useState(false);
  const complete = questions.every((q) => q.id in answers);

  async function submit() {
    setBusy(true);
    try { setResult(await onGrade(answers)); window.scrollTo({ top: 0, behavior: "smooth" }); }
    finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <button onClick={onExit} className="btn-ghost mb-5 border border-border">
        <ArrowLeft size={16} /> Back to the course
      </button>

      <h1 className="text-[25px] font-extrabold tracking-[-0.02em]">Day {m.day} assessment</h1>
      <p className="mb-6 text-[14px] text-muted">
        {questions.length} questions. {m.pass_pct}% to pass. You can retake it as many times as you need.
      </p>

      {result && (
        <div className={cn("card mb-6 p-5", result.passed ? "border-emerald-500/40 bg-emerald-500/[0.05]" : "border-amber-500/40 bg-amber-500/[0.05]")}>
          <div className="flex items-center gap-3">
            {result.passed
              ? <CircleCheckBig size={22} className="shrink-0 text-emerald-400" />
              : <RotateCcw size={22} className="shrink-0 text-amber-400" />}
            <div>
              <p className="font-bold">{result.passed ? "Passed" : "Not passed yet"}</p>
              <p className="text-[13px] text-muted">
                {result.correct} of {result.total} correct, {result.score}%. Pass mark is {result.pass_pct}%.
              </p>
            </div>
          </div>
          {result.passed && (
            <button className="btn-primary mt-4" onClick={onExit}>Back to the course <ArrowRight size={15} /></button>
          )}
        </div>
      )}

      <ol className="space-y-4">
        {questions.map((q, qi) => {
          const verdict = result?.questions?.[q.id];
          return (
            <li key={q.id} className={cn("card p-5", verdict && (verdict.correct ? "border-emerald-500/30" : "border-red-500/30"))}>
              <p className="mb-3 font-semibold leading-snug">
                <span className="mr-1.5 text-faint">{qi + 1}.</span>{q.prompt}
              </p>
              <div className="space-y-2">
                {q.choices.map((c, ci) => {
                  const picked = answers[q.id] === ci;
                  return (
                    <label
                      key={ci}
                      className={cn("flex cursor-pointer items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-[14px] transition-colors",
                        picked ? "border-accent bg-[color:var(--nav-active-bg)]" : "border-border hover:border-[color:var(--border-strong)]")}
                    >
                      <input
                        type="radio"
                        name={q.id}
                        className="mt-0.5 accent-[color:var(--accent)]"
                        checked={picked}
                        disabled={Boolean(result)}
                        onChange={() => setAnswers((a) => ({ ...a, [q.id]: ci }))}
                      />
                      <span>{c}</span>
                    </label>
                  );
                })}
              </div>
              {/* Shown after grading: which ones to go back over, and why. Never
                  the correct index, so retries do not leak the key one at a time. */}
              {verdict && (
                <p className={cn("mt-3 text-[13px] leading-relaxed", verdict.correct ? "text-emerald-300/90" : "text-amber-300/90")}>
                  {verdict.correct ? "Correct. " : "Not quite. "}{verdict.explanation}
                </p>
              )}
            </li>
          );
        })}
      </ol>

      {!result && (
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button className="btn-primary" onClick={() => void submit()} disabled={!complete || busy}>
            {busy ? "Marking…" : "Submit answers"}
          </button>
          {!complete && (
            <span className="text-[13px] text-faint">
              {questions.length - Object.keys(answers).length} left to answer.
            </span>
          )}
        </div>
      )}
      {result && !result.passed && (
        <button className="btn-primary mt-6" onClick={() => { setResult(null); setAnswers({}); }}>
          <RotateCcw size={15} /> Try again
        </button>
      )}
    </div>
  );
}

// ------------------------------------------------- who has finished what
/** R-5.2.3. Admins only, both here and in the RLS policy behind it. */
function Roster() {
  const { data: rows = [], isLoading } = useAcademyRoster(true);
  const { data: members = [] } = useWorkspaceMembers();
  const name = (id: string) => members.find((m) => m.user_id === id)?.name ?? "Unknown";

  if (isLoading) return <div className="card p-6 text-sm text-faint">Loading…</div>;

  return (
    <div className="card overflow-hidden">
      <div className="border-b border-border px-5 py-3">
        <p className="font-semibold">Made Ready status</p>
        <p className="text-[12.5px] text-faint">Nobody should be handed to a client before this reads complete.</p>
      </div>
      <ul className="divide-y divide-border">
        {rows.map((r) => {
          const complete = r.modules_total > 0 && r.modules_passed >= r.modules_total;
          return (
            <li key={r.user_id} className="flex items-center gap-3 px-5 py-3">
              <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                complete ? "bg-emerald-500/15 text-emerald-400" : "bg-white/5 text-faint")}>
                <ShieldCheck size={16} />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{name(r.user_id)}</span>
              <span className="text-[13px] text-muted">{r.modules_passed}/{r.modules_total} days</span>
              {complete
                ? <Badge tone="done">Made Ready</Badge>
                : <Badge tone={r.modules_passed > 0 ? "high" : "low"}>{r.modules_passed > 0 ? "In progress" : "Not started"}</Badge>}
            </li>
          );
        })}
        {rows.length === 0 && <li className="px-5 py-6 text-sm text-faint">No team members yet.</li>}
      </ul>
    </div>
  );
}
