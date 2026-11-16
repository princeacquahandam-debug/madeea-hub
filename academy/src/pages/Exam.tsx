import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Award, Clock, X } from "lucide-react";
import { errText, supabase } from "@/lib/supabase";
import { usePaths } from "@/lib/api";
import { Loading } from "@/components/Shell";

interface ExamPaper { exam_id: string; deadline: string | null; questions: { id: string; prompt: string; choices: string[] }[] }
interface ExamResult { score: number; total: number; passed: boolean; pass_pct: number; certificate: string | null; attempts_left: number | null }

/**
 * The final assessment. Questions are drawn at random from the path's bank by
 * the database (acad_start_exam), answers are marked there, and only the score
 * comes back, so the bank can't be collected one attempt at a time.
 */
export default function Exam() {
  const { pathId } = useParams();
  const qc = useQueryClient();
  const paths = usePaths();
  const path = paths.data?.find((p) => p.id === pathId);
  const [paper, setPaper] = useState<ExamPaper | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [result, setResult] = useState<ExamResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const submitted = useRef(false);
  const storeKey = paper ? `madeea-academy-exam:${paper.exam_id}` : null;

  useEffect(() => {
    supabase.rpc("acad_start_exam", { p_path: pathId }).then(({ data, error }) => {
      if (error) setErr(errText(error));
      else {
        const p = data as ExamPaper;
        setPaper(p);
        try { setAnswers(JSON.parse(localStorage.getItem(`madeea-academy-exam:${p.exam_id}`) ?? "{}")); } catch { /* none saved */ }
      }
    });
  }, [pathId]);

  // Keep answers if the page is reloaded mid-exam.
  useEffect(() => {
    if (!storeKey) return;
    try { localStorage.setItem(storeKey, JSON.stringify(answers)); } catch { /* private mode */ }
  }, [answers, storeKey]);

  const submit = useCallback(async () => {
    if (!paper || submitted.current) return;
    submitted.current = true;
    setBusy(true);
    const { data, error } = await supabase.rpc("acad_submit_exam", { p_exam: paper.exam_id, p_answers: answers });
    setBusy(false);
    if (error) { setErr(errText(error)); submitted.current = false; return; }
    try { if (storeKey) localStorage.removeItem(storeKey); } catch { /* ignore */ }
    setResult(data as ExamResult);
    await qc.invalidateQueries({ queryKey: ["my-certs"] });
    await qc.invalidateQueries({ queryKey: ["my-exams", pathId] });
  }, [paper, answers, qc, pathId, storeKey]);

  // Timer; submits by itself when time runs out.
  const leftMs = paper?.deadline ? new Date(paper.deadline).getTime() - now : null;
  useEffect(() => {
    if (!paper?.deadline || result) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [paper?.deadline, result]);
  useEffect(() => { if (leftMs != null && leftMs <= 0 && !result) void submit(); }, [leftMs, result, submit]);

  const back = `/paths/${pathId}`;
  if (err && !paper) {
    return (
      <div className="grid min-h-screen place-items-center px-4">
        <div className="card max-w-sm p-6 text-center">
          <p className="font-semibold">The assessment can't start</p>
          <p className="mt-1 text-sm text-muted">{err}</p>
          <Link to={back} className="btn mt-4">Back to the path</Link>
        </div>
      </div>
    );
  }
  if (!paper) return <Loading />;

  if (result) {
    return (
      <div className="grid min-h-screen place-items-center px-4">
        <div className="card w-full max-w-md p-6 text-center">
          {result.passed ? <Award size={40} className="mx-auto mb-3 text-good" /> : <Clock size={36} className="mx-auto mb-3 text-warn" />}
          <h1 className="text-2xl font-extrabold">{result.passed ? "You passed" : "Not this time"}</h1>
          <p className="mt-2 text-lg">{result.score} of {result.total} · {Math.round((result.score * 100) / result.total)}%</p>
          <p className="text-sm text-muted">Pass mark {result.pass_pct}%</p>
          {!result.passed && result.attempts_left != null && <p className="mt-2 text-sm text-muted">{result.attempts_left} attempt{result.attempts_left === 1 ? "" : "s"} left.</p>}
          <div className="mt-5 flex justify-center gap-2">
            {result.certificate && <Link to={`/certificate/${result.certificate}`} className="btn-primary">View your certificate</Link>}
            <Link to={back} className="btn">Back to the path</Link>
          </div>
        </div>
      </div>
    );
  }

  const answered = Object.keys(answers).length;
  const mm = leftMs != null ? Math.max(0, Math.floor(leftMs / 60000)) : null;
  const ss = leftMs != null ? Math.max(0, Math.floor((leftMs % 60000) / 1000)) : null;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-3 px-4">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold">Final assessment{path ? ` · ${path.title}` : ""}</p>
            <p className="text-xs text-faint">{answered} of {paper.questions.length} answered</p>
          </div>
          {mm != null && <span className={`chip ${leftMs! < 60000 ? "!bg-accent/15 !text-accent-soft" : ""}`}><Clock size={12} />{mm}:{String(ss).padStart(2, "0")}</span>}
          <Link to={back} className="btn-ghost" aria-label="Leave"><X size={17} /></Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8">
        <ol className="space-y-5">
          {paper.questions.map((q, qi) => (
            <li key={q.id} className="card p-4">
              <p className="mb-3 font-semibold">{qi + 1}. {q.prompt}</p>
              <div className="space-y-2">
                {q.choices.map((c, ci) => (
                  <label key={ci} className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm ${answers[q.id] === ci ? "border-accent bg-accent/10" : "border-border hover:bg-surface-2"}`}>
                    <input type="radio" name={q.id} checked={answers[q.id] === ci} onChange={() => setAnswers({ ...answers, [q.id]: ci })} />
                    <span>{c}</span>
                  </label>
                ))}
              </div>
            </li>
          ))}
        </ol>
        {err && <p className="mt-3 text-sm text-accent-soft">{err}</p>}
        <div className="mt-6 flex items-center justify-between">
          <p className="text-sm text-muted">{answered < paper.questions.length ? `${paper.questions.length - answered} unanswered (they count as wrong)` : "All answered"}</p>
          <button className="btn-primary" disabled={busy} onClick={() => { if (answered === paper.questions.length || confirm("Some questions are unanswered. Submit anyway?")) void submit(); }}>
            {busy ? "Marking…" : "Submit"}
          </button>
        </div>
      </main>
    </div>
  );
}
