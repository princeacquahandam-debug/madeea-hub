import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowLeft, ArrowUp, ChevronDown, ChevronRight, Eye, Layers, ListChecks, Plus, Save, Trash2, Upload } from "lucide-react";
import { LEVELS, fetchCourseTree, type AnswerKey, type Block, type Course, type Level } from "@/lib/api";
import { errText, mediaUrl, supabase, uploadMedia } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { BlockEditor } from "@/components/BlockEditor";
import { QuestionList, questionProblems, type DraftQuestion } from "@/components/QuestionEditor";
import { ICONS, CourseIcon } from "@/components/CourseIcon";
import { Loading } from "@/components/Shell";

interface DLesson { id: string; title: string; minutes: number; blocks: Block[] }
interface DCard { id: string; front: string; back: string }
interface DModule { id: string; title: string; pass_pct: number; lessons: DLesson[]; cards: DCard[]; questions: DraftQuestion[] }
interface Draft { course: Course; modules: DModule[] }

const newLesson = (n: number): DLesson => ({ id: crypto.randomUUID(), title: `Lesson ${n}`, minutes: 10, blocks: [{ type: "text", md: "" }] });
const newModule = (n: number): DModule => ({ id: crypto.randomUUID(), title: `Module ${n}`, pass_pct: 70, lessons: [newLesson(1)], cards: [], questions: [] });

async function loadDraft(id: string): Promise<Draft | null> {
  const tree = await fetchCourseTree(id);
  if (!tree) return null;
  const qids = tree.modules.flatMap((m) => m.questions.map((q) => q.id));
  const keys: AnswerKey[] = qids.length
    ? ((await supabase.from("acad_answer_keys").select("*").in("question_id", qids)).data as AnswerKey[]) ?? []
    : [];
  const keyOf = new Map(keys.map((k) => [k.question_id, k]));
  return {
    course: tree.course,
    modules: tree.modules.map((m) => ({
      id: m.id, title: m.title, pass_pct: m.pass_pct,
      lessons: m.lessons.map((l) => ({ id: l.id, title: l.title, minutes: l.minutes, blocks: l.blocks })),
      cards: m.flashcards.map((f) => ({ id: f.id, front: f.front, back: f.back })),
      questions: m.questions.map((q) => ({
        id: q.id, kind: q.kind, prompt: q.prompt, choices: q.choices, explanation: q.explanation ?? "", difficulty: q.difficulty,
        correct_index: keyOf.get(q.id)?.correct_index ?? null, model_answer: keyOf.get(q.id)?.model_answer ?? "",
      })),
    })),
  };
}

/** Clean empty answers out of a choice question, keeping the right one ticked. */
export function cleanQuestion(q: DraftQuestion) {
  if (q.kind !== "choice") return { choices: [] as string[], correct_index: null as number | null };
  const kept = q.choices.map((c, i) => ({ c: c.trim(), i })).filter((x) => x.c);
  const ci = kept.findIndex((x) => x.i === q.correct_index);
  return { choices: kept.map((x) => x.c), correct_index: ci < 0 ? null : ci };
}

/**
 * The manual course builder (Abder, 16 Nov): title, description, level, icon;
 * modules with lessons (text, images, videos, tables), flashcards and a quiz;
 * preview; save and publish. Everything is edited locally and saved together.
 */
