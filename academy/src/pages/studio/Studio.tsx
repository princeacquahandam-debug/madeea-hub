import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Award, BookOpen, Copy, Eye, MessageSquare, Pencil, Plus, Route as RouteIcon, Sparkles, Star, Users } from "lucide-react";
import { fmtDate, pct, useCourses, usePathCourses, usePaths, usePeople, type Course } from "@/lib/api";
import { errText, mediaUrl, supabase } from "@/lib/supabase";
import { Empty, Loading, PageTitle } from "@/components/Shell";
import { CourseIcon } from "@/components/CourseIcon";

interface ReviewRow { id: string; course_id: string; course: string; learner: string; rating: number; comment: string | null; created_at: string }
interface PathReport { path_id: string; title: string; assigned: number; started: number; completed: number; avg_score: number | null }

const useReviews = () => useQuery({
  queryKey: ["reviews"],
  queryFn: async () => { const { data, error } = await supabase.rpc("acad_review_list"); if (error) throw error; return data as ReviewRow[]; },
});
const usePathReport = () => useQuery({
  queryKey: ["path-report"],
  queryFn: async () => { const { data, error } = await supabase.rpc("acad_path_report"); if (error) throw error; return data as PathReport[]; },
});

export function useNewCourse() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const create = async () => {
    setErr(null);
    const { data, error } = await supabase.from("acad_courses").insert({ title: "Untitled course" }).select("id").single();
    if (error) { setErr(errText(error)); return; }
    await qc.invalidateQueries({ queryKey: ["courses"] });
    nav(`/studio/courses/${data.id}`);
  };
  return { create, err };
}

function Stars({ n }: { n: number }) {
  return <span className="inline-flex">{[1, 2, 3, 4, 5].map((i) => <Star key={i} size={13} className={i <= Math.round(n) ? "fill-warn text-warn" : "text-faint"} />)}</span>;
}

