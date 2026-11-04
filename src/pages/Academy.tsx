import { LoomVideos } from "@/components/LoomVideos";
import { SimulationPack } from "@/components/academy/SimulationPack";
import { Fragment, useMemo, useState } from "react";
import {
  ArrowLeft, ArrowRight, Award, BookOpen, Check, CircleCheckBig, ClipboardCheck, FlaskConical, Library, Link2, Lock,
  Play, RotateCcw, Send, ShieldCheck, Users, Video, type LucideIcon,
} from "lucide-react";
import { PageHeader, Badge } from "@/components/ui";
import { atLeast,
  useAcademyAttempts, useAcademyCourse, useAcademyMutations, useAcademyProgress, useAcademyResources,
  JOB_FUNCTION_LABEL, useAcademyPlans, useAcademyRoster, useAcademySubmissions, useAcademyTrainerNotes, useMyRole, useWorkspaceMembers,
} from "@/data/hooks";
import { CERTIFICATE_TITLE, DAY_TITLES } from "@/data/academySeed";
import { isSimulationLesson } from "@/data/academySimulation";
import type { AcademyLesson, AcademyModule, AcademySubmission, GradeResult, LessonKind, SubmissionStatus } from "@/types/db";
import { cn } from "@/lib/utils";

/**
 * The Made Ready Academy. Audit §5.2, rebuilt to the HR course outline
 * "AI-Powered Executive Assistant Foundations" (0095): three days, ten modules.
 *
 * Every EA finishes this before they are handed to a client, which makes it a
 * sales-call talking point (Reichelle 18:00) rather than an optional extra.
 *
 * The modules unlock in order. That is what gives the pass/fail gate something
 * to gate: without it, "you must pass Module 1" means nothing because Module 2
 * was open the whole time. Quizzes are graded in Postgres against a key the
 * browser cannot read; practical assessments are passed by an admin who isn't
 * the learner. Made Ready (and the certificate) needs both.
 */

const KIND: Record<LessonKind, { icon: LucideIcon; label: string }> = {
  reading: { icon: BookOpen, label: "Reading" },
  video: { icon: Video, label: "Video Instruction" },
  simulation: { icon: FlaskConical, label: "Simulation" },
  practical: { icon: ClipboardCheck, label: "Practical" },
};

const SUBMISSION: Record<SubmissionStatus, { tone: string; label: string }> = {
  submitted: { tone: "in_progress", label: "Waiting for review" },
  passed: { tone: "done", label: "Passed" },
  needs_work: { tone: "high", label: "Needs changes" },
};

