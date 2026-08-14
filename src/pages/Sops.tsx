import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ClipboardCheck, CheckCircle2, Circle, Sparkles, Play, Target, ArrowLeft, MessageSquare, Pin, Video, Trash2, Plus, Pencil, GripVertical, X } from "lucide-react";
import type { Sop, SopStep, SopRun } from "@/types/db";
import { PageHeader, Modal } from "@/components/ui";
import { useSops, useSopRuns, useSopMutations, useClients, useRecordings, useRecordingMutations, recordingUrl, useTasks, useTaskMutations, useMyRole, DEMO_ME } from "@/data/hooks";
import { ScreenRecorder } from "@/components/ScreenRecorder";
import { generate } from "@/lib/ai";
import { OutputViewer } from "@/components/OutputViewer";
import { useSopWidget } from "@/store/sopWidget";
import { cn } from "@/lib/utils";

/**
 * Your recordings, above the SOP library.
 *
 * Only rendered when you have some: an empty shelf on a page that already has
 * a Record button in its header is furniture. Playback uses a signed URL that
 * is fetched on demand and expires, because the bucket is private.
 */
function RecordingsStrip() {
  const { data: recordings = [] } = useRecordings();
  const nav = useNavigate();
  if (recordings.length === 0) return null;

  return (
    <button
      onClick={() => nav("/videos")}
      className="card mb-5 flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-surface-2/40"
    >
      <Video size={15} className="shrink-0 text-accent" />
      <span className="text-sm font-medium">
        {recordings.length} recording{recordings.length === 1 ? "" : "s"} waiting to be written up
      </span>
      <span className="ml-auto text-xs text-accent-soft">Open Videos →</span>
    </button>
  );
}

