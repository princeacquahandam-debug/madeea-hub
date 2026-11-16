import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronLeft, Layers, ListChecks, Menu, RotateCcw, Star, X } from "lucide-react";
import { useCourseTree, useMyProgress, type CourseTree, type Flashcard, type Question } from "@/lib/api";
import { errText, supabase } from "@/lib/supabase";
import { Blocks } from "@/components/Blocks";
import { Loading } from "@/components/Shell";

type Step =
  | { kind: "lesson"; moduleIdx: number; lessonId: string; title: string }
  | { kind: "cards"; moduleIdx: number; title: string }
  | { kind: "quiz"; moduleIdx: number; title: string };

function stepsOf(tree: CourseTree): Step[] {
  const out: Step[] = [];
  tree.modules.forEach((m, i) => {
    m.lessons.forEach((l) => out.push({ kind: "lesson", moduleIdx: i, lessonId: l.id, title: l.title }));
    if (m.flashcards.length) out.push({ kind: "cards", moduleIdx: i, title: "Flashcards" });
    if (m.questions.length) out.push({ kind: "quiz", moduleIdx: i, title: "Quiz" });
  });
  return out;
}

/**
 * The focused player (Abder: "only the content needs to be there, nothing
 * else"). No site navigation; an outline that opens on demand, the content,
 * and Back / Next. Used by learners and, with preview, by Studio.
 */
