import { Link } from "react-router-dom";
import { Award, BookOpen, CheckCircle2, PlayCircle, Route as RouteIcon } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { pct, useCourses, useLessonIndex, useMyCertificates, useMyProgress, usePathCourses, usePaths, type Course, type Path } from "@/lib/api";
import { Empty, Loading, PageTitle } from "@/components/Shell";
import { CourseIcon } from "@/components/CourseIcon";

/** Lessons and progress for one path, from the shared indexes. */
export function pathStats(path: Path, pathCourses: { path_id: string; course_id: string; position: number }[], courses: Course[], lessonIndex: Map<string, string[]>, done: Set<string>) {
  const cs = pathCourses
    .filter((pc) => pc.path_id === path.id)
    .sort((a, b) => a.position - b.position)
    .map((pc) => courses.find((c) => c.id === pc.course_id))
    .filter((c): c is Course => !!c && c.status === "published");
  const lessons = cs.flatMap((c) => lessonIndex.get(c.id) ?? []);
  const finished = lessons.filter((l) => done.has(l)).length;
  return { courses: cs, total: lessons.length, done: finished, pct: pct(finished, lessons.length) };
}

export default function Home() {
  const { me } = useAuth();
  const paths = usePaths();
  const pcs = usePathCourses();
  const courses = useCourses();
  const idx = useLessonIndex();
  const prog = useMyProgress();
  const certs = useMyCertificates();

  if (paths.isLoading || pcs.isLoading || courses.isLoading || idx.isLoading || prog.isLoading) return <Loading />;

  const mine = (paths.data ?? []).filter((p) => p.status === "published");
  const stats = mine.map((p) => ({ path: p, ...pathStats(p, pcs.data ?? [], courses.data ?? [], idx.data ?? new Map(), prog.data ?? new Set()) }));
  const certOf = new Set((certs.data ?? []).map((c) => c.path_id));
  const totalLessons = stats.reduce((s, x) => s + x.total, 0);
  const doneLessons = stats.reduce((s, x) => s + x.done, 0);

  // Where to pick up: the first course in an unfinished path with lessons left.
  const resume = stats
    .filter((s) => s.done < s.total)
    .flatMap((s) => s.courses.map((c) => ({ path: s.path, course: c, left: (idx.data?.get(c.id) ?? []).filter((l) => !prog.data?.has(l)).length })))
    .find((x) => x.left > 0);

  const first = (me?.name ?? "").split(" ")[0];

  return (
    <>
      <PageTitle title={first ? `Welcome back, ${first}` : "Welcome"} sub="Your learning paths, what's next, and your certificates." />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Stat icon={RouteIcon} value={mine.length} label="learning paths for you" />
        <Stat icon={CheckCircle2} value={`${pct(doneLessons, totalLessons)}%`} label={`${doneLessons} of ${totalLessons} lessons done`} />
        <Stat icon={Award} value={certs.data?.length ?? 0} label="certificates earned" />
      </div>

      {resume && (
        <Link to={`/learn/${resume.course.id}`} className="card mb-6 flex items-center gap-4 p-4 transition-colors hover:border-accent">
          <CourseIcon icon={resume.course.icon} />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-accent-soft">Continue where you left off</p>
            <p className="truncate font-bold">{resume.course.title}</p>
            <p className="text-sm text-muted">{resume.path.title} · {resume.left} lesson{resume.left === 1 ? "" : "s"} left</p>
          </div>
          <PlayCircle className="shrink-0 text-accent" />
        </Link>
      )}

      <h2 className="mb-3 text-lg font-bold">Your learning paths</h2>
      {stats.length === 0 ? (
        <Empty icon={BookOpen} title="Nothing assigned yet">When a learning path is assigned to you, it shows up here.</Empty>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {stats.map((s) => (
            <Link key={s.path.id} to={`/paths/${s.path.id}`} className="card flex flex-col gap-3 p-4 transition-colors hover:border-accent">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  {s.path.kind && <p className="text-xs font-semibold uppercase tracking-wide text-faint">{s.path.kind}</p>}
                  <p className="font-bold">{s.path.title}</p>
                </div>
                {certOf.has(s.path.id) ? <span className="chip-good"><Award size={12} />Certified</span>
                  : s.pct === 100 ? <span className="chip-accent">{s.path.has_final ? "Final assessment" : "Claim certificate"}</span>
                  : s.done > 0 ? <span className="chip">In progress</span> : <span className="chip">Not started</span>}
              </div>
              {s.path.description && <p className="line-clamp-2 text-sm text-muted">{s.path.description}</p>}
              <div>
                <div className="bar"><span style={{ width: `${s.pct}%` }} /></div>
                <p className="mt-1.5 text-xs text-faint">{s.courses.length} course{s.courses.length === 1 ? "" : "s"} · {s.done}/{s.total} lessons · {s.pct}%</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

function Stat({ icon: Icon, value, label }: { icon: typeof Award; value: string | number; label: string }) {
  return (
    <div className="card flex items-center gap-3 p-4">
      <span className="grid h-10 w-10 place-items-center rounded-lg bg-accent/15 text-accent-soft"><Icon size={18} /></span>
      <div>
        <p className="text-xl font-extrabold">{value}</p>
        <p className="text-xs text-muted">{label}</p>
      </div>
    </div>
  );
}
