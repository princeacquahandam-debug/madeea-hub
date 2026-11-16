import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowLeft, ArrowUp, Plus, Route as RouteIcon, Save, Sparkles, Trash2, X } from "lucide-react";
import { fmtDate, useCourses, usePathCourses, usePaths, usePeople, type AnswerKey, type Audience, type Path, type Question } from "@/lib/api";
import { errText, supabase } from "@/lib/supabase";
import { Empty, Loading, PageTitle } from "@/components/Shell";
import { QuestionList, questionProblems, type DraftQuestion } from "@/components/QuestionEditor";
import { cleanQuestion } from "./CourseEditor";

export function PathList() {
  const paths = usePaths();
  const pcs = usePathCourses();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  if (paths.isLoading) return <Loading />;

  const create = async () => {
    const { data, error } = await supabase.from("acad_paths").insert({ title: "New learning path" }).select("id").single();
    if (error) { setErr(errText(error)); return; }
    await qc.invalidateQueries({ queryKey: ["paths"] });
    nav(`/studio/paths/${data.id}`);
  };

  return (
    <>
      <PageTitle title="Learning paths" sub="A path groups courses, adds an optional final assessment, and decides who it's for."
        actions={<button className="btn-primary" onClick={create}><Plus size={15} />New learning path</button>} />
      {err && <p className="mb-4 text-sm text-accent-soft">{err}</p>}
      {!paths.data?.length ? <Empty icon={RouteIcon} title="No learning paths yet">Publish a course, then create a path and assign it.</Empty> : (
        <div className="grid gap-3 md:grid-cols-2">
          {paths.data.map((p) => (
            <Link key={p.id} to={`/studio/paths/${p.id}`} className="card flex flex-col gap-1.5 p-4 hover:border-accent">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  {p.kind && <p className="text-xs font-semibold uppercase tracking-wide text-faint">{p.kind}</p>}
                  <p className="font-bold">{p.title}</p>
                </div>
                <span className={p.status === "published" ? "chip-good" : "chip"}>{p.status === "published" ? "Live" : "Draft"}</span>
              </div>
              <p className="text-sm text-muted">
                {(pcs.data ?? []).filter((x) => x.path_id === p.id).length} courses · {p.has_final ? `final assessment, pass ${p.pass_pct}%` : "no final assessment"} · {p.audience === "all" ? "everyone" : "selected people"}
              </p>
              <p className="text-xs text-faint">Updated {fmtDate(p.updated_at)}</p>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

interface PDraft { path: Path; courseIds: string[]; audience: Audience[]; bank: DraftQuestion[] }

async function loadPath(id: string): Promise<PDraft | null> {
  const { data: path } = await supabase.from("acad_paths").select("*").eq("id", id).maybeSingle();
  if (!path) return null;
  const [pc, au, qs] = await Promise.all([
    supabase.from("acad_path_courses").select("*").eq("path_id", id).order("position"),
    supabase.from("acad_path_audience").select("*").eq("path_id", id),
    supabase.from("acad_questions").select("*").eq("path_id", id).order("position"),
  ]);
  const questions = (qs.data as Question[]) ?? [];
  const keys = questions.length ? ((await supabase.from("acad_answer_keys").select("*").in("question_id", questions.map((q) => q.id))).data as AnswerKey[]) ?? [] : [];
  const keyOf = new Map(keys.map((k) => [k.question_id, k]));
  return {
    path: path as Path,
    courseIds: ((pc.data as { course_id: string }[]) ?? []).map((x) => x.course_id),
    audience: (au.data as Audience[]) ?? [],
    bank: questions.map((q) => ({ id: q.id, kind: "choice", prompt: q.prompt, choices: q.choices, explanation: q.explanation ?? "", difficulty: q.difficulty,
      correct_index: keyOf.get(q.id)?.correct_index ?? null, model_answer: "" })),
  };
}

/**
 * Learning path editor (Abder, 16 Nov): pick courses; optional final
 * assessment with pass mark, time limit and attempts; a question bank by
 * difficulty that each attempt draws from at random; who it's for.
 */
export function PathEditor() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const courses = useCourses();
  const people = usePeople();
  const q = useQuery({ queryKey: ["path-draft", id], enabled: !!id, queryFn: () => loadPath(id!), refetchOnWindowFocus: false });
  const [d, setD] = useState<PDraft | null>(null);
  const [orig, setOrig] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [aud, setAud] = useState({ kind: "user" as Audience["kind"], value: "" });

  useEffect(() => { if (q.data) { setD(q.data); setOrig(JSON.stringify(q.data)); } }, [q.data]);
  const dirty = useMemo(() => !!d && JSON.stringify(d) !== orig, [d, orig]);
  const regions = useMemo(() => [...new Set((people.data ?? []).map((p) => p.region).filter(Boolean) as string[])], [people.data]);
  const teams = useMemo(() => [...new Set((people.data ?? []).map((p) => p.team).filter(Boolean) as string[])], [people.data]);

  if (q.isLoading || courses.isLoading || (!d && q.data)) return <Loading />;
  if (!d) return <p className="py-16 text-center text-muted">Learning path not found.</p>;
  const p = d.path;
  const setP = (patch: Partial<Path>) => setD({ ...d, path: { ...p, ...patch } });
  const all = courses.data ?? [];
  const chosen = d.courseIds.map((cid) => all.find((c) => c.id === cid)).filter((c): c is NonNullable<typeof c> => !!c);
  const available = all.filter((c) => !d.courseIds.includes(c.id));
  const counts = { easy: 0, medium: 0, hard: 0 };
  d.bank.forEach((b) => counts[b.difficulty]++);
  // Name plus email: two accounts can share a name (16 Nov testing).
  const personName = (uid: string) => { const x = people.data?.find((y) => y.user_id === uid); return x ? `${x.name} (${x.email})` : "Someone"; };

  const save = async (status?: "draft" | "published") => {
    if (!p.title.trim()) { setMsg({ ok: false, text: "The path needs a title." }); return; }
    for (const b of d.bank) { const pr = questionProblems(b); if (pr) { setMsg({ ok: false, text: `Question bank: ${pr}.` }); return; } }
    const next = status ?? p.status;
    if (next === "published") {
      if (!chosen.length) { setMsg({ ok: false, text: "Add at least one course before publishing." }); return; }
      const drafts = chosen.filter((c) => c.status !== "published");
      if (drafts.length) { setMsg({ ok: false, text: `Publish these courses first: ${drafts.map((c) => c.title).join(", ")}.` }); return; }
      if (p.has_final && d.bank.length < p.exam_size) { setMsg({ ok: false, text: `The final assessment asks ${p.exam_size} questions but the bank has ${d.bank.length}. Add more or lower the number.` }); return; }
      if (p.audience === "selected" && !d.audience.length) { setMsg({ ok: false, text: "Choose who this path is for, or set it to everyone." }); return; }
    }
    setBusy(true); setMsg(null);
    try {
      const before = q.data!;
      const { error: pe } = await supabase.from("acad_paths").update({
        title: p.title.trim(), kind: p.kind?.trim() || null, description: p.description?.trim() || null, status: next,
        has_final: p.has_final, pass_pct: p.pass_pct, time_limit_min: p.time_limit_min, attempts_allowed: p.attempts_allowed,
        exam_size: p.exam_size, audience: p.audience, due_days: p.due_days, updated_at: new Date().toISOString(),
        published_at: next === "published" ? p.published_at ?? new Date().toISOString() : p.published_at,
      }).eq("id", p.id);
      if (pe) throw pe;

      const { error: dc } = await supabase.from("acad_path_courses").delete().eq("path_id", p.id);
      if (dc) throw dc;
      if (d.courseIds.length) {
        const { error } = await supabase.from("acad_path_courses").insert(d.courseIds.map((course_id, i) => ({ path_id: p.id, course_id, position: i })));
        if (error) throw error;
      }
      const { error: da } = await supabase.from("acad_path_audience").delete().eq("path_id", p.id);
      if (da) throw da;
      if (p.audience === "selected" && d.audience.length) {
        const { error } = await supabase.from("acad_path_audience").insert(d.audience.map((a) => ({ ...a, path_id: p.id })));
        if (error) throw error;
      }
      const keep = new Set(d.bank.map((b) => b.id));
      const gone = before.bank.filter((b) => !keep.has(b.id)).map((b) => b.id);
      if (gone.length) { const { error } = await supabase.from("acad_questions").delete().in("id", gone); if (error) throw error; }
      if (d.bank.length) {
        const rows = d.bank.map((b, i) => ({ b, i, c: cleanQuestion(b) }));
        const { error } = await supabase.from("acad_questions").upsert(rows.map(({ b, i, c }) => ({
          id: b.id, module_id: null, path_id: p.id, kind: "choice", prompt: b.prompt.trim(), choices: c.choices,
          explanation: b.explanation.trim() || null, difficulty: b.difficulty, position: i,
        })));
        if (error) throw error;
        const { error: ke } = await supabase.from("acad_answer_keys").upsert(rows.map(({ b, c }) => ({ question_id: b.id, correct_index: c.correct_index, model_answer: null })));
        if (ke) throw ke;
      }
      await qc.invalidateQueries();
      const fresh = await loadPath(p.id);
      if (fresh) { setD(fresh); setOrig(JSON.stringify(fresh)); }
      setMsg({ ok: true, text: next === "published" ? "Live. It now shows on the learners' overview." : status === "draft" ? "Taken offline (draft)." : "Saved." });
    } catch (e) {
      setMsg({ ok: false, text: errText(e) });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm(`Delete "${p.title}"? Certificates and exam results for it go too.`)) return;
    const { error } = await supabase.from("acad_paths").delete().eq("id", p.id);
    if (error) { setMsg({ ok: false, text: errText(error) }); return; }
    await qc.invalidateQueries();
    nav("/studio/paths");
  };

  const num = (v: string, min: number, max: number) => { const n = Number(v); return v === "" || !Number.isFinite(n) ? null : Math.min(max, Math.max(min, Math.round(n))); };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link to="/studio/paths" className="btn-ghost -ml-2"><ArrowLeft size={15} />Learning paths</Link>
        <span className={p.status === "published" ? "chip-good" : "chip"}>{p.status === "published" ? "Live" : "Draft"}</span>
        {dirty && <span className="chip-warn">Unsaved changes</span>}
        <div className="flex-1" />
        <button className="btn" onClick={() => save()} disabled={busy || !dirty}><Save size={15} />{busy ? "Saving…" : "Save"}</button>
        {p.status === "published"
          ? <button className="btn" onClick={() => save("draft")} disabled={busy}>Take offline</button>
          : <button className="btn-primary" onClick={() => save("published")} disabled={busy}>Save and publish</button>}
      </div>
      {msg && <p className={`mb-4 rounded-lg px-3 py-2 text-sm ${msg.ok ? "bg-good/15 text-good" : "bg-accent/15 text-accent-soft"}`}>{msg.text}</p>}

      <section className="card mb-4 space-y-3 p-5">
        <div className="grid gap-3 md:grid-cols-[1fr_14rem]">
          <div>
            <label className="label" htmlFor="pt">Title</label>
            <input id="pt" className="input !h-11 text-lg font-bold" value={p.title} onChange={(e) => setP({ title: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="pk">Type</label>
            <input id="pk" className="input !h-11" list="path-kinds" placeholder="e.g. Onboarding" value={p.kind ?? ""} onChange={(e) => setP({ kind: e.target.value })} />
            <datalist id="path-kinds"><option value="Onboarding" /><option value="Client ready" /><option value="Skills" /><option value="Compliance" /><option value="Refresher" /></datalist>
          </div>
        </div>
        <div>
          <label className="label" htmlFor="pd">Description</label>
          <textarea id="pd" className="textarea" rows={2} value={p.description ?? ""} onChange={(e) => setP({ description: e.target.value })} />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-muted" htmlFor="due">Due within</label>
          <input id="due" type="number" min={1} max={365} className="input !h-8 !w-20" placeholder="—" value={p.due_days ?? ""} onChange={(e) => setP({ due_days: num(e.target.value, 1, 365) })} />
          <span className="text-sm text-muted">days (optional)</span>
        </div>
      </section>

      <section className="card mb-4 p-5">
        <h2 className="mb-3 font-bold">Courses, in order</h2>
        {chosen.length === 0 && <p className="mb-3 text-sm text-muted">No courses yet.</p>}
        <ol className="mb-3 space-y-1.5">
          {chosen.map((c, i) => (
            <li key={c.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
              <span className="w-5 text-faint">{i + 1}</span>
              <span className="flex-1 font-semibold">{c.title}</span>
              {c.status !== "published" && <span className="chip-warn">Draft</span>}
              <button className="btn-ghost !h-7" disabled={i === 0} aria-label="Move up" onClick={() => { const n = [...d.courseIds]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; setD({ ...d, courseIds: n }); }}><ArrowUp size={14} /></button>
              <button className="btn-ghost !h-7" disabled={i === chosen.length - 1} aria-label="Move down" onClick={() => { const n = [...d.courseIds]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; setD({ ...d, courseIds: n }); }}><ArrowDown size={14} /></button>
              <button className="btn-ghost !h-7" aria-label="Remove" onClick={() => setD({ ...d, courseIds: d.courseIds.filter((x) => x !== c.id) })}><X size={14} /></button>
            </li>
          ))}
        </ol>
        {available.length > 0 && (
          <select className="input !w-auto" value="" onChange={(e) => e.target.value && setD({ ...d, courseIds: [...d.courseIds, e.target.value] })}>
            <option value="">+ Add a course…</option>
            {available.map((c) => <option key={c.id} value={c.id}>{c.title}{c.status !== "published" ? " (draft)" : ""}</option>)}
          </select>
        )}
      </section>

      <section className="card mb-4 p-5">
        <label className="flex items-center gap-2 font-bold">
          <input type="checkbox" checked={p.has_final} onChange={(e) => setP({ has_final: e.target.checked })} />
          Final assessment
        </label>
        <p className="mb-3 mt-1 text-sm text-muted">{p.has_final ? "Unlocks when every lesson is done. Each attempt draws its questions at random from the bank below, spread across easy, medium and hard." : "Without one, learners get their certificate as soon as every lesson is done."}</p>
        {p.has_final && (
          <>
            <div className="mb-4 grid gap-3 sm:grid-cols-4">
              <div><label className="label">Pass mark (%)</label><input type="number" min={1} max={100} className="input" value={p.pass_pct} onChange={(e) => setP({ pass_pct: num(e.target.value, 1, 100) ?? 80 })} /></div>
              <div><label className="label">Questions per attempt</label><input type="number" min={1} max={200} className="input" value={p.exam_size} onChange={(e) => setP({ exam_size: num(e.target.value, 1, 200) ?? 20 })} /></div>
              <div><label className="label">Time limit (minutes)</label><input type="number" min={1} max={600} className="input" placeholder="None" value={p.time_limit_min ?? ""} onChange={(e) => setP({ time_limit_min: num(e.target.value, 1, 600) })} /></div>
              <div><label className="label">Attempts allowed</label><input type="number" min={1} max={50} className="input" placeholder="Unlimited" value={p.attempts_allowed ?? ""} onChange={(e) => setP({ attempts_allowed: num(e.target.value, 1, 50) })} /></div>
            </div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h3 className="font-bold">Question bank</h3>
              <span className="chip">{d.bank.length} questions</span>
              <span className="text-xs text-faint">easy {counts.easy} · medium {counts.medium} · hard {counts.hard}</span>
              <div className="flex-1" />
              <button className="btn" disabled title="Arrives once Abder's AI flow is in: generate a large bank from the path's courses"><Sparkles size={14} />Generate with AI · soon</button>
            </div>
            {d.bank.length < p.exam_size && <p className="mb-2 text-sm text-warn">The bank needs at least {p.exam_size} questions (one attempt's worth). A bank several times bigger keeps attempts different.</p>}
            <QuestionList items={d.bank} onChange={(bank) => setD({ ...d, bank })} allowText={false} showDifficulty />
          </>
        )}
      </section>

      <section className="card mb-4 p-5">
        <h2 className="mb-3 font-bold">Who it's for</h2>
        <div className="mb-3 flex gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="radio" checked={p.audience === "all"} onChange={() => setP({ audience: "all" })} />Everyone in the Academy</label>
          <label className="flex items-center gap-2"><input type="radio" checked={p.audience === "selected"} onChange={() => setP({ audience: "selected" })} />Selected people, regions or teams</label>
        </div>
        {p.audience === "selected" && (
          <>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {d.audience.length === 0 && <span className="text-sm text-muted">Nobody chosen yet.</span>}
              {d.audience.map((a) => (
                <span key={`${a.kind}:${a.value}`} className="chip-accent">
                  {a.kind === "user" ? personName(a.value) : `${a.kind === "region" ? "Region" : "Team"}: ${a.value}`}
                  <button aria-label="Remove" onClick={() => setD({ ...d, audience: d.audience.filter((x) => !(x.kind === a.kind && x.value === a.value)) })}><X size={12} /></button>
                </span>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <select className="input !w-auto" value={aud.kind} onChange={(e) => setAud({ kind: e.target.value as Audience["kind"], value: "" })}>
                <option value="user">Person</option><option value="region">Region</option><option value="team">Team</option>
              </select>
              {aud.kind === "user" ? (
                <select className="input !w-auto" value={aud.value} onChange={(e) => setAud({ ...aud, value: e.target.value })}>
                  <option value="">Choose…</option>
                  {(people.data ?? []).filter((x) => !d.audience.some((a) => a.kind === "user" && a.value === x.user_id)).map((x) => <option key={x.user_id} value={x.user_id}>{x.name} ({x.email})</option>)}
                </select>
              ) : (
                <input className="input !w-48" list={`aud-${aud.kind}`} placeholder={aud.kind === "region" ? "e.g. UK" : "e.g. Operations"} value={aud.value} onChange={(e) => setAud({ ...aud, value: e.target.value })} />
              )}
              <datalist id="aud-region">{regions.map((r) => <option key={r} value={r} />)}</datalist>
              <datalist id="aud-team">{teams.map((t) => <option key={t} value={t} />)}</datalist>
              <button className="btn" disabled={!aud.value.trim()} onClick={() => {
                const v = aud.value.trim();
                if (!d.audience.some((a) => a.kind === aud.kind && a.value.toLowerCase() === v.toLowerCase())) setD({ ...d, audience: [...d.audience, { path_id: p.id, kind: aud.kind, value: v }] });
                setAud({ ...aud, value: "" });
              }}><Plus size={14} />Add</button>
            </div>
            <p className="mt-2 text-xs text-faint">Regions and teams are set per person on the Learners page.</p>
          </>
        )}
      </section>

      <button className="btn-ghost text-accent-soft" onClick={remove}><Trash2 size={14} />Delete learning path</button>
    </>
  );
}