const hhmm = (mins: number) => (mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60 ? `${mins % 60}m` : ""}`.trim() : `${mins}m`);

/** Plain text with any https:// links made clickable. Submissions are mostly links to Docs and Slides. */
function Linked({ text }: { text: string }) {
  return (
    <>
      {text.split(/(https:\/\/[^\s)]+)/g).map((part, i) =>
        part.startsWith("https://")
          ? <a key={i} href={part} target="_blank" rel="noreferrer" className="break-all text-accent underline">{part}</a>
          : <Fragment key={i}>{part}</Fragment>)}
    </>
  );
}

export default function Academy() {
  const { data: course, isLoading } = useAcademyCourse();
  const { data: doneIds = [] } = useAcademyProgress();
  const { data: attempts = [] } = useAcademyAttempts();
  const { data: mine = [] } = useAcademySubmissions("mine");
  const { data: role } = useMyRole();
  const { data: members = [] } = useWorkspaceMembers();
  const { setLessonDone, grade } = useAcademyMutations();
  const isAdmin = atLeast(role, "admin");

  const [openLesson, setOpenLesson] = useState<AcademyLesson | null>(null);
  const [quizModule, setQuizModule] = useState<AcademyModule | null>(null);
  const [tab, setTab] = useState<"course" | "team">("course");

  const done = useMemo(() => new Set(doneIds), [doneIds]);
  const modules = useMemo(
    () => (course?.modules ?? []).filter((m) => m.is_published).sort((a, b) => a.position - b.position),
    [course],
  );
  const moduleNo = (id: string) => modules.findIndex((m) => m.id === id) + 1;
  const lessonsOf = (id: string) =>
    (course?.lessons ?? []).filter((l) => l.module_id === id).sort((a, b) => a.position - b.position);
  const submissionFor = (lessonId: string) => mine.find((s) => s.lesson_id === lessonId);

  /** Best attempt per module. Retries are unlimited, so the best one is the one that counts. */
  const passedModules = useMemo(() => {
    const s = new Set<string>();
    for (const a of attempts) if (a.passed) s.add(a.module_id);
    return s;
  }, [attempts]);

  // A module opens once the one before it is passed. Module 1 is always open.
  const unlockedUpTo = useMemo(() => {
    let i = 0;
    while (i < modules.length && passedModules.has(modules[i].id)) i++;
    return i; // index of the first module not yet passed
  }, [modules, passedModules]);

  // Only lessons in published modules count; the old draft outline stays hidden.
  const liveIds = new Set(modules.map((m) => m.id));
  const allLessons = (course?.lessons ?? []).filter((l) => liveIds.has(l.module_id));
  const totalDone = allLessons.filter((l) => done.has(l.id)).length;
  const practicals = allLessons.filter((l) => l.kind === "practical");
  const practicalsPassed = practicals.filter((l) => submissionFor(l.id)?.status === "passed").length;
  const quizzesPassed = modules.filter((m) => passedModules.has(m.id)).length;
  const madeReady = modules.length > 0 && quizzesPassed >= modules.length && practicalsPassed >= practicals.length;
  const certifiedAt = madeReady
    ? [...attempts.filter((a) => a.passed).map((a) => a.created_at), ...mine.filter((s) => s.status === "passed").map((s) => s.reviewed_at ?? s.submitted_at)]
      .sort().at(-1) ?? null
    : null;
  const me = members.find((m) => m.is_me);
  const { data: plans = [] } = useAcademyPlans();
  const myPlan = me ? plans.find((p) => p.user_id === me.user_id) : undefined;
  const approver = myPlan?.approved_by ? members.find((m) => m.user_id === myPlan.approved_by)?.name : undefined;

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
          Module {moduleNo(openLesson.module_id)} · {K.label} · {hhmm(openLesson.minutes)}
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

        {openLesson.kind === "practical" && isSimulationLesson(openLesson.title) && <SimulationPack lessonId={openLesson.id} />}

        {openLesson.kind === "practical" ? (
          <PracticalPanel lesson={openLesson} submission={submissionFor(openLesson.id)} />
        ) : (
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
        )}
      </div>
    );
  }

  // ------------------------------------------------------------ assessment
  if (quizModule) {
    return (
      <Assessment
        module={quizModule}
        number={moduleNo(quizModule.id)}
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
        subtitle="Made Ready Academy: AI-Powered Executive Assistant Foundations. Three days, about three hours each. Finish it before your first day with a client."
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

      {/* The Made Ready course is the EA track. Other jobs (0098) are told so
          rather than told to finish it before meeting a client. */}
      {me?.job_function && me.job_function !== "ea" && tab === "course" && (
        <p role="note" className="card mb-5 px-5 py-3 text-[13.5px] text-muted">
          This course is the Executive Assistant track. Training for your role ({JOB_FUNCTION_LABEL[me.job_function]}) will be added here; you're welcome to take this one too.
        </p>
      )}

      {/* Training videos, recorded in Loom (19 Oct 2026 team meeting). */}
      <div id="videos" className="card mb-5 p-5">
        <LoomVideos sopId={null} title="Training videos" empty="No training videos yet. Managers can add a Loom link or record one here." />
      </div>

      {tab === "team" && isAdmin ? (
        <>
          <ReviewQueue lessons={course?.lessons ?? []} moduleNo={moduleNo} />
          <Roster />
        </>
      ) : (
        <>
          {/* Status, and the certificate once earned */}
          {madeReady ? (
            <div className="card mb-6 border-emerald-500/40 bg-emerald-500/[0.04] p-6 text-center">
              <Award size={34} className="mx-auto mb-2 text-emerald-400" />
              <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-emerald-400">Made Ready Academy</p>
              <p className="mt-1 text-xl font-extrabold tracking-[-0.01em]">{CERTIFICATE_TITLE}</p>
              {me && <p className="mt-2 text-[15px] font-semibold">{me.name}</p>}
              <p className="mt-1 text-[13px] text-muted">
                All {modules.length} modules and {practicals.length} practical assessments passed
                {certifiedAt && <> · {new Date(certifiedAt).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}</>}
              </p>
              <p className="mt-3 text-[13px] font-medium">
                {myPlan?.approved_at
                  ? <>Approved for client work{approver && <> by {approver}</>} on {longDate(myPlan.approved_at)}</>
                  : <span className="text-muted">Waiting for an admin to approve you for client work.</span>}
              </p>
            </div>
          ) : (
            <div className="card mb-6 flex flex-wrap items-center gap-4 p-5">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[color:var(--nav-active-bg)] text-accent">
                <ShieldCheck size={24} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-bold">
                  Not yet Made Ready
                  {myPlan?.due_date && <DueBadge due={myPlan.due_date} />}
                </p>
                <p className="text-[13px] text-muted">
                  {quizzesPassed} of {modules.length} module quizzes passed · {practicalsPassed} of {practicals.length} practicals passed · {totalDone} of {allLessons.length} lessons complete
                </p>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-accent transition-all"
                    style={{ width: `${modules.length ? ((quizzesPassed + practicalsPassed) / (modules.length + practicals.length)) * 100 : 0}%` }}
                  />
                </div>
                <p className="mt-2 text-[12px] text-faint">
                  To earn <b className="font-semibold text-muted">{CERTIFICATE_TITLE}</b>: pass every module quiz with 80% or more, and have every practical, including the final client simulation, passed by your trainer.
                </p>
              </div>
            </div>
          )}

          {/* Modules, grouped by day */}
          <div className="space-y-4">
            {modules.map((m, i) => {
              const lessons = lessonsOf(m.id);
              const locked = i > unlockedUpTo;
              const passed = passedModules.has(m.id);
              const lessonsDone = lessons.filter((l) => done.has(l.id)).length;
              const allRead = lessons.length > 0 && lessonsDone === lessons.length;
              const best = attempts.filter((a) => a.module_id === m.id).reduce((b, a) => Math.max(b, a.score), -1);
              const hasQuiz = (course?.questions ?? []).some((q) => q.module_id === m.id);
              const firstOfDay = i === 0 || modules[i - 1].day !== m.day;
              const dayMinutes = modules.filter((x) => x.day === m.day).flatMap((x) => lessonsOf(x.id)).reduce((t, l) => t + l.minutes, 0);

              return (
                <Fragment key={m.id}>
                  {firstOfDay && (
                    <div className={cn("flex flex-wrap items-baseline gap-x-3 px-1", i > 0 && "pt-4")}>
                      <h2 className="text-[13px] font-extrabold uppercase tracking-[0.14em] text-accent">Day {m.day}</h2>
                      {DAY_TITLES[m.day] && <p className="font-bold">{DAY_TITLES[m.day]}</p>}
                      <span className="text-[12.5px] text-faint">about {hhmm(dayMinutes)}</span>
                    </div>
                  )}
                  <section className={cn("card overflow-hidden", locked && "opacity-55")}>
                    <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4">
                      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[13px] font-extrabold",
                        passed ? "bg-emerald-500/15 text-emerald-400" : "bg-[color:var(--nav-active-bg)] text-accent")}>
                        {passed ? <Check size={17} /> : i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-bold leading-tight">Module {i + 1}. {m.title}</p>
                        {m.summary && <p className="mt-0.5 text-[12.5px] leading-snug text-faint">{m.summary}</p>}
                      </div>
                      {locked ? <Badge tone="low"><Lock size={11} className="mr-1 inline" />Locked</Badge>
                        : passed ? <Badge tone="done">Passed {best}%</Badge>
                        : <span className="text-[12.5px] text-faint">{lessonsDone}/{lessons.length}</span>}
                    </div>

                    {locked ? (
                      <p className="px-5 py-4 text-[13px] text-faint">
                        Pass the Module {i} quiz to open this.
                      </p>
                    ) : (
                      <>
                        <ul className="divide-y divide-border">
                          {lessons.map((l) => {
                            const K = KIND[l.kind];
                            const isDone = done.has(l.id);
                            const sub = l.kind === "practical" ? submissionFor(l.id) : undefined;
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
                                  {sub && <Badge tone={SUBMISSION[sub.status].tone}>{SUBMISSION[sub.status].label}</Badge>}
                                  <span className="shrink-0 text-[12px] text-faint">{K.label} · {hhmm(l.minutes)}</span>
                                  <ArrowRight size={14} className="shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />
                                </button>
                              </li>
                            );
                          })}
                        </ul>

                        <div className="flex flex-wrap items-center gap-3 border-t border-border bg-black/10 px-5 py-3">
                          {!hasQuiz ? (
                            <p className="text-[13px] text-faint">No quiz written for this module yet.</p>
                          ) : (
                            <>
                              <button
                                className={cn(allRead ? "btn-primary" : "btn-ghost border border-border")}
                                onClick={() => setQuizModule(m)}
                                disabled={!allRead}
                              >
                                {passed ? <><RotateCcw size={15} /> Retake</> : <><Play size={15} /> Module {i + 1} quiz</>}
                              </button>
                              <span className="text-[12.5px] text-faint">
                                {allRead
                                  ? `${m.pass_pct}% to pass. Retries are unlimited.`
                                  : `Finish all ${lessons.length} lessons to unlock the quiz.`}
                              </span>
                            </>
                          )}
                        </div>
                      </>
                    )}
                  </section>
                </Fragment>
              );
            })}
          </div>

          {modules.length === 0 && (
            <div className="card p-8 text-center">
              <BookOpen size={24} className="mx-auto mb-3 text-faint" />
              <p className="font-medium">No course published</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-faint">
                The course isn't set up yet. Ask your admin.
              </p>
            </div>
          )}

          {modules.length > 0 && <Resources canEdit={isAdmin} />}
        </>
      )}
    </div>
  );
}

// -------------------------------------------------------------- practical
function PracticalPanel({ lesson, submission }: { lesson: AcademyLesson; submission?: AcademySubmission }) {
  const { submitPractical } = useAcademyMutations();
  const [body, setBody] = useState(submission?.body ?? "");
  const [editing, setEditing] = useState(!submission || submission.status === "needs_work");
  const status = submission ? SUBMISSION[submission.status] : null;

  async function send() {
    await submitPractical.mutateAsync({ lessonId: lesson.id, body: body.trim(), existing: submission });
    setEditing(false);
  }

  return (
    <div className="card p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <ClipboardCheck size={17} className="text-accent" />
        <p className="font-bold">Your work</p>
        {status && <Badge tone={status.tone}>{status.label}</Badge>}
      </div>

      {submission?.feedback && (
        <div className={cn("mb-4 rounded-xl border px-4 py-3 text-[14px]",
          submission.status === "passed" ? "border-emerald-500/30 bg-emerald-500/[0.05]" : "border-amber-500/30 bg-amber-500/[0.05]")}>
          <p className="mb-0.5 text-[11px] font-bold uppercase tracking-[0.12em] text-faint">Trainer feedback</p>
          <p className="whitespace-pre-line">{submission.feedback}</p>
        </div>
      )}

      {editing ? (
        <>
          <textarea
            className="input min-h-[180px] w-full py-3 leading-relaxed"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write your answer here, or paste links to your Google Docs or Slides (shared with your trainer)."
            aria-label="Your work"
          />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button className="btn-primary" onClick={() => void send()} disabled={!body.trim() || submitPractical.isPending}>
              <Send size={15} /> {submitPractical.isPending ? "Sending…" : submission ? "Send again for review" : "Send for review"}
            </button>
            {submission && submission.status !== "needs_work" && (
              <button className="btn-ghost border border-border" onClick={() => { setBody(submission.body); setEditing(false); }}>Cancel</button>
            )}
            {submitPractical.isError && <span className="text-[13px] text-red-400">Couldn't send it. Try again.</span>}
          </div>
        </>
      ) : submission && (
        <>
          <p className="whitespace-pre-line rounded-xl border border-border px-4 py-3 text-[14px] leading-relaxed"><Linked text={submission.body} /></p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {submission.status === "submitted" && (
              <>
                <span className="text-[13px] text-faint">Your trainer will review it. You can carry on with the course meanwhile.</span>
                <button className="btn-ghost border border-border" onClick={() => setEditing(true)}>Edit</button>
              </>
            )}
            {submission.status === "passed" && <span className="text-[13px] text-emerald-400">Passed. Nothing more to do here.</span>}
          </div>
        </>
      )}
    </div>
  );
}

// -------------------------------------------------------------- resources
function Resources({ canEdit }: { canEdit: boolean }) {
  const { data: resources = [] } = useAcademyResources();
  const { setResourceLink } = useAcademyMutations();
  const [editId, setEditId] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  if (resources.length === 0) return null;

  const valid = /^https:\/\/\S+$/.test(url.trim());
  async function save(id: string) {
    await setResourceLink.mutateAsync({ id, url: url.trim() || null });
    setEditId(null);
  }

  return (
    <section className="card mt-6 overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border px-5 py-4">
        <Library size={17} className="text-accent" />
        <p className="font-bold">Resources included</p>
        <span className="text-[12.5px] text-faint">{resources.filter((r) => r.url).length} of {resources.length} ready</span>
      </div>
      <ul className="divide-y divide-border">
        {resources.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
            <span className="min-w-0 flex-1 text-[14px]">
              {r.url
                ? <a href={r.url} target="_blank" rel="noreferrer" className="font-medium hover:text-accent">{r.title}</a>
                : <span className="text-muted">{r.title}</span>}
            </span>
            {editId === r.id ? (
              <span className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                <input
                  className="input h-8 min-w-0 flex-1 py-0 text-[13px] sm:w-72"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://docs.google.com/…"
                  aria-label={`Link for ${r.title}`}
                  autoFocus
                />
                <button className="btn-primary h-8 py-0 text-[13px]" disabled={(!valid && url.trim() !== "") || setResourceLink.isPending} onClick={() => void save(r.id)}>Save</button>
                <button className="btn-ghost h-8 border border-border py-0 text-[13px]" onClick={() => setEditId(null)}>Cancel</button>
              </span>
            ) : (
              <>
                {!r.url && <span className="text-[12px] text-faint">Being prepared</span>}
                {canEdit && (
                  <button className="btn-ghost h-7 border border-border px-2 py-0 text-[12px]" onClick={() => { setEditId(r.id); setUrl(r.url ?? ""); }}>
                    <Link2 size={12} /> {r.url ? "Change link" : "Add link"}
                  </button>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ------------------------------------------------------------------ quiz
function Assessment({
  module: m, number, questions, onGrade, onExit,
}: {
  module: AcademyModule;
  number: number;
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

      <h1 className="text-[25px] font-extrabold tracking-[-0.02em]">Module {number} quiz</h1>
      <p className="mb-1 font-semibold">{m.title}</p>
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

// ------------------------------------------------- practical work to review
/** Admins pass practicals or send them back. The database refuses a verdict on your own work. */
function ReviewQueue({ lessons, moduleNo }: { lessons: AcademyLesson[]; moduleNo: (id: string) => number }) {
  const { data: rows = [], isLoading } = useAcademySubmissions("team");
  const { data: members = [] } = useWorkspaceMembers();
  const { reviewPractical } = useAcademyMutations();
  const { data: guides = {} } = useAcademyTrainerNotes(true);
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const [error, setError] = useState<Record<string, string>>({});
  const name = (id: string) => members.find((m) => m.user_id === id)?.name ?? "Unknown";
  const lesson = (id: string) => lessons.find((l) => l.id === id);
  const waiting = rows.filter((r) => r.status === "submitted" && lesson(r.lesson_id));

  async function decide(s: AcademySubmission, status: "passed" | "needs_work") {
    setError((e) => ({ ...e, [s.id]: "" }));
    try {
      await reviewPractical.mutateAsync({ submission: s, status, feedback: feedback[s.id] ?? "" });
    } catch (e) {
      setError((x) => ({ ...x, [s.id]: e instanceof Error ? e.message : "Couldn't save the review." }));
    }
  }

  return (
    <div className="card mb-5 overflow-hidden">
      <div className="border-b border-border px-5 py-3">
        <p className="font-semibold">Practical work to review</p>
        <p className="text-[12.5px] text-faint">Pass it, or send it back with what to change. You can't review your own work.</p>
      </div>
      {isLoading ? <p className="px-5 py-5 text-sm text-faint">Loading…</p> : waiting.length === 0 ? (
        <p className="px-5 py-5 text-sm text-faint">Nothing waiting for review.</p>
      ) : (
        <ul className="divide-y divide-border">
          {waiting.map((s) => {
            const l = lesson(s.lesson_id)!;
            return (
              <li key={s.id} className="space-y-3 px-5 py-4">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <p className="font-semibold">{name(s.user_id)}</p>
                  <p className="text-[13px] text-muted">Module {moduleNo(l.module_id)} · {l.title}</p>
                  <span className="text-[12px] text-faint">sent {new Date(s.submitted_at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>
                </div>
                <p className="whitespace-pre-line rounded-xl border border-border px-4 py-3 text-[14px] leading-relaxed"><Linked text={s.body} /></p>
                {guides[s.lesson_id] && (
                  <details className="rounded-xl border border-border bg-black/10">
                    <summary className="cursor-pointer px-4 py-2.5 text-[13px] font-semibold">Marking guide</summary>
                    <p className="whitespace-pre-line border-t border-border px-4 py-3 text-[13px] leading-relaxed text-muted">{guides[s.lesson_id]}</p>
                  </details>
                )}
                <textarea
                  className="input min-h-[70px] w-full py-2 text-[14px]"
                  placeholder="Feedback for them (needed if you send it back)"
                  value={feedback[s.id] ?? ""}
                  onChange={(e) => setFeedback((f) => ({ ...f, [s.id]: e.target.value }))}
                  aria-label={`Feedback for ${name(s.user_id)}`}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <button className="btn-primary" disabled={reviewPractical.isPending} onClick={() => void decide(s, "passed")}>
                    <Check size={15} /> Pass
                  </button>
                  <button className="btn-ghost border border-border" disabled={reviewPractical.isPending || !(feedback[s.id] ?? "").trim()} onClick={() => void decide(s, "needs_work")}>
                    <RotateCcw size={15} /> Send back
                  </button>
                  {error[s.id] && <span className="text-[13px] text-red-400">{error[s.id]}</span>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ------------------------------------------------------------ due dates
const today = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, local
const longDate = (d: string) =>
  new Date(d.length === 10 ? d + "T12:00:00" : d).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });

/** "Due 20 Nov", red once the date has passed. Only shown while the course isn't finished. */
function DueBadge({ due }: { due: string }) {
  const late = due < today();
  return (
    <span className={cn("ml-2 align-middle text-[12px] font-semibold", late ? "text-red-400" : "text-muted")}>
      {late ? "Overdue: was due " : "Due "}
      {new Date(due + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" })}
    </span>
  );
}

// ------------------------------------------------- who has finished what
/**
 * R-5.2.3. Admins only, both here and in the RLS policy behind it.
 * 0097 adds a finish-by date per person and the sign-off for client work.
 */
function Roster() {
  const { data: rows = [], isLoading } = useAcademyRoster(true);
  const { data: members = [] } = useWorkspaceMembers();
  const { data: plans = [] } = useAcademyPlans();
  const { setDueDate, approve } = useAcademyMutations();
  const [error, setError] = useState<Record<string, string>>({});
  const name = (id: string) => members.find((m) => m.user_id === id)?.name ?? "Unknown";
  const meId = members.find((m) => m.is_me)?.user_id;

  async function run(uid: string, job: () => Promise<unknown>) {
    setError((e) => ({ ...e, [uid]: "" }));
    try { await job(); } catch (e) {
      setError((x) => ({ ...x, [uid]: e instanceof Error ? e.message : "Couldn't save that." }));
    }
  }

  if (isLoading) return <div className="card p-6 text-sm text-faint">Loading…</div>;

  return (
    <div className="card overflow-hidden">
      <div className="border-b border-border px-5 py-3">
        <p className="font-semibold">Made Ready status</p>
        <p className="text-[12.5px] text-faint">Give each person a date to finish by. Once they're Made Ready, approve them for client work; you can't approve yourself.</p>
      </div>
      <ul className="divide-y divide-border">
        {rows.map((r) => {
          // practicals_* are missing until 0095 runs; treat that as none required.
          const pTotal = r.practicals_total ?? 0, pPassed = r.practicals_passed ?? 0;
          const complete = r.modules_total > 0 && r.modules_passed >= r.modules_total && pPassed >= pTotal;
          const started = r.modules_passed > 0 || pPassed > 0;
          const plan = plans.find((p) => p.user_id === r.user_id);
          const late = !complete && !!plan?.due_date && plan.due_date < today();
          return (
            <li key={r.user_id} className="flex flex-wrap items-center gap-3 px-5 py-3" data-person={r.user_id}>
              <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                complete ? "bg-emerald-500/15 text-emerald-400" : "bg-white/5 text-faint")}>
                <ShieldCheck size={16} />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{name(r.user_id)}</span>
              <span className="text-[13px] text-muted">{r.modules_passed}/{r.modules_total} quizzes</span>
              {pTotal > 0 && <span className="text-[13px] text-muted">{pPassed}/{pTotal} practicals</span>}
              {complete
                ? <Badge tone="done">Made Ready</Badge>
                : late ? <Badge tone="urgent">Overdue</Badge>
                : <Badge tone={started ? "high" : "low"}>{started ? "In progress" : "Not started"}</Badge>}
              <div className="flex w-full flex-wrap items-center gap-2 pl-11 text-[12.5px]">
                {!complete && (
                  <label className="flex items-center gap-1.5 whitespace-nowrap text-muted">
                    Finish by
                    <input
                      type="date"
                      className="input h-8 px-2 py-0 text-[12.5px]"
                      value={plan?.due_date ?? ""}
                      aria-label={`Finish-by date for ${name(r.user_id)}`}
                      onChange={(e) => void run(r.user_id, () => setDueDate.mutateAsync({ userId: r.user_id, due: e.target.value || null }))}
                    />
                  </label>
                )}
                {complete && (plan?.approved_at ? (
                  <>
                    <span className="font-medium text-emerald-400">
                      <CircleCheckBig size={13} className="mr-1 inline" />
                      Approved for client work {longDate(plan.approved_at)}
                      {plan.approved_by && <> by {name(plan.approved_by)}</>}
                    </span>
                    <button className="text-faint underline-offset-2 hover:underline"
                      onClick={() => void run(r.user_id, () => approve.mutateAsync({ userId: r.user_id, approve: false, madeReady: complete }))}>
                      Take back
                    </button>
                  </>
                ) : r.user_id === meId ? (
                  <span className="text-faint">Another admin approves you for client work.</span>
                ) : (
                  <button className="btn-primary h-8 px-3 text-[12.5px]" disabled={approve.isPending}
                    onClick={() => void run(r.user_id, () => approve.mutateAsync({ userId: r.user_id, approve: true, madeReady: complete }))}>
                    <Check size={14} /> Approve for client work
                  </button>
                ))}
                {error[r.user_id] && <span className="text-red-400">{error[r.user_id]}</span>}
              </div>
            </li>
          );
        })}
        {rows.length === 0 && <li className="px-5 py-6 text-sm text-faint">No team members yet.</li>}
      </ul>
    </div>
  );
}