/** Studio overview: what's happening in the Academy, at a glance. */
export function StudioOverview() {
  const courses = useCourses();
  const paths = usePaths();
  const people = usePeople();
  const reviews = useReviews();
  const { create, err } = useNewCourse();
  if (courses.isLoading || paths.isLoading || people.isLoading) return <Loading />;

  const ppl = people.data ?? [];
  const stuck = ppl.filter((p) => p.lessons_total > 0 && p.lessons_done === 0);
  const avg = reviews.data?.length ? reviews.data.reduce((s, r) => s + r.rating, 0) / reviews.data.length : null;
  const tiles = [
    { icon: BookOpen, value: courses.data?.filter((c) => c.status === "published").length ?? 0, label: `published courses · ${courses.data?.filter((c) => c.status === "draft").length ?? 0} drafts`, to: "/studio/courses" },
    { icon: RouteIcon, value: paths.data?.filter((p) => p.status === "published").length ?? 0, label: "live learning paths", to: "/studio/paths" },
    { icon: Users, value: ppl.length, label: `people · ${ppl.filter((p) => p.lessons_done > 0).length} learning`, to: "/studio/learners" },
    { icon: Award, value: ppl.reduce((s, p) => s + p.certificates, 0), label: "certificates issued", to: "/studio/reports" },
  ];

  return (
    <>
      <PageTitle title="Studio" sub="Build courses, group them into learning paths, and see how the team is getting on."
        actions={<>
          <button className="btn" disabled title="Arrives once Abder's AI course flow and prompts are in"><Sparkles size={15} />Create with AI · soon</button>
          <button className="btn-primary" onClick={create}><Plus size={15} />New course</button>
        </>} />
      {err && <p className="mb-4 text-sm text-accent-soft">{err}</p>}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <Link key={t.label} to={t.to} className="card flex items-center gap-3 p-4 hover:border-accent">
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-accent/15 text-accent-soft"><t.icon size={18} /></span>
            <div><p className="text-xl font-extrabold">{t.value}</p><p className="text-xs text-muted">{t.label}</p></div>
          </Link>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card p-4">
          <div className="mb-3 flex items-center"><h2 className="flex-1 font-bold">Not started yet</h2><Link to="/studio/learners" className="btn-ghost">All learners</Link></div>
          {stuck.length === 0 ? <p className="text-sm text-muted">Everyone with a learning path has started.</p> : (
            <ul className="space-y-2">
              {stuck.slice(0, 8).map((p) => (
                <li key={p.user_id} className="flex items-center gap-2 text-sm">
                  <span className="flex-1 truncate">{p.name}</span><span className="text-faint">{p.paths_assigned} path{p.paths_assigned === 1 ? "" : "s"} · 0 of {p.lessons_total} lessons</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card p-4">
          <div className="mb-3 flex items-center gap-2"><h2 className="flex-1 font-bold">Latest reviews</h2>{avg != null && <><Stars n={avg} /><span className="text-sm text-muted">{avg.toFixed(1)}</span></>}</div>
          {!reviews.data?.length ? <p className="text-sm text-muted">Learners rate a course when they finish it. Nothing yet.</p> : (
            <ul className="space-y-3">
              {reviews.data.slice(0, 4).map((r) => (
                <li key={r.id} className="text-sm">
                  <div className="flex items-center gap-2"><Stars n={r.rating} /><span className="font-semibold">{r.course}</span></div>
                  {r.comment && <p className="text-muted">"{r.comment}"</p>}
                  <p className="text-xs text-faint">{r.learner} · {fmtDate(r.created_at)}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

/** Courses list: view, edit, preview, duplicate. */
export function CourseList() {
  const courses = useCourses();
  const pcs = usePathCourses();
  const paths = usePaths();
  const qc = useQueryClient();
  const nav = useNavigate();
  const { create, err } = useNewCourse();
  const [filter, setFilter] = useState<"all" | "published" | "draft">("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  if (courses.isLoading) return <Loading />;

  const list = (courses.data ?? []).filter((c) => filter === "all" || c.status === filter);
  const inPaths = (c: Course) => (pcs.data ?? []).filter((pc) => pc.course_id === c.id).map((pc) => paths.data?.find((p) => p.id === pc.path_id)?.title).filter(Boolean);

  const duplicate = async (c: Course) => {
    setBusyId(c.id);
    const { data, error } = await supabase.rpc("acad_duplicate_course", { p_course: c.id });
    setBusyId(null);
    if (error) { alert(errText(error)); return; }
    await qc.invalidateQueries({ queryKey: ["courses"] });
    nav(`/studio/courses/${data}`);
  };

  return (
    <>
      <PageTitle title="Courses" sub="Build a course by hand: modules, lessons with text, images, videos and tables, flashcards and quizzes."
        actions={<>
          <button className="btn" disabled title="Arrives once Abder's AI course flow and prompts are in"><Sparkles size={15} />Create with AI · soon</button>
          <button className="btn-primary" onClick={create}><Plus size={15} />New course</button>
        </>} />
      {err && <p className="mb-4 text-sm text-accent-soft">{err}</p>}
      <div className="mb-4 flex gap-1">
        {(["all", "published", "draft"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`rounded-md px-3 py-1.5 text-sm ${filter === f ? "bg-surface-2 font-semibold" : "text-muted hover:bg-surface-2"}`}>
            {f === "all" ? "All" : f === "published" ? "Published" : "Drafts"}
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        <Empty icon={BookOpen} title="No courses here yet">Start with "New course".</Empty>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {list.map((c) => {
            const cover = mediaUrl(c.cover_path);
            const ps = inPaths(c);
            return (
              <div key={c.id} className="card flex flex-col overflow-hidden">
                {cover ? <img src={cover} alt="" className="aspect-video w-full object-cover" /> : <div className="grid aspect-video place-items-center bg-surface-2"><CourseIcon icon={c.icon} size="lg" /></div>}
                <div className="flex flex-1 flex-col gap-2 p-4">
                  <div className="flex items-start gap-2">
                    <p className="flex-1 font-bold">{c.title}</p>
                    <span className={c.status === "published" ? "chip-good" : "chip"}>{c.status === "published" ? "Published" : "Draft"}</span>
                  </div>
                  {c.description && <p className="line-clamp-2 text-sm text-muted">{c.description}</p>}
                  <p className="text-xs text-faint">{c.level[0].toUpperCase() + c.level.slice(1)} · updated {fmtDate(c.updated_at)}{ps.length ? ` · in ${ps.join(", ")}` : " · not in a path yet"}</p>
                  <div className="mt-auto flex gap-1 pt-2">
                    <Link to={`/studio/courses/${c.id}`} className="btn"><Pencil size={14} />Edit</Link>
                    <Link to={`/studio/courses/${c.id}/preview`} className="btn-ghost"><Eye size={14} />Preview</Link>
                    <button className="btn-ghost" onClick={() => duplicate(c)} disabled={busyId === c.id}><Copy size={14} />{busyId === c.id ? "Copying…" : "Duplicate"}</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

/** Reports: paths, courses and people. */
export function Reports() {
  const rep = usePathReport();
  const people = usePeople();
  const reviews = useReviews();
  const courses = useCourses();
  if (rep.isLoading || people.isLoading) return <Loading />;
  const ppl = people.data ?? [];
  const ratingOf = (id: string) => {
    const rs = (reviews.data ?? []).filter((r) => r.course_id === id);
    return rs.length ? { avg: rs.reduce((s, r) => s + r.rating, 0) / rs.length, n: rs.length } : null;
  };

  return (
    <>
      <PageTitle title="Reports" sub="Who has started, who has finished, and how the assessments are going." />
      <section className="card mb-5 overflow-x-auto">
        <table className="w-full min-w-[36rem] text-left text-sm">
          <thead className="bg-surface-2 text-xs text-muted"><tr><th className="px-4 py-2">Learning path</th><th className="px-4 py-2">Assigned</th><th className="px-4 py-2">Started</th><th className="px-4 py-2">Certified</th><th className="px-4 py-2">Avg. exam score</th></tr></thead>
          <tbody>
            {(rep.data ?? []).length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-muted">No live learning paths yet.</td></tr>}
            {(rep.data ?? []).map((r) => (
              <tr key={r.path_id} className="border-t border-border">
                <td className="px-4 py-2.5 font-semibold"><Link to={`/studio/paths/${r.path_id}`} className="hover:underline">{r.title}</Link></td>
                <td className="px-4 py-2.5">{r.assigned}</td>
                <td className="px-4 py-2.5">{r.started} <span className="text-faint">({pct(r.started, r.assigned)}%)</span></td>
                <td className="px-4 py-2.5">{r.completed} <span className="text-faint">({pct(r.completed, r.assigned)}%)</span></td>
                <td className="px-4 py-2.5">{r.avg_score != null ? `${r.avg_score}%` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card p-4">
          <h2 className="mb-3 font-bold">Progress by person</h2>
          <ul className="space-y-2.5">
            {ppl.filter((p) => p.lessons_total > 0).sort((a, b) => pct(b.lessons_done, b.lessons_total) - pct(a.lessons_done, a.lessons_total)).map((p) => (
              <li key={p.user_id} className="text-sm">
                <div className="mb-1 flex"><span className="flex-1 truncate">{p.name}</span><span className="text-faint">{pct(p.lessons_done, p.lessons_total)}%</span></div>
                <div className="bar"><span style={{ width: `${pct(p.lessons_done, p.lessons_total)}%` }} /></div>
              </li>
            ))}
            {!ppl.some((p) => p.lessons_total > 0) && <li className="text-sm text-muted">Nobody has a learning path yet.</li>}
          </ul>
        </section>
        <section className="card p-4">
          <h2 className="mb-3 font-bold">Courses</h2>
          <ul className="space-y-2">
            {(courses.data ?? []).filter((c) => c.status === "published").map((c) => {
              const r = ratingOf(c.id);
              return (
                <li key={c.id} className="flex items-center gap-2 text-sm">
                  <span className="flex-1 truncate">{c.title}</span>
                  {r ? <><Stars n={r.avg} /><span className="text-faint">{r.avg.toFixed(1)} ({r.n})</span></> : <span className="text-faint">no reviews</span>}
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </>
  );
}

/** Reviews: learners' feedback, to improve the content. */
export function Reviews() {
  const reviews = useReviews();
  const [course, setCourse] = useState("");
  if (reviews.isLoading) return <Loading />;
  const all = reviews.data ?? [];
  const courses = [...new Map(all.map((r) => [r.course_id, r.course])).entries()];
  const list = course ? all.filter((r) => r.course_id === course) : all;
  return (
    <>
      <PageTitle title="Reviews" sub="What learners said when they finished a course. Use it to improve the content."
        actions={courses.length > 1 ? (
          <select className="input !w-auto" value={course} onChange={(e) => setCourse(e.target.value)}>
            <option value="">All courses</option>
            {courses.map(([id, t]) => <option key={id} value={id}>{t}</option>)}
          </select>
        ) : undefined} />
      {list.length === 0 ? <Empty icon={MessageSquare} title="No reviews yet">Learners are asked for a rating and a comment at the end of each course.</Empty> : (
        <div className="space-y-3">
          {list.map((r) => (
            <div key={r.id} className="card p-4">
              <div className="flex flex-wrap items-center gap-2"><Stars n={r.rating} /><span className="font-semibold">{r.course}</span><span className="text-xs text-faint">{r.learner} · {fmtDate(r.created_at)}</span></div>
              {r.comment ? <p className="mt-2 text-sm">{r.comment}</p> : <p className="mt-2 text-sm text-faint">No comment.</p>}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