export default function Player({ preview = false }: { preview?: boolean }) {
  const { courseId } = useParams();
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const tree = useCourseTree(courseId);
  const prog = useMyProgress();
  const [outline, setOutline] = useState(false);
  const [finished, setFinished] = useState(false);

  const steps = useMemo(() => (tree.data ? stepsOf(tree.data) : []), [tree.data]);
  const firstUndone = useMemo(() => {
    if (preview || !prog.data) return 0;
    const i = steps.findIndex((s) => s.kind === "lesson" && !prog.data!.has(s.lessonId));
    return i < 0 ? 0 : i;
  }, [steps, prog.data, preview]);
  const stepParam = sp.get("step");
  const idx = Math.min(stepParam != null ? Number(stepParam) || 0 : firstUndone, Math.max(steps.length - 1, 0));
  const step = steps[idx];

  useEffect(() => { window.scrollTo({ top: 0 }); }, [idx]);

  if (tree.isLoading || prog.isLoading) return <Loading />;
  if (!tree.data) return <p className="py-16 text-center text-muted">This course isn't available to you.</p>;
  const { course, modules } = tree.data;
  const exitTo = preview ? `/studio/courses/${course.id}` : "/";

  const go = (i: number) => setSp((p) => { const n = new URLSearchParams(p); n.set("step", String(i)); return n; }, { replace: true });

  const markDone = async (lessonId: string) => {
    if (preview || prog.data?.has(lessonId)) return;
    const { error } = await supabase.from("acad_progress").upsert({ lesson_id: lessonId }, { onConflict: "user_id,lesson_id", ignoreDuplicates: true });
    if (!error) {
      await qc.invalidateQueries({ queryKey: ["my-progress"] });
    }
  };

  const next = async () => {
    if (step?.kind === "lesson") await markDone(step.lessonId);
    if (idx < steps.length - 1) go(idx + 1);
    else setFinished(true);
  };

  const doneCount = steps.filter((s) => s.kind === "lesson" && prog.data?.has(s.lessonId)).length;
  const lessonCount = steps.filter((s) => s.kind === "lesson").length;
  const mod = step ? modules[step.moduleIdx] : null;
  const lesson = step?.kind === "lesson" ? mod?.lessons.find((l) => l.id === step.lessonId) : null;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-4xl items-center gap-3 px-4">
          <button className="btn-ghost" onClick={() => setOutline(true)} aria-label="Course outline"><Menu size={17} /></button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold">{course.title}</p>
            <div className="bar mt-1 max-w-xs"><span style={{ width: `${steps.length ? ((idx + 1) * 100) / steps.length : 0}%` }} /></div>
          </div>
          {preview && <span className="chip-warn">Preview</span>}
          <Link to={exitTo} className="btn-ghost" aria-label="Close"><X size={17} /></Link>
        </div>
      </header>

      {outline && (
        <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setOutline(false)}>
          <aside className="h-full w-80 max-w-[85vw] overflow-y-auto border-r border-border bg-surface p-4" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <p className="font-bold">Outline</p>
              <button className="btn-ghost" onClick={() => setOutline(false)} aria-label="Close outline"><X size={16} /></button>
            </div>
            {!preview && <p className="mb-3 text-xs text-faint">{doneCount} of {lessonCount} lessons done</p>}
            {modules.map((m, mi) => (
              <div key={m.id} className="mb-4">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-faint">Module {mi + 1} · {m.title}</p>
                {steps.map((s, si) => s.moduleIdx !== mi ? null : (
                  <button key={si} onClick={() => { go(si); setOutline(false); setFinished(false); }}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${si === idx ? "bg-accent/15 text-accent-soft" : "hover:bg-surface-2"}`}>
                    {s.kind === "lesson" ? (prog.data?.has(s.lessonId) && !preview ? <CheckCircle2 size={14} className="shrink-0 text-good" /> : <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-border" />)
                      : s.kind === "cards" ? <Layers size={14} className="shrink-0" /> : <ListChecks size={14} className="shrink-0" />}
                    <span className="truncate">{s.title}</span>
                  </button>
                ))}
              </div>
            ))}
          </aside>
        </div>
      )}

      <main className="mx-auto max-w-3xl px-4 py-8">
        {steps.length === 0 ? (
          <p className="py-16 text-center text-muted">This course has no lessons yet.</p>
        ) : finished ? (
          <CourseDone courseId={course.id} title={course.title} preview={preview} onBack={() => nav(exitTo)} />
        ) : step && mod ? (
          <>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-faint">Module {step.moduleIdx + 1} · {mod.title}</p>
            {step.kind === "lesson" && lesson && (
              <article>
                <h1 className="mb-1 text-3xl font-extrabold">{lesson.title}</h1>
                <p className="mb-6 text-sm text-faint">{lesson.minutes} min</p>
                <Blocks blocks={lesson.blocks} />
              </article>
            )}
            {step.kind === "cards" && <Cards cards={mod.flashcards} />}
            {step.kind === "quiz" && <Quiz key={mod.id} moduleId={mod.id} questions={mod.questions} passPct={mod.pass_pct} preview={preview} />}

            <div className="mt-10 flex items-center justify-between border-t border-border pt-5">
              <button className="btn" onClick={() => go(idx - 1)} disabled={idx === 0}><ArrowLeft size={15} />Back</button>
              <span className="text-xs text-faint">{idx + 1} / {steps.length}</span>
              <button className="btn-primary" onClick={next}>
                {idx === steps.length - 1 ? <>Finish<Check size={15} /></> : <>Next<ArrowRight size={15} /></>}
              </button>
            </div>
          </>
        ) : null}
      </main>
    </div>
  );
}

function Cards({ cards }: { cards: Flashcard[] }) {
  const [i, setI] = useState(0);
  const [flip, setFlip] = useState(false);
  const c = cards[i];
  return (
    <div>
      <h1 className="mb-1 text-3xl font-extrabold">Flashcards</h1>
      <p className="mb-6 text-sm text-faint">Tap the card to see the answer. {i + 1} of {cards.length}</p>
      <button onClick={() => setFlip(!flip)}
        className={`card grid min-h-[16rem] w-full place-items-center p-8 text-center transition-colors ${flip ? "border-accent bg-accent/5" : "hover:border-accent"}`}
        aria-label={flip ? "Show the question" : "Show the answer"}>
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-faint">{flip ? "Answer" : "Question"}</p>
          <p className="whitespace-pre-wrap text-xl font-semibold">{flip ? c.back : c.front}</p>
        </div>
      </button>
      <div className="mt-4 flex items-center justify-center gap-2">
        <button className="btn" onClick={() => { setI(i - 1); setFlip(false); }} disabled={i === 0}><ChevronLeft size={15} />Previous</button>
        <button className="btn" onClick={() => setFlip(!flip)}><RotateCcw size={15} />Flip</button>
        <button className="btn" onClick={() => { setI(i + 1); setFlip(false); }} disabled={i === cards.length - 1}>Next card<ArrowRight size={15} /></button>
      </div>
    </div>
  );
}

interface QuizResult {
  score: number; total: number; passed: boolean;
  results: { id: string; correct: boolean | null; correct_index?: number | null; model_answer?: string | null; explanation?: string | null }[];
}

function Quiz({ moduleId, questions, passPct, preview }: { moduleId: string; questions: Question[]; passPct: number; preview: boolean }) {
  const [answers, setAnswers] = useState<Record<string, number | string>>({});
  const [result, setResult] = useState<QuizResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const byId = new Map(result?.results.map((r) => [r.id, r]) ?? []);
  const unanswered = questions.filter((q) => q.kind === "choice" && answers[q.id] === undefined).length;

  const submit = async () => {
    setBusy(true); setErr(null);
    const { data, error } = await supabase.rpc("acad_grade_quiz", { p_module: moduleId, p_answers: answers });
    setBusy(false);
    if (error) setErr(errText(error)); else setResult(data as QuizResult);
  };

  return (
    <div>
      <h1 className="mb-1 text-3xl font-extrabold">Quiz</h1>
      <p className="mb-6 text-sm text-faint">{questions.length} question{questions.length === 1 ? "" : "s"} · pass mark {passPct}%{preview ? " · your answers in preview are recorded as a test attempt" : ""}</p>
      {result && (
        <div className={`mb-6 rounded-xl px-4 py-3 ${result.passed ? "bg-good/15 text-good" : "bg-warn/15 text-warn"}`}>
          <p className="font-bold">{result.total ? `${result.score} of ${result.total} right` : "Answers saved"}{result.total ? (result.passed ? " · passed" : " · not yet") : ""}</p>
          {!result.passed && <p className="text-sm">Go over the ones marked below, then try again.</p>}
        </div>
      )}
      <ol className="space-y-6">
        {questions.map((q, qi) => {
          const r = byId.get(q.id);
          return (
            <li key={q.id} className="card p-4">
              <p className="mb-3 font-semibold">{qi + 1}. {q.prompt}</p>
              {q.kind === "choice" ? (
                <div className="space-y-2">
                  {q.choices.map((c, ci) => {
                    const chosen = answers[q.id] === ci;
                    const isRight = r && r.correct_index === ci;
                    const isWrongPick = r && chosen && !r.correct;
                    return (
                      <label key={ci} className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm transition-colors
                        ${isRight ? "border-good bg-good/10" : isWrongPick ? "border-accent bg-accent/10" : chosen ? "border-accent" : "border-border hover:bg-surface-2"}`}>
                        <input type="radio" name={q.id} className="accent-[rgb(var(--c-accent))]" checked={chosen} disabled={!!result}
                          onChange={() => setAnswers({ ...answers, [q.id]: ci })} />
                        <span className="flex-1">{c}</span>
                        {isRight && <Check size={15} className="text-good" />}
                      </label>
                    );
                  })}
                </div>
              ) : (
                <textarea className="textarea" rows={4} placeholder="Your answer" disabled={!!result}
                  value={(answers[q.id] as string) ?? ""} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} />
              )}
              {r?.model_answer && <p className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-sm"><span className="font-semibold">A strong answer: </span>{r.model_answer}</p>}
              {r?.explanation && <p className="mt-2 text-sm text-muted">{r.explanation}</p>}
            </li>
          );
        })}
      </ol>
      {err && <p className="mt-3 text-sm text-accent-soft">{err}</p>}
      <div className="mt-5">
        {result ? (
          <button className="btn" onClick={() => { setResult(null); setAnswers({}); }}><RotateCcw size={15} />Try again</button>
        ) : (
          <button className="btn-primary" onClick={submit} disabled={busy || unanswered > 0}>
            {busy ? "Checking…" : unanswered ? `Answer ${unanswered} more` : "Check my answers"}
          </button>
        )}
      </div>
    </div>
  );
}