export default function Sops() {
  const { data: sops = [], isLoading } = useSops();
  const { data: runs = [] } = useSopRuns();
  const { data: tasks = [] } = useTasks();
  const { data: role } = useMyRole();
  const isAdmin = role === "admin";
  const { data: clients = [] } = useClients();
  const { start, setChecked, complete, saveSop, removeSop } = useSopMutations();
  const { create: createTask, setStatus: setTaskStatus } = useTaskMutations();
  const pinWidget = useSopWidget((s) => s.pin);
  const [recording, setRecording] = useState(false);
  const { save: saveRecording } = useRecordingMutations();

  const [openSop, setOpenSop] = useState<Sop | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [checked, setLocalChecked] = useState<string[]>([]);
  /* A ref alongside the state, because toggle() reads the current ticks to
     compute the next set, and React has not re-rendered between two clicks that
     land in the same tick. Reading `checked` from the closure meant a fast pair
     of clicks both started from the same value and the second overwrote the
     first, silently losing a tick. Always write ticks through applyChecked. */
  const checkedRef = useRef<string[]>([]);
  const applyChecked = (next: string[]) => { checkedRef.current = next; setLocalChecked(next); };
  const [clientId, setClientId] = useState<string>("");
  const [taskId, setTaskId] = useState<string>("");
  const [done, setDone] = useState(false);
  const [editing, setEditing] = useState<Sop | "new" | null>(null);

  // AI step sub-view
  const [aiStep, setAiStep] = useState<SopStep | null>(null);
  const [aiOutput, setAiOutput] = useState("");
  const [aiBusy, setAiBusy] = useState(false);

  const myId = DEMO_ME;
  const client = clients.find((c) => c.id === clientId) ?? null;
  // Tasks worth attaching a run to: yours, still open. A done task is not what
  // you are about to spend an hour on.
  const attachable = useMemo(
    () => tasks.filter((t) => t.status !== "done" && (!clientId || t.client_id === clientId)),
    [tasks, clientId],
  );
  const aiInputs: Record<string, string> = client
    ? { client: client.name, tone: client.tone ?? "", preferences: client.preferences_notes ?? "" }
    : {};

  /* Open runs for this procedure, one per client.
     This used to be `runs.find(x => x.sop_id === sop.id)`, which ignored the
     client entirely. An EA running Inbox Triage for Vantage and for Acme got
     whichever row came back first, so ticks for one client showed up under the
     other. Managing several clients at once is the normal case, not the edge
     case (Reichelle 56:04). Migration 0035 adds the unique index that makes
     two open runs for the same pair impossible. */
  const openRuns = useMemo(
    () => (openSop ? runs.filter((r) => r.sop_id === openSop.id && r.status === "in_progress") : []),
    [runs, openSop],
  );

  function open(sop: Sop) {
    const inProgress = runs.filter((x) => x.sop_id === sop.id && x.status === "in_progress");
    // Resume straight into it only when there is exactly one, so there is no
    // guessing about which client's run you just opened.
    const only = inProgress.length === 1 ? inProgress[0] : null;
    setOpenSop(sop);
    setRunId(only?.id ?? null);
    applyChecked(only?.checked ?? []);
    setClientId(only?.client_id ?? "");
    setTaskId(only?.task_id ?? "");
    setDone(false);
    setAiStep(null);
  }
  /** Clear the panel back to the pickers so a run can be started for another client. */
  function newRun() {
    setRunId(null); applyChecked([]); setClientId(""); setTaskId(""); setAiStep(null);
  }
  function resume(r: SopRun) {
    setRunId(r.id);
    applyChecked(r.checked);
    setClientId(r.client_id ?? "");
    setTaskId(r.task_id ?? "");
  }
  function close() {
    setOpenSop(null); setRunId(null); applyChecked([]); setClientId(""); setTaskId(""); setDone(false); setAiStep(null);
  }

  /* Starting a run creates the task if you did not pick one.
     This is the whole point of migration 0035. The EOD is built from tasks and
     reads nothing else, so before this an EA could run four procedures end to
     end and file an empty EOD. Attaching to a task rather than teaching the EOD
     to read sop_runs keeps tasks as the single source of truth (R-4.7.6) and
     avoids the same work appearing twice in front of a client. */
  async function startRun() {
    if (!openSop) return;
    let tid = taskId;
    if (!tid) {
      const clientName = clients.find((c) => c.id === clientId)?.name;
      const created = await createTask.mutateAsync({
        title: clientName ? `${openSop.title} for ${clientName}` : openSop.title,
        priority: "normal",
        status: "in_progress",
        client_id: clientId || null,
        assignee_id: myId,
        notes: `Running the ${openSop.title} workflow.`,
      });
      tid = created?.id ?? "";
      setTaskId(tid);
    } else {
      // An existing task you picked is now being worked, so say so on the board.
      setTaskStatus.mutate({ id: tid, status: "in_progress" });
    }
    const r = await start.mutateAsync({ sop_id: openSop.id, client_id: clientId || null, task_id: tid || null });
    setRunId(r?.id ?? "local");
    applyChecked([]);
  }
  function toggle(stepId: string, force?: boolean) {
    if (!runId) return;
    const cur = checkedRef.current;
    const on = force ?? !cur.includes(stepId);
    const next = on ? [...new Set([...cur, stepId])] : cur.filter((s) => s !== stepId);
    applyChecked(next);
    if (runId !== "local") setChecked.mutate({ id: runId, checked: next });
  }
  async function finish() {
    if (runId && runId !== "local") await complete.mutateAsync(runId);
    /* The task is what the EOD reads. Closing the run without closing the task
       would leave the EA to remember to do it by hand, which is the retyping
       R-4.3.2 exists to remove.

       setStatus, NOT update. update writes the column and nothing else, while
       setStatus is the path a drag to Done takes: it stamps completed_at, honours
       the approval gate from 0030, and logs the move to the activity feed. The
       EOD's "Completed today" filters on completed_at, so a plain update left the
       task done and the EOD empty, which is the exact bug this work exists to
       fix. */
    if (taskId) await setTaskStatus.mutateAsync({ id: taskId, status: "done" });
    setDone(true);
  }
  function pinToScreen() {
    if (!openSop || !runId) return;
    pinWidget(openSop, runId, checked, client?.name ?? null);
    close();
  }
  async function runAi(step: SopStep) {
    setAiStep(step); setAiOutput(""); setAiBusy(true);
    try {
      const out = await generate({ tool: "quick_action", format: step.ai_action!, inputs: aiInputs });
      setAiOutput(out);
      toggle(step.id, true); // auto-tick the step once AI is used
    } catch (e) {
      setAiOutput(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAiBusy(false);
    }
  }

  const requiredIds = openSop?.steps.filter((s) => s.required).map((s) => s.id) ?? [];
  const allRequiredDone = requiredIds.length > 0 && requiredIds.every((id) => checked.includes(id));
  const pct = openSop && openSop.steps.length ? Math.round((checked.length / openSop.steps.length) * 100) : 0;

  return (
    <div>
      {/* "Workflows", matching the nav. The page still said "SOPs", so the tab
          you clicked and the page you landed on had different names. */}
      <PageHeader
        title="Workflows"
        subtitle="Checklists for the work that repeats. Run one and it lands on your board and in your EOD."
        action={
          <div className="flex gap-2">
            {isAdmin && (
              <button className="btn-ghost border border-border" onClick={() => setEditing("new")}>
                <Plus size={15} /> New workflow
              </button>
            )}
            <button className="btn-primary" onClick={() => setRecording(true)}>
              <Video size={15} /> Record how you do it
            </button>
          </div>
        }
      />

      {/* The library itself lives on /videos now. This is only the entry point
          into the loop the 09 Aug direction is built around: record it once,
          write it up, and the next EA runs it on day one. */}
      <RecordingsStrip />

      <ScreenRecorder
        open={recording}
        onClose={() => setRecording(false)}
        saving={saveRecording.isPending}
        onSave={(r) => {
          saveRecording.mutate(
            { title: `Recording ${new Date().toLocaleDateString()}`, blob: r.blob, durationSeconds: r.durationSeconds, hasAudio: r.hasAudio },
            { onSuccess: () => setRecording(false) },
          );
        }}
      />

      {isLoading ? (
        <p className="text-sm text-faint">Loading…</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {sops.map((sop) => {
            const live = runs.filter((r) => r.sop_id === sop.id && r.status === "in_progress").length;
            return (
            <div key={sop.id} className="card group relative flex flex-col p-5 transition-colors hover:border-accent/40">
              {isAdmin && (
                <button
                  onClick={() => setEditing(sop)}
                  aria-label={`Edit ${sop.title}`}
                  className="icon-btn reveal-on-hover absolute right-3 top-3 text-faint hover:text-accent"
                >
                  <Pencil size={13} />
                </button>
              )}
              <button onClick={() => open(sop)} className="flex flex-1 flex-col text-left">
              <div className="flex items-center gap-2">
                <ClipboardCheck size={18} className="text-accent-soft" />
                <h3 className="font-semibold">{sop.title}</h3>
                {live > 0 && (
                  <span className="pill bg-accent/15 text-accent-soft">{live} running</span>
                )}
              </div>
              <span className="pill mt-2 w-fit bg-surface-2 text-faint">{sop.category}</span>
              <p className="mt-3 flex-1 text-sm text-muted">{sop.description}</p>
              <div className="mt-4 flex items-center gap-3 text-xs text-faint">
                <span>{sop.steps.length} steps</span><span>·</span><span>{sop.success_criteria.length} deliverables</span>
                <span className="ml-auto inline-flex items-center gap-1 text-accent-soft"><Play size={12} /> Start</span>
              </div>
              </button>
            </div>
            );
          })}
          {sops.length === 0 && (
            <div className="card col-span-full p-8 text-center">
              <ClipboardCheck size={22} className="mx-auto mb-3 text-faint" />
              <p className="font-medium">No workflows yet</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-faint">
                A workflow is how a job gets done the same way every time, by whoever is doing it.
                Record yourself doing one, or write the steps out directly.
              </p>
            </div>
          )}
        </div>
      )}

      <Modal open={openSop !== null} onClose={close}>
        {openSop && (
          <div>
            {/* AI sub-view */}
            {aiStep ? (
              <div>
                <button onClick={() => setAiStep(null)} className="flex items-center gap-1 text-xs text-accent-soft hover:underline">
                  <ArrowLeft size={13} /> Back to checklist
                </button>
                <div className="mt-2 flex items-center gap-2">
                  <Sparkles size={16} className="text-accent-soft" />
                  <h2 className="font-semibold">{aiStep.ai_action}</h2>
                </div>
                {aiBusy ? (
                  <p className="py-8 text-center text-sm text-faint">Generating with AI…</p>
                ) : aiOutput ? (
                  <div className="mt-3"><OutputViewer output={aiOutput} title={aiStep.ai_action ?? "AI Output"} /></div>
                ) : null}
              </div>
            ) : done ? (
              <div className="flex flex-col items-center gap-2 rounded-lg bg-emerald-500/10 p-6 text-center">
                <CheckCircle2 size={28} className="text-emerald-400" />
                <p className="font-medium">SOP completed</p>
                <p className="text-sm text-muted">This run has been recorded{client ? ` for ${client.name}` : ""}.</p>
                <p className="mt-1 text-sm text-muted">
                  {taskId ? "The task is marked done, so it will appear in today's EOD." : "Not linked to a task, so this will not appear in your EOD."}
                </p>
                <button className="btn-primary mt-3" onClick={close}>Done</button>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <ClipboardCheck size={18} className="text-accent-soft" />
                  <h2 className="text-lg font-semibold">{openSop.title}</h2>
                </div>
                <p className="mt-1 text-sm text-muted">{openSop.description}</p>

                {/* Runs already open, one per client, and always visible while
                    any exist rather than only before you pick one.

                    The first version only rendered this when nothing was
                    resumed, which left no way to start a second run at all: one
                    open run auto-resumes, so the client picker was gone and the
                    EA was stuck on whichever client they started first. Running
                    the same procedure for several clients in a day is the
                    normal case (Reichelle 56:04). */}
                {openRuns.length > 0 && (
                  <div className="mt-4 rounded-lg border border-border bg-surface-2/50 p-3">
                    <p className="mb-2 text-xs font-semibold text-faint">
                      {openRuns.length} run{openRuns.length === 1 ? "" : "s"} in progress
                    </p>
                    <div className="space-y-1">
                      {openRuns.map((r) => {
                        const isCurrent = r.id === runId;
                        return (
                          <button
                            key={r.id}
                            onClick={() => resume(r)}
                            aria-current={isCurrent}
                            className={cn(
                              "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors",
                              isCurrent ? "bg-[var(--nav-active-bg)] text-[color:var(--nav-active-text)]" : "hover:bg-surface-2",
                            )}
                          >
                            <Play size={12} className="shrink-0 text-accent-soft" />
                            <span className="flex-1 truncate">
                              {clients.find((c) => c.id === r.client_id)?.name ?? "No client"}
                            </span>
                            <span className="shrink-0 text-xs text-faint">
                              {r.checked.length}/{openSop.steps.length}
                            </span>
                          </button>
                        );
                      })}
                      {runId && (
                        <button
                          onClick={newRun}
                          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-accent-soft transition-colors hover:bg-surface-2"
                        >
                          <Plus size={12} className="shrink-0" /> Start one for another client
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* client + task attach */}
                {!runId ? (
                  <div className="mt-4 space-y-3">
                    <div>
                      <label className="field-label">Client (optional)</label>
                      <select className="input" value={clientId} onChange={(e) => { setClientId(e.target.value); setTaskId(""); }}>
                        <option value="">No client</option>
                        {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="field-label">Task</label>
                      <select className="input" value={taskId} onChange={(e) => setTaskId(e.target.value)}>
                        <option value="">Create one for me</option>
                        {attachable.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
                      </select>
                      {/* Saying this out loud, because "why did my EOD say I did
                          nothing today" is the question this answers. */}
                      <p className="mt-1 text-[11px] text-faint">
                        The run attaches to this task, so finishing it shows up on your board and in your EOD.
                      </p>
                    </div>
                  </div>
                ) : client ? (
                  <div className="mt-4 rounded-lg border border-border bg-surface-2/50 p-3">
                    <p className="flex items-center gap-1.5 text-xs font-semibold text-zinc-200">
                      <MessageSquare size={12} className="text-accent-soft" /> {client.name}
                      <span className="font-normal text-faint">· {client.preferred_channel}{client.tone ? ` · ${client.tone}` : ""}</span>
                    </p>
                    {client.preferences_notes && <p className="mt-1 text-xs text-muted">{client.preferences_notes}</p>}
                  </div>
                ) : null}

                {runId && taskId && (
                  <p className="mt-3 flex items-center gap-1.5 text-xs text-faint">
                    <CheckCircle2 size={12} className="text-accent-soft" />
                    Linked to <span className="text-zinc-300">{tasks.find((t) => t.id === taskId)?.title ?? "a task"}</span>
                  </p>
                )}

                {/* progress */}
                <div className="mt-4">
                  <div className="mb-1 flex items-center justify-between text-xs text-faint">
                    <span>{runId ? "In progress" : "Not started"}</span>
                    <span>{checked.length}/{openSop.steps.length}</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-surface-2">
                    <div className="h-1.5 rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
                  </div>
                </div>

                {/* checklist */}
                <div className="mt-4 space-y-1">
                  {openSop.steps.map((step) => {
                    const isChecked = checked.includes(step.id);
                    return (
                      <div key={step.id} className="flex items-start gap-2 rounded-lg p-2.5 hover:bg-surface-2">
                        <button disabled={!runId} onClick={() => toggle(step.id)} className="flex flex-1 items-start gap-3 text-left disabled:opacity-70">
                          {isChecked ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-accent" /> : <Circle size={18} className="mt-0.5 shrink-0 text-faint" />}
                          <span className="flex-1">
                            <span className={`text-sm ${isChecked ? "text-zinc-400 line-through" : ""}`}>{step.label}</span>
                            {!step.required && <span className="ml-2 text-[11px] text-faint">(optional)</span>}
                          </span>
                        </button>
                        {step.ai_action && runId && (
                          <button onClick={() => runAi(step)} className="pill shrink-0 bg-accent/15 text-accent-soft hover:bg-accent/25">
                            <Sparkles size={10} /> Run AI
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Success criteria, when there are any. An authored workflow can
                    have none, and an empty bordered box with a heading is
                    furniture. */}
                {openSop.success_criteria.length > 0 && (
                <div className="mt-5 rounded-lg border border-border bg-surface-2/50 p-4">
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-faint">
                    <Target size={12} /> Success criteria / deliverables
                  </p>
                  <ul className="space-y-1">
                    {openSop.success_criteria.map((c) => (
                      <li key={c} className="flex items-start gap-2 text-sm text-muted">
                        <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-400/70" /> {c}
                      </li>
                    ))}
                  </ul>
                </div>
                )}

                {/* action */}
                <div className="mt-5">
                  {!runId ? (
                    <button className="btn-primary w-full" onClick={startRun} disabled={start.isPending}>
                      <Play size={15} /> {start.isPending ? "Starting…" : "Start workflow"}
                    </button>
                  ) : (
                    <div className="flex gap-2">
                      <button className="btn-ghost border border-border" onClick={pinToScreen} title="Keep this checklist on screen while you work">
                        <Pin size={14} /> Pin to screen
                      </button>
                      <button className="btn-primary flex-1" onClick={finish} disabled={!allRequiredDone || complete.isPending}>
                        <CheckCircle2 size={15} /> {allRequiredDone ? "Mark Complete" : "Complete required steps to finish"}
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </Modal>

      <SopEditor
        open={editing !== null}
        sop={editing === "new" ? null : editing}
        saving={saveSop.isPending}
        onClose={() => setEditing(null)}
        onSave={async (draft) => { await saveSop.mutateAsync(draft); setEditing(null); }}
        onDelete={editing && editing !== "new" ? async () => { await removeSop.mutateAsync(editing.id); setEditing(null); } : undefined}
      />
    </div>
  );
}

/**
 * Write a workflow down.
 *
 * The library was read-only. Every .from("sops") call was a select, so the only
 * way to add one was to write SQL, which means the four that shipped were the
 * four MadeEA would ever have. A procedure nobody can edit is out of date the
 * first time the work changes, and then it is worse than nothing, because
 * people follow it.
 */
function SopEditor({
  open, sop, saving, onClose, onSave, onDelete,
}: {
  open: boolean;
  sop: Sop | null;
  saving: boolean;
  onClose: () => void;
  onSave: (draft: Omit<Sop, "id"> & { id?: string }) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const blank = { title: "", description: "", category: "", steps: [] as SopStep[], success_criteria: [] as string[] };
  const [form, setForm] = useState(blank);
  const [seeded, setSeeded] = useState<string | null>(null);

  // Load the SOP being edited once per open, rather than in an effect that
  // would stamp on what you are typing every time the parent re-renders.
  const key = open ? (sop?.id ?? "new") : null;
  if (key !== seeded) {
    setSeeded(key);
    setForm(sop ? { title: sop.title, description: sop.description, category: sop.category, steps: sop.steps, success_criteria: sop.success_criteria } : blank);
  }

  const setStep = (i: number, patch: Partial<SopStep>) =>
    setForm((f) => ({ ...f, steps: f.steps.map((st, j) => (j === i ? { ...st, ...patch } : st)) }));
  const addStep = () =>
    setForm((f) => ({
      ...f,
      // Ids are what the tick list keys on, so they have to be stable and unique
      // within the SOP. Position is not enough: reordering would move the ticks.
      steps: [...f.steps, { id: `s${Date.now().toString(36)}${f.steps.length}`, label: "", required: true }],
    }));
  const removeStep = (i: number) => setForm((f) => ({ ...f, steps: f.steps.filter((_, j) => j !== i) }));
  const move = (i: number, dir: -1 | 1) =>
    setForm((f) => {
      const to = i + dir;
      if (to < 0 || to >= f.steps.length) return f;
      const next = [...f.steps];
      [next[i], next[to]] = [next[to], next[i]];
      return { ...f, steps: next };
    });

  const usableSteps = form.steps.filter((st) => st.label.trim());
  const canSave = form.title.trim().length > 0 && usableSteps.length > 0;

  return (
    <Modal open={open} onClose={onClose}>
      <h2 className="mb-1 text-lg font-semibold">{sop ? "Edit workflow" : "New workflow"}</h2>
      <p className="mb-4 text-[13px] text-faint">
        Write the steps the way you would tell a new EA on their first day.
      </p>

      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <label className="field-label" htmlFor="sop-title">Name</label>
            <input id="sop-title" className="input" placeholder="e.g. Weekly client report" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
          </div>
          <div>
            <label className="field-label" htmlFor="sop-cat">Category</label>
            <input id="sop-cat" className="input" placeholder="e.g. Reporting" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} />
          </div>
        </div>
        <div>
          <label className="field-label" htmlFor="sop-desc">What it is for</label>
          <input id="sop-desc" className="input" placeholder="One line. What does finishing this achieve?" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="field-label mb-0">Steps</span>
            <button className="btn-ghost border border-border px-2 py-1 text-xs" onClick={addStep}>
              <Plus size={12} /> Add step
            </button>
          </div>
          <div className="space-y-1.5">
            {form.steps.map((st, i) => (
              <div key={st.id} className="flex items-start gap-1.5 rounded-lg border border-border p-2">
                <div className="flex flex-col">
                  <button onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move step up" className="icon-btn text-faint hover:text-accent disabled:opacity-30">
                    <GripVertical size={12} />
                  </button>
                </div>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <input
                    className="input py-1.5 text-sm"
                    placeholder="What the EA does"
                    value={st.label}
                    onChange={(e) => setStep(i, { label: e.target.value })}
                  />
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-1.5 text-[12px] text-muted">
                      <input type="checkbox" className="accent-[color:var(--accent)]" checked={st.required} onChange={(e) => setStep(i, { required: e.target.checked })} />
                      Required to finish
                    </label>
                    <input
                      className="input min-w-0 flex-1 py-1 text-[12px]"
                      placeholder="AI action to offer here (optional)"
                      value={st.ai_action ?? ""}
                      onChange={(e) => setStep(i, { ai_action: e.target.value || undefined })}
                    />
                  </div>
                </div>
                <button onClick={() => removeStep(i)} aria-label="Remove step" className="icon-btn text-faint hover:text-red-400">
                  <X size={13} />
                </button>
              </div>
            ))}
            {form.steps.length === 0 && (
              <p className="rounded-lg border border-dashed border-border p-4 text-center text-[13px] text-faint">
                No steps yet. A workflow with no steps is just a title.
              </p>
            )}
          </div>
        </div>

        <div>
          <label className="field-label" htmlFor="sop-sc">Success criteria, one per line</label>
          <textarea
            id="sop-sc"
            className="input min-h-[72px]"
            placeholder={"Client has received a response\nCRM has been updated"}
            value={form.success_criteria.join("\n")}
            onChange={(e) => setForm((f) => ({ ...f, success_criteria: e.target.value.split("\n") }))}
          />
          <p className="mt-1 text-[11px] text-faint">What has to be true when this is done. Shown at the bottom of the checklist.</p>
        </div>

        <div className="flex gap-2 pt-1">
          {onDelete && (
            <button className="btn-ghost border border-border text-red-300 hover:border-red-500/40" onClick={() => void onDelete()}>
              <Trash2 size={14} /> Retire
            </button>
          )}
          <button
            className="btn-primary flex-1"
            disabled={!canSave || saving}
            onClick={() =>
              void onSave({
                id: sop?.id,
                title: form.title.trim(),
                description: form.description.trim(),
                category: form.category.trim() || "General",
                // Blank rows are dropped rather than saved as empty ticks.
                steps: usableSteps.map((st) => ({ ...st, label: st.label.trim() })),
                success_criteria: form.success_criteria.map((c) => c.trim()).filter(Boolean),
              })
            }
          >
            {saving ? "Saving…" : sop ? "Save changes" : "Create workflow"}
          </button>
        </div>
        {!canSave && (
          <p className="text-[12px] text-faint">A name and at least one step are needed.</p>
        )}
      </div>
    </Modal>
  );
}
