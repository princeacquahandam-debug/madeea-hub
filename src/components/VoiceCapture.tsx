import { useEffect, useState } from "react";
import { Mic, Square, Sparkles, Keyboard, AlertTriangle, Check } from "lucide-react";
import { Modal } from "@/components/ui";
import { useSpeechCapture } from "@/hooks/useSpeechCapture";
import { parseVoiceTask } from "@/lib/ai";
import type { ParseResult } from "@/lib/voiceTask";
import { useClients, useTaskMutations } from "@/data/hooks";
import type { Priority } from "@/types/db";

type Step = "capture" | "parsing" | "confirm";

/** Below this, the browser thinks it may have misheard — nudge the user to check. */
const LOW_CONFIDENCE = 0.6;

export function VoiceCapture({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: clients = [] } = useClients();
  const { create } = useTaskMutations();
  const speech = useSpeechCapture();
  const [step, setStep] = useState<Step>("capture");
  const [typed, setTyped] = useState("");
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [form, setForm] = useState({ title: "", due: "", client_id: "", priority: "normal" as Priority });
  const [error, setError] = useState<string | null>(null);

  // Start listening as soon as the sheet opens, so it's one tap, not two.
  useEffect(() => {
    if (!open) return;
    setStep("capture");
    setTyped("");
    setParsed(null);
    setError(null);
    speech.reset();
    if (speech.supported) speech.start();
    return () => speech.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const spoken = `${speech.transcript} ${speech.interim}`.trim();
  const text = (speech.supported ? speech.transcript : typed).trim() || typed.trim();
  const lowConfidence = speech.confidence !== null && speech.confidence < LOW_CONFIDENCE;

  async function parse() {
    const source = text;
    if (!source) return;
    speech.stop();
    setStep("parsing");
    setError(null);
    try {
      const result = await parseVoiceTask(source, clients);
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

  // Nothing is ever saved without this being pressed.
  function save() {
    if (!form.title.trim()) return;
    create.mutate({
      title: form.title.trim(),
      priority: form.priority,
      due_at: form.due || null,
      client_id: form.client_id || null,
    });
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose}>
      <div className="pr-8">
        <span className="eyebrow">Quick Capture</span>
        <h2 className="display mt-1 text-2xl">
          {step === "confirm" ? "Check this before saving" : "Speak a task"}
        </h2>
      </div>

      {step !== "confirm" && (
        <div className="mt-5">
          {/* --- Listening state ------------------------------------------------ */}
          {speech.listening ? (
            <div className="flex flex-col items-center rounded-xl bg-surface-2 p-8">
              <div className="relative flex h-20 w-20 items-center justify-center">
                <span className="absolute h-full w-full animate-ping rounded-full bg-accent/30" />
                <span className="absolute h-16 w-16 rounded-full bg-accent/20" />
                <Mic size={30} className="relative text-accent" />
              </div>
              <p className="mt-4 text-sm font-medium">Listening…</p>
              <p className="mt-1 text-xs text-faint">Say something like “remind me to send Priya the board pack by Friday”.</p>
              <button className="btn-primary mt-5" onClick={speech.stop}>
                <Square size={14} /> Stop
              </button>
            </div>
          ) : (
            <div className="rounded-xl bg-surface-2 p-6 text-center">
              {speech.state === "unsupported" && (
                <p className="mb-3 flex items-center justify-center gap-2 text-xs text-muted">
                  <Keyboard size={14} />
                  This browser can’t listen (Safari on iPhone, typically) — type it instead.
                </p>
              )}
              {speech.state === "denied" && (
                <p className="mb-3 flex items-center justify-center gap-2 text-xs text-amber-400">
                  <AlertTriangle size={14} />
                  Microphone access was blocked. Allow it in your browser settings, or type it below.
                </p>
              )}
              {speech.state === "error" && (
                <p className="mb-3 text-xs text-amber-400">The microphone stopped unexpectedly. Type it, or try again.</p>
              )}
              {speech.heardNothing && !speech.transcript && (
                <p className="mb-3 text-xs text-muted">I didn’t catch anything. Try again, or type it below.</p>
              )}
              {speech.supported && (
                <button className="btn-primary" onClick={speech.start}>
                  <Mic size={15} /> {speech.transcript ? "Record more" : "Start recording"}
                </button>
              )}
            </div>
          )}

          {/* --- Transcript, always editable ------------------------------------ */}
          <div className="mt-4">
            <label className="field-label" htmlFor="vc-transcript">
              {speech.supported ? "Transcript" : "Your note"}
            </label>
            {/* Never read-only. A browser can claim to support speech and then never
                return a result (no network to the speech service, say) — locking the
                box while "listening" would strand the user with no way out. Typing
                simply takes over from the mic. */}
            <textarea
              id="vc-transcript"
              className="input min-h-[76px] resize-y"
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

          <button
            className="btn-primary mt-4 w-full"
            onClick={parse}
            disabled={!text || step === "parsing"}
          >
            <Sparkles size={15} className={step === "parsing" ? "animate-pulse" : undefined} />
            {step === "parsing" ? "Reading it…" : "Turn into a task"}
          </button>
        </div>
      )}

      {/* --- Confirmation: editable fields, nothing saved yet ------------------- */}
      {step === "confirm" && parsed && (
        <div className="mt-5 space-y-3">
          <p className="rounded-lg bg-surface-2 p-3 text-xs italic text-faint">“{text}”</p>

          {parsed.notes.map((n) => (
            <p key={n} className="flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-300">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              {n}
            </p>
          ))}

          <div>
            <label className="field-label" htmlFor="vc-title">Title</label>
            <input
              id="vc-title"
              className="input"
              autoFocus
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="field-label" htmlFor="vc-due">Due date</label>
              <input
                id="vc-due"
                type="date"
                className="input"
                value={form.due}
                onChange={(e) => setForm((f) => ({ ...f, due: e.target.value }))}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="vc-priority">Priority</label>
              <select
                id="vc-priority"
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

          <div>
            <label className="field-label" htmlFor="vc-client">Client</label>
            <select
              id="vc-client"
              className="input"
              value={form.client_id}
              onChange={(e) => setForm((f) => ({ ...f, client_id: e.target.value }))}
            >
              <option value="">— Unassigned —</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <p className="text-[11px] text-faint">
            {parsed.source === "claude"
              ? "Parsed by Claude; the date was re-checked against today locally."
              : "Parsed on-device (Claude not connected). Dates are computed from today’s real date."}
          </p>

          <div className="flex gap-2 pt-1">
            <button className="btn-ghost flex-1 border border-border" onClick={() => setStep("capture")}>
              Back
            </button>
            <button className="btn-primary flex-1" onClick={save} disabled={!form.title.trim() || create.isPending}>
              <Check size={15} /> {create.isPending ? "Saving…" : "Save task"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
