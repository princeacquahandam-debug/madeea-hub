import { useState } from "react";
import { ClipboardCheck, CheckCircle2, Circle, Sparkles, Play, Target, ArrowLeft, MessageSquare } from "lucide-react";
import type { Sop, SopStep } from "@/types/db";
import { PageHeader, Modal } from "@/components/ui";
import { useSops, useSopRuns, useSopMutations, useClients } from "@/data/hooks";
import { generate } from "@/lib/ai";
import { OutputViewer } from "@/components/OutputViewer";

export default function Sops() {
  const { data: sops = [], isLoading } = useSops();
  const { data: runs = [] } = useSopRuns();
  const { data: clients = [] } = useClients();
  const { start, setChecked, complete } = useSopMutations();

  const [openSop, setOpenSop] = useState<Sop | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [checked, setLocalChecked] = useState<string[]>([]);
  const [clientId, setClientId] = useState<string>("");
  const [done, setDone] = useState(false);

  // AI step sub-view
  const [aiStep, setAiStep] = useState<SopStep | null>(null);
  const [aiOutput, setAiOutput] = useState("");
  const [aiBusy, setAiBusy] = useState(false);

  const client = clients.find((c) => c.id === clientId) ?? null;
  const aiInputs: Record<string, string> = client
    ? { client: client.name, tone: client.tone ?? "", preferences: client.preferences_notes ?? "" }
    : {};

  function open(sop: Sop) {
    const r = runs.find((x) => x.sop_id === sop.id && x.status === "in_progress");
    setOpenSop(sop);
    setRunId(r?.id ?? null);
    setLocalChecked(r?.checked ?? []);
    setClientId(r?.client_id ?? "");
    setDone(false);
    setAiStep(null);
  }
  function close() {
    setOpenSop(null); setRunId(null); setLocalChecked([]); setClientId(""); setDone(false); setAiStep(null);
  }

  async function startRun() {
    if (!openSop) return;
    const r = await start.mutateAsync({ sop_id: openSop.id, client_id: clientId || null });
    setRunId(r?.id ?? "local");
    setLocalChecked([]);
  }
  function toggle(stepId: string, force?: boolean) {
    if (!runId) return;
    const on = force ?? !checked.includes(stepId);
    const next = on ? [...new Set([...checked, stepId])] : checked.filter((s) => s !== stepId);
    setLocalChecked(next);
    if (runId !== "local") setChecked.mutate({ id: runId, checked: next });
  }
  async function finish() {
    if (runId && runId !== "local") await complete.mutateAsync(runId);
    setDone(true);
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
      <PageHeader title="SOPs" subtitle="Working checklists — run each procedure to standard, every time" />

      {isLoading ? (
        <p className="text-sm text-faint">Loading…</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {sops.map((sop) => (
            <button key={sop.id} onClick={() => open(sop)} className="card flex flex-col p-5 text-left transition-colors hover:border-accent/40">
              <div className="flex items-center gap-2">
                <ClipboardCheck size={18} className="text-accent-soft" />
                <h3 className="font-semibold">{sop.title}</h3>
              </div>
              <span className="pill mt-2 w-fit bg-surface-2 text-faint">{sop.category}</span>
              <p className="mt-3 flex-1 text-sm text-muted">{sop.description}</p>
              <div className="mt-4 flex items-center gap-3 text-xs text-faint">
                <span>{sop.steps.length} steps</span><span>·</span><span>{sop.success_criteria.length} deliverables</span>
                <span className="ml-auto inline-flex items-center gap-1 text-accent-soft"><Play size={12} /> Start</span>
              </div>
            </button>
          ))}
          {sops.length === 0 && <p className="text-sm text-faint">No SOPs yet.</p>}
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
                  <p className="py-8 text-center text-sm text-faint">Generating with Claude…</p>
                ) : aiOutput ? (
                  <div className="mt-3"><OutputViewer output={aiOutput} title={aiStep.ai_action ?? "AI Output"} /></div>
                ) : null}
              </div>
            ) : done ? (
              <div className="flex flex-col items-center gap-2 rounded-lg bg-emerald-500/10 p-6 text-center">
                <CheckCircle2 size={28} className="text-emerald-400" />
                <p className="font-medium">SOP completed</p>
                <p className="text-sm text-muted">This run has been recorded{client ? ` for ${client.name}` : ""}.</p>
                <button className="btn-primary mt-2" onClick={close}>Done</button>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <ClipboardCheck size={18} className="text-accent-soft" />
                  <h2 className="text-lg font-semibold">{openSop.title}</h2>
                </div>
                <p className="mt-1 text-sm text-muted">{openSop.description}</p>

                {/* client attach */}
                {!runId ? (
                  <div className="mt-4">
                    <label className="field-label">Client (optional)</label>
                    <select className="input" value={clientId} onChange={(e) => setClientId(e.target.value)}>
                      <option value="">— No client —</option>
                      {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
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

                {/* success criteria */}
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

                {/* action */}
                <div className="mt-5">
                  {!runId ? (
                    <button className="btn-primary w-full" onClick={startRun} disabled={start.isPending}>
                      <Play size={15} /> {start.isPending ? "Starting…" : "Start workflow"}
                    </button>
                  ) : (
                    <button className="btn-primary w-full" onClick={finish} disabled={!allRequiredDone || complete.isPending}>
                      <CheckCircle2 size={15} /> {allRequiredDone ? "Mark Complete" : "Complete all required steps to finish"}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