export default function CourseEditor() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { me } = useAuth();
  const q = useQuery({ queryKey: ["course-draft", id], enabled: !!id, queryFn: () => loadDraft(id!), refetchOnWindowFocus: false });
  const [d, setD] = useState<Draft | null>(null);
  const [orig, setOrig] = useState<string>("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (q.data) { setD(q.data); setOrig(JSON.stringify(q.data)); if (q.data.modules[0]) setOpen({ [q.data.modules[0].id]: true }); }
  }, [q.data]);

  const dirty = useMemo(() => !!d && JSON.stringify(d) !== orig, [d, orig]);
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  if (q.isLoading || (!d && q.data)) return <Loading />;
  if (!d) return <p className="py-16 text-center text-muted">Course not found.</p>;
  const ws = me?.workspace_id ?? d.course.workspace_id;

  const setCourse = (patch: Partial<Course>) => setD({ ...d, course: { ...d.course, ...patch } });
  const setModule = (i: number, patch: Partial<DModule>) => setD({ ...d, modules: d.modules.map((m, j) => (j === i ? { ...m, ...patch } : m)) });
  const moveModule = (i: number, dir: -1 | 1) => {
    const j = i + dir; if (j < 0 || j >= d.modules.length) return;
    const n = [...d.modules]; [n[i], n[j]] = [n[j], n[i]]; setD({ ...d, modules: n });
  };

  const problems = (): string | null => {
    if (!d.course.title.trim()) return "The course needs a title.";
    for (const m of d.modules) {
      if (!m.title.trim()) return "Every module needs a title.";
      for (const l of m.lessons) if (!l.title.trim()) return `A lesson in "${m.title}" has no title.`;
      for (const c of m.cards) if (!c.front.trim() || !c.back.trim()) return `A flashcard in "${m.title}" is missing a side.`;
      for (const x of m.questions) { const p = questionProblems(x); if (p) return `In "${m.title}", ${p}.`; }
    }
    return null;
  };

  const save = async (status?: "draft" | "published") => {
    const p = problems();
    if (p) { setMsg({ ok: false, text: p }); return false; }
    if (status === "published" && !d.modules.some((m) => m.lessons.length)) { setMsg({ ok: false, text: "Add at least one lesson before publishing." }); return false; }
    setBusy(true); setMsg(null);
    try {
      const before = q.data!;
      const c = d.course;
      const nextStatus = status ?? c.status;
      const { error: ce } = await supabase.from("acad_courses").update({
        title: c.title.trim(), description: c.description?.trim() || null, level: c.level, icon: c.icon, cover_path: c.cover_path,
        status: nextStatus, updated_at: new Date().toISOString(),
        published_at: nextStatus === "published" ? c.published_at ?? new Date().toISOString() : c.published_at,
      }).eq("id", c.id);
      if (ce) throw ce;

      // removals first (modules cascade to their lessons, cards and questions)
      const keepM = new Set(d.modules.map((m) => m.id));
      const goneM = before.modules.filter((m) => !keepM.has(m.id)).map((m) => m.id);
      if (goneM.length) { const { error } = await supabase.from("acad_modules").delete().in("id", goneM); if (error) throw error; }
      const idsOf = (m: DModule, kind: "lessons" | "cards" | "questions") => (m[kind] as { id: string }[]).map((x) => x.id);
      const gone = (kind: "lessons" | "cards" | "questions") => {
        const keep = new Set(d.modules.flatMap((m) => idsOf(m, kind)));
        return before.modules.filter((m) => keepM.has(m.id)).flatMap((m) => idsOf(m, kind)).filter((x) => !keep.has(x));
      };
      for (const [table, ids] of [["acad_lessons", gone("lessons")], ["acad_flashcards", gone("cards")], ["acad_questions", gone("questions")]] as const) {
        if (ids.length) { const { error } = await supabase.from(table).delete().in("id", ids); if (error) throw error; }
      }

      if (d.modules.length) {
        const { error } = await supabase.from("acad_modules").upsert(d.modules.map((m, i) => ({ id: m.id, course_id: c.id, title: m.title.trim(), pass_pct: m.pass_pct, position: i })));
        if (error) throw error;
      }
      const lessons = d.modules.flatMap((m) => m.lessons.map((l, i) => ({ id: l.id, module_id: m.id, title: l.title.trim(), minutes: l.minutes, position: i,
        blocks: l.blocks.filter((b) => (b.type === "text" ? b.md.trim() : b.type === "image" ? b.path : b.type === "video" ? b.url?.trim() || b.path : b.rows.some((r) => r.some((x) => x.trim())))) })));
      if (lessons.length) { const { error } = await supabase.from("acad_lessons").upsert(lessons); if (error) throw error; }
      const cards = d.modules.flatMap((m) => m.cards.map((f, i) => ({ id: f.id, module_id: m.id, front: f.front.trim(), back: f.back.trim(), position: i })));
      if (cards.length) { const { error } = await supabase.from("acad_flashcards").upsert(cards); if (error) throw error; }
      const qs = d.modules.flatMap((m) => m.questions.map((x, i) => ({ x, m, i, clean: cleanQuestion(x) })));
      if (qs.length) {
        const { error } = await supabase.from("acad_questions").upsert(qs.map(({ x, m, i, clean }) => ({
          id: x.id, module_id: m.id, path_id: null, kind: x.kind, prompt: x.prompt.trim(), choices: clean.choices,
          explanation: x.explanation.trim() || null, difficulty: x.difficulty, position: i,
        })));
        if (error) throw error;
        const { error: ke } = await supabase.from("acad_answer_keys").upsert(qs.map(({ x, clean }) => ({
          question_id: x.id, correct_index: clean.correct_index, model_answer: x.kind === "text" ? x.model_answer.trim() || null : null,
        })));
        if (ke) throw ke;
      }
      await qc.invalidateQueries();
      const fresh = await loadDraft(c.id);
      if (fresh) { setD(fresh); setOrig(JSON.stringify(fresh)); }
      setMsg({ ok: true, text: status === "published" ? "Published. Add it to a learning path so learners can see it." : status === "draft" ? "Moved back to draft." : "Saved." });
      return true;
    } catch (e) {
      setMsg({ ok: false, text: errText(e) });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm(`Delete "${d.course.title}" and everything in it? Learners' progress on it goes too.`)) return;
    const { error } = await supabase.from("acad_courses").delete().eq("id", d.course.id);
    if (error) { setMsg({ ok: false, text: errText(error) }); return; }
    await qc.invalidateQueries();
    nav("/studio/courses");
  };

  const lessonsTotal = d.modules.reduce((s, m) => s + m.lessons.length, 0);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link to="/studio/courses" className="btn-ghost -ml-2"><ArrowLeft size={15} />Courses</Link>
        <span className={d.course.status === "published" ? "chip-good" : "chip"}>{d.course.status === "published" ? "Published" : "Draft"}</span>
        {dirty && <span className="chip-warn">Unsaved changes</span>}
        <div className="flex-1" />
        <button className="btn" onClick={async () => { if (!dirty || (await save())) nav(`/studio/courses/${d.course.id}/preview`); }} disabled={busy}><Eye size={15} />Preview</button>
        <button className="btn" onClick={() => save()} disabled={busy || !dirty}><Save size={15} />{busy ? "Saving…" : "Save"}</button>
        {d.course.status === "published"
          ? <button className="btn" onClick={() => save("draft")} disabled={busy}>Unpublish</button>
          : <button className="btn-primary" onClick={() => save("published")} disabled={busy}>Save and publish</button>}
      </div>
      {msg && <p className={`mb-4 rounded-lg px-3 py-2 text-sm ${msg.ok ? "bg-good/15 text-good" : "bg-accent/15 text-accent-soft"}`}>{msg.text}</p>}

      <section className="card mb-5 p-5">
        <div className="grid gap-4 md:grid-cols-[1fr_14rem]">
          <div className="space-y-3">
            <div>
              <label className="label" htmlFor="ct">Course title</label>
              <input id="ct" className="input !h-11 text-lg font-bold" value={d.course.title} onChange={(e) => setCourse({ title: e.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor="cd">Description</label>
              <textarea id="cd" className="textarea" rows={3} value={d.course.description ?? ""} onChange={(e) => setCourse({ description: e.target.value })}
                placeholder="What the learner will be able to do after this course" />
            </div>
            <div className="flex flex-wrap gap-3">
              <div>
                <label className="label" htmlFor="cl">Level</label>
                <select id="cl" className="input !w-auto" value={d.course.level} onChange={(e) => setCourse({ level: e.target.value as Level })}>
                  {LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                </select>
              </div>
              <div>
                <p className="label">Icon</p>
                <div className="flex flex-wrap gap-1">
                  {Object.keys(ICONS).map((k) => (
                    <button key={k} onClick={() => setCourse({ icon: k })} className={`rounded-xl ${d.course.icon === k ? "ring-2 ring-accent" : "opacity-60 hover:opacity-100"}`} title={k} aria-label={`Icon ${k}`}>
                      <CourseIcon icon={k} size="sm" />
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <CoverPicker path={d.course.cover_path} ws={ws} onChange={(p) => setCourse({ cover_path: p })} />
        </div>
        <p className="mt-3 text-xs text-faint">{d.modules.length} module{d.modules.length === 1 ? "" : "s"} · {lessonsTotal} lesson{lessonsTotal === 1 ? "" : "s"}</p>
      </section>

      <div className="space-y-3">
        {d.modules.map((m, mi) => {
          const isOpen = !!open[m.id];
          return (
            <section key={m.id} className="card">
              <div className="flex items-center gap-2 p-3">
                <button className="btn-ghost" onClick={() => setOpen({ ...open, [m.id]: !isOpen })} aria-label={isOpen ? "Collapse" : "Expand"}>
                  {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </button>
                <span className="text-xs font-semibold text-faint">Module {mi + 1}</span>
                <input className="input !h-9 flex-1 font-semibold" value={m.title} onChange={(e) => setModule(mi, { title: e.target.value })} />
                <span className="hidden text-xs text-faint sm:inline">{m.lessons.length} lessons · {m.cards.length} cards · {m.questions.length} questions</span>
                <button className="btn-ghost" onClick={() => moveModule(mi, -1)} disabled={mi === 0} aria-label="Move module up"><ArrowUp size={14} /></button>
                <button className="btn-ghost" onClick={() => moveModule(mi, 1)} disabled={mi === d.modules.length - 1} aria-label="Move module down"><ArrowDown size={14} /></button>
                <button className="btn-ghost" aria-label="Remove module" onClick={() => { if (confirm(`Remove "${m.title}" and its lessons?`)) setD({ ...d, modules: d.modules.filter((_, j) => j !== mi) }); }}><Trash2 size={14} /></button>
              </div>
              {isOpen && (
                <div className="space-y-5 border-t border-border p-4">
                  {m.lessons.map((l, li) => (
                    <LessonCard key={l.id} lesson={l} n={li + 1} total={m.lessons.length} ws={ws}
                      onChange={(nl) => setModule(mi, { lessons: m.lessons.map((x, j) => (j === li ? nl : x)) })}
                      onMove={(dir) => { const j = li + dir; if (j < 0 || j >= m.lessons.length) return; const n = [...m.lessons]; [n[li], n[j]] = [n[j], n[li]]; setModule(mi, { lessons: n }); }}
                      onRemove={() => setModule(mi, { lessons: m.lessons.filter((_, j) => j !== li) })} />
                  ))}
                  <button className="btn" onClick={() => setModule(mi, { lessons: [...m.lessons, newLesson(m.lessons.length + 1)] })}><Plus size={14} />Add a lesson</button>

                  <div>
                    <h3 className="mb-2 flex items-center gap-2 font-bold"><Layers size={16} />Flashcards</h3>
                    <div className="space-y-2">
                      {m.cards.map((c, ci) => (
                        <div key={c.id} className="flex flex-wrap items-start gap-2">
                          <textarea className="textarea min-w-[12rem] flex-1" rows={2} placeholder="Front (question)" value={c.front}
                            onChange={(e) => setModule(mi, { cards: m.cards.map((x, j) => (j === ci ? { ...x, front: e.target.value } : x)) })} />
                          <textarea className="textarea min-w-[12rem] flex-1" rows={2} placeholder="Back (answer)" value={c.back}
                            onChange={(e) => setModule(mi, { cards: m.cards.map((x, j) => (j === ci ? { ...x, back: e.target.value } : x)) })} />
                          <button className="btn-ghost" aria-label="Remove card" onClick={() => setModule(mi, { cards: m.cards.filter((_, j) => j !== ci) })}><Trash2 size={14} /></button>
                        </div>
                      ))}
                    </div>
                    <button className="btn mt-2" onClick={() => setModule(mi, { cards: [...m.cards, { id: crypto.randomUUID(), front: "", back: "" }] })}><Plus size={14} />Add a flashcard</button>
                  </div>

                  <div>
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <h3 className="flex items-center gap-2 font-bold"><ListChecks size={16} />Quiz</h3>
                      <span className="text-xs text-faint">Pass mark</span>
                      <input type="number" min={1} max={100} className="input !h-8 !w-20" value={m.pass_pct}
                        onChange={(e) => setModule(mi, { pass_pct: Math.min(100, Math.max(1, Number(e.target.value) || 70)) })} />
                      <span className="text-xs text-faint">%</span>
                    </div>
                    <QuestionList items={m.questions} onChange={(qs) => setModule(mi, { questions: qs })} />
                  </div>
                </div>
              )}
            </section>
          );
        })}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button className="btn" onClick={() => { const nm = newModule(d.modules.length + 1); setD({ ...d, modules: [...d.modules, nm] }); setOpen({ ...open, [nm.id]: true }); }}>
          <Plus size={14} />Add a module
        </button>
        <div className="flex-1" />
        <button className="btn-ghost text-accent-soft" onClick={remove}><Trash2 size={14} />Delete course</button>
      </div>
    </>
  );
}

function LessonCard({ lesson, n, total, ws, onChange, onMove, onRemove }: {
  lesson: DLesson; n: number; total: number; ws: string; onChange: (l: DLesson) => void; onMove: (d: -1 | 1) => void; onRemove: () => void;
}) {
  const [open, setOpen] = useState(n === 1);
  return (
    <div className="rounded-xl border border-border">
      <div className="flex items-center gap-2 p-2.5">
        <button className="btn-ghost" onClick={() => setOpen(!open)} aria-label={open ? "Collapse lesson" : "Expand lesson"}>{open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</button>
        <span className="text-xs text-faint">Lesson {n}</span>
        <input className="input !h-8 flex-1" value={lesson.title} onChange={(e) => onChange({ ...lesson, title: e.target.value })} />
        <input type="number" min={1} max={600} className="input !h-8 !w-16" value={lesson.minutes} title="Minutes"
          onChange={(e) => onChange({ ...lesson, minutes: Math.min(600, Math.max(1, Number(e.target.value) || 10)) })} />
        <span className="text-xs text-faint">min</span>
        <button className="btn-ghost" onClick={() => onMove(-1)} disabled={n === 1} aria-label="Move lesson up"><ArrowUp size={14} /></button>
        <button className="btn-ghost" onClick={() => onMove(1)} disabled={n === total} aria-label="Move lesson down"><ArrowDown size={14} /></button>
        <button className="btn-ghost" onClick={() => { if (confirm(`Remove "${lesson.title}"?`)) onRemove(); }} aria-label="Remove lesson"><Trash2 size={14} /></button>
      </div>
      {open && <div className="border-t border-border p-3"><BlockEditor blocks={lesson.blocks} workspaceId={ws} onChange={(blocks) => onChange({ ...lesson, blocks })} /></div>}
    </div>
  );
}

function CoverPicker({ path, ws, onChange }: { path: string | null; ws: string; onChange: (p: string | null) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const src = mediaUrl(path);
  return (
    <div>
      <p className="label">Cover image</p>
      <label className="grid aspect-video cursor-pointer place-items-center overflow-hidden rounded-xl border border-dashed border-border bg-bg text-sm text-faint hover:border-accent">
        {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : <span className="flex items-center gap-1.5"><Upload size={14} />{busy ? "Uploading…" : "Upload"}</span>}
        <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
          const f = e.target.files?.[0]; e.target.value = "";
          if (!f) return;
          setBusy(true); setErr(null);
          try { onChange(await uploadMedia(ws, f, "covers")); } catch (x) { setErr(x instanceof Error ? x.message : String(x)); } finally { setBusy(false); }
        }} />
      </label>
      {src && <button className="btn-ghost mt-1" onClick={() => onChange(null)}>Remove cover</button>}
      {err && <p className="mt-1 text-xs text-accent-soft">{err}</p>}
    </div>
  );
}
