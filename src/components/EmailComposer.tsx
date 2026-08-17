import { useState } from "react";
import { Mail, Send, Sparkles, CheckCircle2, AlertTriangle, X } from "lucide-react";
import { Modal } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { generate } from "@/lib/ai";

/**
 * Compose and send an email, with an AI draft that lands in the editable field.
 *
 * The draft is not a separate output panel you copy from. It is written into the
 * body, and the same Send button that sends a hand-typed message sends it. A
 * draft you can only copy to the clipboard is not a send flow.
 *
 * WHY SEND CAN FAIL WITH A VERY SPECIFIC MESSAGE. The connected Google accounts
 * granted gmail.readonly, so Google will refuse to send. The consent screen now
 * asks for gmail.send, but a token already issued does not gain scopes
 * retroactively: whoever is sending has to reconnect once. The UI says that in
 * those words, with the button to do it, rather than reporting a generic error.
 */

type SendState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent"; id: string; threadId?: string }
  | { kind: "needs_scope" }
  | { kind: "not_connected" }
  | { kind: "error"; detail: string };

export function EmailComposer({
  open, onClose, to: initialTo = "", subject: initialSubject = "", context = "",
}: {
  open: boolean;
  onClose: () => void;
  to?: string;
  subject?: string;
  /** What the AI should draft about. Usually the message being replied to. */
  context?: string;
}) {
  const [to, setTo] = useState(initialTo);
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState("");
  const [tone, setTone] = useState("Warm");
  const [drafting, setDrafting] = useState(false);
  const [state, setState] = useState<SendState>({ kind: "idle" });

  async function draft() {
    setDrafting(true);
    try {
      const out = await generate({
        tool: "quick_action",
        format: "Write Email",
        inputs: {
          kind: context ? "Reply to a message" : "New email",
          context: context || `An email to ${to || "the recipient"}`,
          points: subject ? `Subject: ${subject}` : "",
          tone,
        },
      });
      // Straight into the editable field, which is the whole point.
      setBody(out);
    } catch (e) {
      setState({ kind: "error", detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setDrafting(false);
    }
  }

  async function send() {
    if (!to.trim() || !body.trim() || !supabase) return;
    setState({ kind: "sending" });
    try {
      const { data, error } = await supabase.functions.invoke("gmail-send", {
        body: { to: to.trim(), subject: subject.trim(), body: body.trim() },
      });
      let payload: Record<string, unknown> | null = data ?? null;
      if (error) {
        // The function's JSON body carries the reason; the SDK message is the status.
        const ctx = (error as { context?: Response }).context;
        if (ctx && typeof ctx.text === "function") {
          try { payload = JSON.parse(await ctx.text()); } catch { payload = null; }
        }
      }
      const failure = String(payload?.failure ?? "");
      if (failure === "needs_scope") { setState({ kind: "needs_scope" }); return; }
      if (failure === "not_connected") { setState({ kind: "not_connected" }); return; }
      if (error || payload?.error) {
        setState({ kind: "error", detail: String(payload?.error ?? error?.message ?? "send failed") });
        return;
      }
      setState({ kind: "sent", id: String(payload?.id ?? ""), threadId: payload?.thread_id as string | undefined });
    } catch (e) {
      setState({ kind: "error", detail: e instanceof Error ? e.message : String(e) });
    }
  }

  async function reconnectGoogle() {
    if (!supabase) return;
    const { data } = await supabase.functions.invoke("google-oauth-url", { body: {} });
    if (data?.url) window.location.href = data.url as string;
  }

  return (
    <Modal open={open} onClose={onClose}>
      <div className="mb-4 flex items-center gap-2">
        <Mail size={17} className="text-accent" />
        <h2 className="text-lg font-semibold">Write an email</h2>
      </div>

      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <label className="field-label" htmlFor="c-to">To</label>
            <input id="c-to" className="input" type="email" placeholder="name@company.com"
              value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div>
            <label className="field-label" htmlFor="c-tone">Tone</label>
            <select id="c-tone" className="input" value={tone} onChange={(e) => setTone(e.target.value)}>
              {["Warm", "Formal", "Concise", "Assertive", "Collaborative"].map((t) => <option key={t}>{t}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="field-label" htmlFor="c-subject">Subject</label>
          <input id="c-subject" className="input" value={subject} onChange={(e) => setSubject(e.target.value)} />
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label className="field-label mb-0" htmlFor="c-body">Message</label>
            <button className="btn-ghost border border-border px-2.5 py-1 text-xs" onClick={() => void draft()} disabled={drafting}>
              <Sparkles size={12} /> {drafting ? "Writing…" : "Write it for me"}
            </button>
          </div>
          <textarea id="c-body" className="input min-h-[190px]" placeholder="Type it, or let the AI draft it and edit from there."
            value={body} onChange={(e) => setBody(e.target.value)} />
        </div>

        {state.kind === "sent" && (
          <p className="flex items-start gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3 text-[12.5px] text-emerald-200">
            <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
            <span>Sent. Gmail message id <span className="mono text-emerald-100">{state.id}</span></span>
          </p>
        )}

        {state.kind === "needs_scope" && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-[12.5px] text-amber-200">
            <p className="flex items-start gap-2">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>
                This Google account is connected for reading only, so Gmail refused the send.
                Reconnect once to grant permission to send. Nothing else changes.
              </span>
            </p>
            <button className="btn-primary mt-2.5 py-1.5 text-xs" onClick={() => void reconnectGoogle()}>
              Reconnect Google
            </button>
          </div>
        )}

        {state.kind === "not_connected" && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-[12.5px] text-amber-200">
            <p className="flex items-start gap-2">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>No Google account is connected for you yet.</span>
            </p>
            <button className="btn-primary mt-2.5 py-1.5 text-xs" onClick={() => void reconnectGoogle()}>
              Connect Google
            </button>
          </div>
        )}

        {state.kind === "error" && (
          <p className="flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/5 p-3 text-[12.5px] text-red-300">
            <X size={14} className="mt-0.5 shrink-0" /> {state.detail.slice(0, 200)}
          </p>
        )}

        <button className="btn-primary w-full" onClick={() => void send()}
          disabled={state.kind === "sending" || !to.trim() || !body.trim()}>
          <Send size={15} /> {state.kind === "sending" ? "Sending…" : "Send"}
        </button>
      </div>
    </Modal>
  );
}