/** End of a course: a short review (Abder's Reviews page reads these). */
function CourseDone({ courseId, title, preview, onBack }: { courseId: string; title: string; preview: boolean; onBack: () => void }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const send = async () => {
    setErr(null);
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("acad_reviews").upsert(
      { user_id: u.user?.id, course_id: courseId, rating, comment: comment.trim() || null },
      { onConflict: "user_id,course_id" },
    );
    if (error) setErr(errText(error)); else setSent(true);
  };

  return (
    <div className="card p-6 text-center">
      <CheckCircle2 size={36} className="mx-auto mb-3 text-good" />
      <h1 className="text-2xl font-extrabold">You finished {title}</h1>
      {preview ? (
        <p className="mt-2 text-muted">That's the end of the preview.</p>
      ) : sent ? (
        <p className="mt-2 text-muted">Thanks for the feedback.</p>
      ) : (
        <div className="mx-auto mt-5 max-w-sm text-left">
          <p className="label">How was this course?</p>
          <div className="mb-3 flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} onClick={() => setRating(n)} aria-label={`${n} star${n > 1 ? "s" : ""}`}>
                <Star size={26} className={n <= rating ? "fill-warn text-warn" : "text-faint"} />
              </button>
            ))}
          </div>
          <textarea className="textarea" rows={3} placeholder="Anything to improve? (optional)" value={comment} onChange={(e) => setComment(e.target.value)} />
          {err && <p className="mt-2 text-sm text-accent-soft">{err}</p>}
          <button className="btn-primary mt-3 w-full" disabled={!rating} onClick={send}>Send feedback</button>
        </div>
      )}
      <button className="btn mt-5" onClick={onBack}>{preview ? "Back to the editor" : "Back to my learning"}</button>
    </div>
  );
}
