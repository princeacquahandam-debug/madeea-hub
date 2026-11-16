import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Award, CheckCircle2, Clock, Lock, PlayCircle, Repeat, Target } from "lucide-react";
import { fmtDate, plural, useCourses, useLessonIndex, useMyCertificates, useMyExams, useMyProgress, usePathCourses, usePaths } from "@/lib/api";
import { errText, supabase } from "@/lib/supabase";
import { Loading } from "@/components/Shell";
import { CourseIcon } from "@/components/CourseIcon";
import { pathStats } from "./Home";

export default function PathPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const paths = usePaths();
  const pcs = usePathCourses();
  const courses = useCourses();
  const idx = useLessonIndex();
  const prog = useMyProgress();
  const certs = useMyCertificates();
  const exams = useMyExams(id);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (paths.isLoading || pcs.isLoading || courses.isLoading || idx.isLoading || prog.isLoading) return <Loading />;
  const path = paths.data?.find((p) => p.id === id);
  if (!path) return <p className="py-16 text-center text-muted">This learning path isn't available to you.</p>;

  const s = pathStats(path, pcs.data ?? [], courses.data ?? [], idx.data ?? new Map(), prog.data ?? new Set());
  const cert = certs.data?.find((c) => c.path_id === path.id);
  const used = exams.data?.length ?? 0;
  const left = path.attempts_allowed == null ? null : Math.max(path.attempts_allowed - used, 0);
  const ready = s.total > 0 && s.done >= s.total;

  const claim = async () => {
    setBusy(true); setErr(null);
    const { data, error } = await supabase.rpc("acad_claim_certificate", { p_path: path.id });
    setBusy(false);
    if (error) { setErr(errText(error)); return; }
    await qc.invalidateQueries({ queryKey: ["my-certs"] });
    nav(`/certificate/${data}`);
  };

  return (
    <>
      <Link to="/" className="btn-ghost mb-3 -ml-2"><ArrowLeft size={15} />Overview</Link>
      <div className="card mb-6 p-5">
        {path.kind && <p className="text-xs font-semibold uppercase tracking-wide text-faint">{path.kind}</p>}
        <h1 className="text-2xl font-extrabold">{path.title}</h1>
        {path.description && <p className="mt-2 text-muted">{path.description}</p>}
        <div className="mt-4 max-w-md">
          <div className="bar"><span style={{ width: `${s.pct}%` }} /></div>
          <p className="mt-1.5 text-xs text-faint">{s.done} of {plural(s.total, "lesson")} · {s.pct}%{path.due_days ? ` · due within ${path.due_days} days of assignment` : ""}</p>
        </div>
      </div>

      <h2 className="mb-3 text-lg font-bold">Courses</h2>
      <ol className="mb-8 space-y-2">
        {s.courses.map((c, i) => {
          const ls = idx.data?.get(c.id) ?? [];
          const d = ls.filter((l) => prog.data?.has(l)).length;
          const complete = ls.length > 0 && d === ls.length;
          return (
            <li key={c.id}>
              <Link to={`/learn/${c.id}`} className="card flex items-center gap-4 p-4 transition-colors hover:border-accent">
                <span className="w-5 text-center text-sm font-bold text-faint">{i + 1}</span>
                <CourseIcon icon={c.icon} />
                <div className="min-w-0 flex-1">
                  <p className="font-bold">{c.title}</p>
                  <p className="text-sm text-muted">{c.level[0].toUpperCase() + c.level.slice(1)} · {d}/{plural(ls.length, "lesson")}</p>
                </div>
                {complete ? <CheckCircle2 className="shrink-0 text-good" /> : <span className="btn shrink-0"><PlayCircle size={15} />{d ? "Continue" : "Start"}</span>}
              </Link>
            </li>
          );
        })}
      </ol>

      <h2 className="mb-3 text-lg font-bold">{path.has_final ? "Final assessment" : "Certificate"}</h2>
      <div className="card p-5">
        {cert ? (
          <div className="flex flex-wrap items-center gap-4">
            <Award className="text-good" size={28} />
            <div className="flex-1">
              <p className="font-bold">Certified on {fmtDate(cert.issued_at)}{cert.score != null ? ` · ${cert.score}%` : ""}</p>
              <p className="text-sm text-muted">Certificate {cert.code}</p>
            </div>
            <Link to={`/certificate/${cert.code}`} className="btn-primary">View certificate</Link>
          </div>
        ) : path.has_final ? (
          <>
            <div className="mb-4 flex flex-wrap gap-4 text-sm text-muted">
              <span className="flex items-center gap-1.5"><Target size={15} />Pass mark {path.pass_pct}%</span>
              <span className="flex items-center gap-1.5"><Clock size={15} />{path.time_limit_min ? `${path.time_limit_min} minutes` : "No time limit"}</span>
              <span className="flex items-center gap-1.5"><Repeat size={15} />{left == null ? "Unlimited attempts" : `${left} attempt${left === 1 ? "" : "s"} left`}</span>
              <span>{path.exam_size} questions</span>
            </div>
            {(exams.data ?? []).filter((e) => e.submitted_at).slice(0, 3).map((e) => (
              <p key={e.id} className="mb-1 text-sm text-faint">{fmtDate(e.submitted_at)}: {e.score}/{e.total}{e.passed ? " · passed" : " · not passed"}</p>
            ))}
            {!ready ? (
              <p className="mt-2 flex items-center gap-2 text-sm text-muted"><Lock size={15} />Opens once every lesson above is done.</p>
            ) : left === 0 ? (
              <p className="mt-2 text-sm text-muted">No attempts left. Ask your trainer about another try.</p>
            ) : (
              <Link to={`/exam/${path.id}`} className="btn-primary mt-2">Start the final assessment</Link>
            )}
          </>
        ) : ready ? (
          <button className="btn-primary" onClick={claim} disabled={busy}><Award size={15} />{busy ? "Issuing…" : "Get your certificate"}</button>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted"><Lock size={15} />Finish every lesson to get your certificate.</p>
        )}
        {err && <p className="mt-2 text-sm text-accent-soft">{err}</p>}
      </div>
    </>
  );
}
