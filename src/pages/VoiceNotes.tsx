import { useEffect, useState } from "react";
import { Mic, Square, Sparkles, Keyboard, AlertTriangle, Check, CheckSquare, Brain, Trash2 } from "lucide-react";
import { Badge, PageHeader } from "@/components/ui";
import { useSpeechCapture } from "@/hooks/useSpeechCapture";
import { parseVoiceTask } from "@/lib/ai";
import type { ParseResult } from "@/lib/voiceTask";
import { useClients, useMemoryMutations, useTaskMutations } from "@/data/hooks";
import { KIND_LABEL, MEMORY_KINDS, type MemoryKind } from "@/lib/memory";
import type { Priority } from "@/types/db";

/** Below this the browser suspects it misheard — nudge the user to read it back. */
const LOW_CONFIDENCE = 0.6;
const HISTORY_KEY = "madeea-voice-history";
const MAX_HISTORY = 12;

interface HistoryEntry {
  at: string;
  transcript: string;
  saved: "task" | "memory";
  label: string;
}

const loadHistory = (): HistoryEntry[] => {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  } catch {
    return [];
  }
};

type Step = "capture" | "parsing" | "confirm";
type Destination = "task" | "memory";

export default function VoiceNotes() {
  const { data: clients = [] } = useClients();
  const { create: createTask } = useTaskMutations();
  const { create: createMemory } = useMemoryMutations();
  const speech = useSpeechCapture();

  const [step, setStep] = useState<Step>("capture");
  const [typed, setTyped] = useState("");
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [dest, setDest] = useState<Destination>("task");
  const [form, setForm] = useState({ title: "", due: "", client_id: "", priority: "normal" as Priority });
  const [memKind, setMemKind] = useState<MemoryKind>("preference");
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);
  const [justSaved, setJustSaved] = useState("");

  useEffect(() => () => speech.stop(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const spoken = `${speech.transcript} ${speech.interim}`.trim();
  const text = (speech.supported ? speech.transcript : typed).trim() || typed.trim();
  const lowConfidence = speech.confidence !== null && speech.confidence < LOW_CONFIDENCE;

  function pushHistory(entry: HistoryEntry) {
    const next = [entry, ...history].slice(0, MAX_HISTORY);
    setHistory(next);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  }

  async function parse() {
    if (!text) return;
    speech.stop();
    setStep("parsing");
    setError(null);
    try {
      const result = await parseVoiceTask(text, clients);
      setParsed(result);
      setForm({
        title: result.title,
        due: result.due,
        client_id: result.client_id ?? "",
        priority: result.priority,
      });
      setStep("confirm");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that. Edit it by hand and try again.");
      setStep("capture");
    }
  }

  function reset() {
    setStep("capture");
    setParsed(null);
    setTyped("");
    setError(null);
    speech.reset();
  }

  // Nothing is written anywhere until this runs.
  async function save() {
    if (dest === "task") {
      if (!form.title.trim()) return;
      await createTask.mutateAsync({
        title: form.title.trim(),
        priority: form.priority,
        due_at: form.due || null,
        client_id: form.client_id || null,
      });
      pushHistory({ at: new Date().toISOString(), transcript: text, saved: "task", label: form.title.trim() });
      setJustSaved(`Task created: ${form.title.trim()}`);
    } else {
      if (!form.title.trim()) return;
      await createMemory.mutateAsync({
        kind: memKind,
        body: form.title.trim(),
        client_id: form.client_id || null,
        source: "voice note",
      });
      pushHistory({ at: new Date().toISOString(), transcript: text, saved: "memory", label: form.title.trim() });
      setJustSaved(`Remembered: ${form.title.trim()}`);
    }
    reset();
  }

  const busy = createTask.isPending || createMemory.isPending;

  return (
    <div>
      <PageHeader
        title="Voice-Note Helper"
        subtitle="Say it once. It becomes a task or something the desk remembers — after you've checked it."
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-5">
          {justSaved && (
            <div className="card flex items-center gap-2 border-emerald-500/40 bg-emerald-500/5 p-3 text-sm text-emerald-200">
              <Check size={15} className="shrink-0" />
              {justSaved}
              <button className="ml-auto text-xs text-faint hover:text-zinc-100" onClick={() => setJustSaved("")}>
                Dismiss
              </button>
            </div>
          )}

          {step !== "confirm" && (
            <section className="card p-5">
              {speech.listening ? (
                <div className="flex flex-col items-center rounded-xl bg-surface-2 p-10">
                  <div className="relative flex h-24 w-24 items-center justify-center">
                    <span className="absolute h-full w-full animate-ping rounded-full bg-accent/30" />
                    <span className="absolute h-20 w-20 rounded-full bg-accent/20" />
                    <Mic size={34} className="relative text-accent" />
                  </div>
                  <p className="mt-4 font-medium">Listening…</p>
                  <p className="mt-1 text-xs text-faint">
                    “Remind me to send Priya the board pack by Friday, it's urgent”
                  </p>
                  <button className="btn-primary mt-5" onClick={speech.stop}>
                    <Square size={14} /> Stop
                  </button>
                </div>
              ) : (
                <div className="rounded-xl bg-surface-2 p-10 text-center">
                  {speech.state === "unsupported" && (
                    <p className="mb-3 flex items-center justify-center gap-2 text-xs text-muted">
                      <Keyboard size={14} />
                      This browser can't listen (Safari on iPhone, typically) — type it instead.
                    </p>
                  )}
                  {speech.state === "denied" && (
                    <p className="mb-3 flex items-center justify-center gap-2 text-xs text-amber-400">
                      <AlertTriangle size={14} />
                      Microphone access was blocked. Allow it in your browser settings, or type below.
                    </p>
                  )}
                  {speech.state === "error" && (
                    <p className="mb-3 text-xs text-amber-400">
                      The microphone stopped unexpectedly. Type it, or try again.
                    </p>
                  )}
                  {speech.heardNothing && !speech.transcript && (
                    <p className="mb-3 text-xs text-muted">I didn't catch anything. Try again, or type below.</p>
                  )}
                  {speech.supported && (
                    <button className="btn-primary" onClick={speech.start}>
                      <Mic size={16} /> {speech.transcript ? "Record more" : "Start recording"}
                    </button>
                  )}
                </div>
              )}

              <div className="mt-4">
                <label className="field-label" htmlFor="vn-transcript">
                  {speech.supported ? "Transcript" : "Your note"}
                </label>
                {/* Never read-only: a browser can claim speech support and then never
                    return a result, which would strand the user mid-capture. */}
                <textarea
                  id="vn-transcript"
                  className="input min-h-[90px] resize-y"
                  placeholder="Or type the note here…"
                  value={speech.listening ? spoken : text}
                  onChange={(e) => {
                    if (speech.listening) speech.stop();
                    setTyped(e.target.value);
                    speech.setTranscript("");
                  }}
                />
                {lowConfidence && !speech.listening && (
                  <p className="mt-1.5 flex items-center gap-1.5 text-xs text-amber-400">
                    <AlertTriangle size={12} />
                    Not sure it heard that correctly — worth a read before continuing.
                  </p>
                )}
              </div>

              {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

              <button className="btn-primary mt-4 w-full" onClick={parse} disabled={!text || step === "parsing"}>
                <Sparkles size={15} className={step === "parsing" ? "animate-pulse" : undefined} />
                {step === "parsing" ? "Reading it…" : "Read it back to me"}
              </button>
            </section>
          )}

          {step === "confirm" && parsed && (
            <section className="card p-5">
              <h2 className="font-semibold">Check this before saving</h2>
              <p className="mt-3 rounded-lg bg-surface-2 p-3 text-xs italic text-faint">“{text}”</p>

              {parsed.notes.map((n) => (
                <p
                  key={n}
                  className="mt-2 flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-300"
                >
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                  {n}
                </p>
              ))}

              <div className="mt-4">
                <p className="field-label">Where does this go?</p>
                <div className="flex gap-2">
                  {(
                    [
                      { key: "task", label: "A task", icon: CheckSquare, hint: "Something to do" },
                      { key: "memory", label: "Something to remember", icon: Brain, hint: "A fact or preference" },
                    ] as const
                  ).map((d) => (
                    <button
                      key={d.key}
                      onClick={() => setDest(d.key)}
                      className={`flex-1 rounded-lg border p-3 text-left transition-colors ${
                        dest === d.key ? "border-accent bg-accent/10" : "border-border hover:border-accent/40"
                      }`}
                    >
                      <d.icon size={15} className="mb-1 text-accent-soft" />
                      <p className="text-sm font-medium">{d.label}</p>
                      <p className="text-xs text-faint">{d.hint}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-4 space-y-3">
                <div>
                  <label className="field-label" htmlFor="vn-title">
                    {dest === "task" ? "Title" : "What to remember"}
                  </label>
                  <input
                    id="vn-title"
                    className="input"
                    autoFocus
                    value={form.title}
                    onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  />
                </div>

                {dest === "task" ? (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="field-label" htmlFor="vn-due">Due date</label>
                      <input
                        id="vn-due"
                        type="date"
                        className="input"
                        value={form.due}
                        onChange={(e) => setForm((f) => ({ ...f, due: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="field-label" htmlFor="vn-priority">Priority</label>
                      <select
                        id="vn-priority"
                        className="input"
                        value={form.priority}
                        onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as Priority }))}
                      >
                        <option value="urgent">Urgent</option>
                        <option value="high">High</option>
                        <option value="normal">Normal</option>
                        <option value="low">Low</option>
                      </select>
                    </div>
                  </div>
                ) : (
                  <div>
                    <label className="field-label" htmlFor="vn-kind">Kind</label>
                    <select
                      id="vn-kind"
                      className="input"
                      value={memKind}
                      onChange={(e) => setMemKind(e.target.value as MemoryKind)}
                    >
                      {MEMORY_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {KIND_LABEL[k]}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label className="field-label" htmlFor="vn-client">Client</label>
                  <select
                    id="vn-client"
                    className="input"
                    value={form.client_id}
                    onChange={(e) => setForm((f) => ({ ...f, client_id: e.target.value }))}
                  >
                    <option value="">— {dest === "task" ? "Unassigned" : "General"} —</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <p className="text-[11px] text-faint">
                  {parsed.source === "claude"
                    ? "Parsed by Claude; the date was re-checked against today locally."
                    : "Parsed on-device (Claude not connected). Dates are computed from today's real date."}
                </p>

                <div className="flex gap-2 pt-1">
                  <button className="btn-ghost flex-1 border border-border" onClick={reset}>
                    Start over
                  </button>
                  <button className="btn-primary flex-1" onClick={save} disabled={!form.title.trim() || busy}>
                    <Check size={15} /> {busy ? "Saving…" : dest === "task" ? "Save task" : "Remember it"}
                  </button>
                </div>
              </div>
            </section>
          )}
        </div>

        {/* ---- history ---- */}
        <div className="card h-fit p-5">
          <div className="mb-3 flex items-center gap-2">
            <h2 className="font-semibold">Recent captures</h2>
            {history.length > 0 && (
              <button
                className="ml-auto text-faint hover:text-red-400"
                onClick={() => {
                  setHistory([]);
                  localStorage.removeItem(HISTORY_KEY);
                }}
                title="Clear history"
                aria-label="Clear capture history"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
          <div className="space-y-2">
            {history.map((h, i) => (
              <div key={i} className="rounded-lg bg-surface-2 p-3">
                <div className="mb-1 flex items-center gap-2">
                  <Badge tone={h.saved === "task" ? "normal" : "reply"}>
                    {h.saved === "task" ? "Task" : "Memory"}
                  </Badge>
                  <span className="text-[11px] text-faint">
                    {new Date(h.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
                <p className="text-sm">{h.label}</p>
                <p className="mt-0.5 text-[11px] italic text-faint">“{h.transcript}”</p>
              </div>
            ))}
            {!history.length && (
              <p className="py-6 text-center text-xs text-faint">
                Captures you save appear here — stored on this device only.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
