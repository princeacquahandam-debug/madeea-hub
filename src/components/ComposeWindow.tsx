import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  X, Minus, Maximize2, Minimize2, Send, Sparkles, Paperclip, Trash2,
  Bold, Italic, Underline, List, ListOrdered, Link2, Loader2, CheckCircle2, AlertTriangle,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { generate } from "@/lib/ai";
import { cn } from "@/lib/utils";

/**
 * A real compose window: docked bottom-right, formatted body, attachments.
 *
 * WHY NOT A MODAL, WHICH IS WHAT THIS REPLACED. A modal takes the whole screen
 * hostage. Writing an email is precisely the task where you need to look
 * something up halfway through: the message you are answering, a date, a name
 * in another tab. Gmail docks the window for that reason, and minimising rather
 * than closing is what makes a half-written mail survive going to look
 * something up. A centred modal makes you cancel and start again.
 *
 * WHY contentEditable AND execCommand. execCommand is formally deprecated and
 * still the only thing every browser implements natively. The alternative is a
 * real editor framework, which is 60-100kB and a lot of concepts for what is
 * genuinely bold, italic, underline, two list types and a link. If this grows
 * into tables and images, that is the point to bring one in, not before.
 *
 * WHAT ACTUALLY GETS SENT. Both an HTML part and a plain-text part, always. The
 * plain part is not a formality: screen readers, watches, plain-text clients and
 * most auto-responders read it, and an HTML-only email is a blank message to
 * every one of them.
 */

export interface ComposeSeed {
  to?: string;
  cc?: string;
  subject?: string;
  /** Pre-filled HTML body, usually the quoted original. */
  html?: string;
  /** What the AI should draft about. Usually the message being answered. */
  context?: string;
  threadId?: string | null;
  inReplyTo?: string | null;
  title?: string;
}

type SendState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent"; id: string }
  | { kind: "needs_scope" }
  | { kind: "not_connected" }
  | { kind: "error"; detail: string };

interface Attached {
  filename: string;
  mime_type: string;
  data: string;
  size: number;
}

/* Gmail allows 25MB, but every attachment travels as base64 inside a JSON body
   through an edge function, and base64 inflates by about a third. Capped well
   under that so a large file fails HERE, with a sentence explaining why, rather
   than as an opaque request-too-large after the upload appears to have worked. */
const MAX_TOTAL = 6 * 1024 * 1024;

const prettyBytes = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

export function ComposeWindow({
  open, onClose, seed,
}: {
  open: boolean;
  onClose: () => void;
  seed?: ComposeSeed;
}) {
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [showCc, setShowCc] = useState(false);
  const [subject, setSubject] = useState("");
  const [files, setFiles] = useState<Attached[]>([]);
  const [minimised, setMinimised] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [state, setState] = useState<SendState>({ kind: "idle" });

  const bodyRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  /* Re-seeded on every open. The window is mounted once and reused, so without
     this, replying to a second message would open it still addressed to the
     first: a wrong-recipient bug that looks like a glitch right up until it is
     a client reading someone else's mail. */
  useEffect(() => {
    if (!open) return;
    setTo(seed?.to ?? "");
    setCc(seed?.cc ?? "");
    setBcc("");
    setShowCc(Boolean(seed?.cc));
    setSubject(seed?.subject ?? "");
    setFiles([]);
    setMinimised(false);
    setState({ kind: "idle" });

    requestAnimationFrame(() => {
      const el = bodyRef.current;
      if (!el) return;
      el.innerHTML = seed?.html ?? "";
      el.focus();
      /* Caret at the very top, above the quoted original. Focusing a
         contentEditable otherwise lands at the end, which on a reply means
         typing underneath what you are answering, so it reads backwards. */
      const range = document.createRange();
      range.setStart(el, 0);
      range.collapse(true);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    });
  }, [open, seed]);

  if (!open) return null;

  const exec = (cmd: string, value?: string) => {
    bodyRef.current?.focus();
    document.execCommand(cmd, false, value);
  };

  function addLink() {
    const url = window.prompt("Link to where?", "https://");
    if (!url || url === "https://") return;
    exec("createLink", url);
  }

  async function pickFiles(list: FileList | null) {
    if (!list?.length) return;
    const next: Attached[] = [...files];
    let total = files.reduce((a, f) => a + f.size, 0);

    for (const f of Array.from(list)) {
      if (total + f.size > MAX_TOTAL) {
        setState({
          kind: "error",
          detail: `${f.name} would take the attachments past ${prettyBytes(MAX_TOTAL)}, which is the limit for sending through this app. Share a link instead.`,
        });
        break;
      }
      const buf = await f.arrayBuffer();
      // Chunked: String.fromCharCode(...bytes) on a multi-megabyte file
      // overflows the argument list and throws.
      let binary = "";
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i += 8192) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      }
      next.push({
        filename: f.name,
        mime_type: f.type || "application/octet-stream",
        data: btoa(binary),
        size: f.size,
      });
      total += f.size;
    }
    setFiles(next);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function draft() {
    setDrafting(true);
    try {
      const out = await generate({
        tool: "quick_action",
        format: "Write Email",
        inputs: {
          kind: seed?.context ? "Reply to a message" : "New email",
          context: seed?.context || `An email to ${to || "the recipient"}`,
          points: subject ? `Subject: ${subject}` : "",
          tone: "Warm",
        },
      });
      const el = bodyRef.current;
      if (el) {
        // Above whatever is already there, which on a reply is the quote.
        const asHtml = out.split("\n").map((l) => `<div>${l || "<br>"}</div>`).join("");
        el.innerHTML = asHtml + el.innerHTML;
      }
    } catch (e) {
      setState({ kind: "error", detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setDrafting(false);
    }
  }

  async function send() {
    const html = bodyRef.current?.innerHTML ?? "";
    const text = bodyRef.current?.innerText ?? "";
    if (!to.trim() || !text.trim() || !supabase) return;

    setState({ kind: "sending" });
    try {
      const { data, error } = await supabase.functions.invoke("gmail-send", {
        body: {
          to: to.trim(),
          cc: cc.trim() || undefined,
          bcc: bcc.trim() || undefined,
          subject: subject.trim(),
          text,
          html,
          attachments: files.map(({ filename, mime_type, data }) => ({ filename, mime_type, data })),
          thread_id: seed?.threadId ?? undefined,
          in_reply_to: seed?.inReplyTo ?? undefined,
        },
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
      setState({ kind: "sent", id: String(payload?.id ?? "") });
      // Long enough to read the confirmation, short enough not to sit there.
      setTimeout(onClose, 1600);
    } catch (e) {
      setState({ kind: "error", detail: e instanceof Error ? e.message : String(e) });
    }
  }

  async function reconnectGoogle() {
    if (!supabase) return;
    const { data } = await supabase.functions.invoke("google-oauth-url", { body: {} });
    if (data?.url) window.location.href = data.url as string;
  }

  const totalBytes = files.reduce((a, f) => a + f.size, 0);

  /* Portalled to <body> deliberately.
     `position: fixed` resolves against the nearest ancestor with a transform,
     filter or backdrop-filter rather than the viewport, and the app shell uses
     backdrop-blur. Rendered in place, the window docked to the right edge of
     the CONTENT column instead of the screen and was clipped by the assistant
     panel: the toolbar was cut in half and Send was off-screen at some widths.
     A portal is the only reliable fix; raising z-index does nothing, because
     the problem is the containing block, not stacking order. */
  return createPortal(
    <div
      className={cn(
        "fixed z-[60] flex flex-col overflow-hidden rounded-t-xl border border-[var(--border-strong)] bg-surface shadow-2xl",
        // Docked bottom-right, as in Gmail. Full width on a phone, where a
        // 500px floating window would hang off the screen.
        minimised
          ? "bottom-0 right-0 h-12 w-[min(92vw,420px)] sm:right-6"
          : expanded
            ? "inset-4 rounded-xl"
            : "bottom-0 right-0 h-[min(88vh,620px)] w-[min(100vw,540px)] sm:right-6",
      )}
      role="dialog"
      aria-label={seed?.title ?? "New message"}
    >
      {/* Title bar. Doubles as the minimise toggle, which is the Gmail habit. */}
      <div
        className="flex h-12 shrink-0 cursor-pointer items-center gap-1 bg-surface-2 px-3"
        onClick={() => setMinimised((v) => !v)}
      >
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
          {seed?.title ?? "New message"}
          {minimised && to ? <span className="ml-1 font-normal text-faint">to {to}</span> : null}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); setMinimised((v) => !v); }}
          aria-label={minimised ? "Restore" : "Minimise"}
          className="grid h-8 w-8 place-items-center rounded text-faint hover:bg-[var(--chip-bg)] hover:text-text"
        >
          <Minus size={15} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); setMinimised(false); }}
          aria-label={expanded ? "Shrink" : "Full screen"}
          className="hidden h-8 w-8 place-items-center rounded text-faint hover:bg-[var(--chip-bg)] hover:text-text sm:grid"
        >
          {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          aria-label="Close"
          className="grid h-8 w-8 place-items-center rounded text-faint hover:bg-[var(--chip-bg)] hover:text-text"
        >
          <X size={15} />
        </button>
      </div>

      {!minimised && (
        <>
          {/* Recipients. Underlined rows rather than boxed inputs, so the head
              of the window stays quiet and the body is where the eye lands. */}
          <div className="shrink-0 px-3">
            <Row>
              <label htmlFor="cw-to" className="w-10 shrink-0 text-[12.5px] text-faint">To</label>
              <input
                id="cw-to" value={to} onChange={(e) => setTo(e.target.value)}
                placeholder="name@company.com, another@company.com"
                className="min-w-0 flex-1 bg-transparent py-2 text-[13px] outline-none placeholder:text-faint"
              />
              {!showCc && (
                <button onClick={() => setShowCc(true)} className="shrink-0 text-[12px] font-medium text-faint hover:text-accent">
                  Cc Bcc
                </button>
              )}
            </Row>

            {showCc && (
              <>
                <Row>
                  <label htmlFor="cw-cc" className="w-10 shrink-0 text-[12.5px] text-faint">Cc</label>
                  <input id="cw-cc" value={cc} onChange={(e) => setCc(e.target.value)}
                    className="min-w-0 flex-1 bg-transparent py-2 text-[13px] outline-none" />
                </Row>
                <Row>
                  <label htmlFor="cw-bcc" className="w-10 shrink-0 text-[12.5px] text-faint">Bcc</label>
                  <input id="cw-bcc" value={bcc} onChange={(e) => setBcc(e.target.value)}
                    className="min-w-0 flex-1 bg-transparent py-2 text-[13px] outline-none" />
                </Row>
              </>
            )}

            <Row>
              <label htmlFor="cw-subject" className="sr-only">Subject</label>
              <input
                id="cw-subject" value={subject} onChange={(e) => setSubject(e.target.value)}
                placeholder="Subject"
                className="min-w-0 flex-1 bg-transparent py-2 text-[13px] font-medium outline-none placeholder:font-normal placeholder:text-faint"
              />
            </Row>
          </div>

          {/* The body. A real editable surface, not a textarea. */}
          <div
            ref={bodyRef}
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-multiline="true"
            aria-label="Message body"
            className="min-h-0 flex-1 overflow-y-auto px-3 py-3 text-[13.5px] leading-relaxed outline-none [&_a]:text-accent [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5"
          />

          {files.length > 0 && (
            <div className="shrink-0 space-y-1 border-t border-border px-3 py-2">
              {files.map((f, i) => (
                <div key={`${f.filename}-${i}`} className="flex items-center gap-2 rounded-md bg-surface-2 px-2 py-1.5 text-[12px]">
                  <Paperclip size={12} className="shrink-0 text-faint" />
                  <span className="min-w-0 flex-1 truncate">{f.filename}</span>
                  <span className="shrink-0 tabular-nums text-faint">{prettyBytes(f.size)}</span>
                  <button
                    onClick={() => setFiles(files.filter((_, j) => j !== i))}
                    aria-label={`Remove ${f.filename}`}
                    className="shrink-0 text-faint hover:text-red-400"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
              <p className="text-right text-[11px] text-faint">
                {prettyBytes(totalBytes)} of {prettyBytes(MAX_TOTAL)}
              </p>
            </div>
          )}

          {state.kind !== "idle" && state.kind !== "sending" && (
            <div className="shrink-0 px-3 pb-2">
              {state.kind === "sent" && (
                <p className="flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/5 px-2.5 py-2 text-[12px] text-emerald-300">
                  <CheckCircle2 size={13} className="shrink-0" /> Sent.
                </p>
              )}
              {(state.kind === "needs_scope" || state.kind === "not_connected") && (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-2.5 py-2 text-[12px] text-amber-200">
                  <p className="flex items-start gap-2">
                    <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                    <span>
                      {state.kind === "needs_scope"
                        ? "This Google account is connected for reading only, so Gmail refused the send. Reconnect once to allow sending."
                        : "No Google account is connected for you yet."}
                    </span>
                  </p>
                  <button className="btn-primary mt-2 py-1 text-[11px]" onClick={() => void reconnectGoogle()}>
                    {state.kind === "needs_scope" ? "Reconnect Google" : "Connect Google"}
                  </button>
                </div>
              )}
              {state.kind === "error" && (
                <p className="flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/5 px-2.5 py-2 text-[12px] text-red-300">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {state.detail.slice(0, 220)}
                </p>
              )}
            </div>
          )}

          {/* Send and the formatting toolbar, on one row as in Gmail. */}
          <div className="flex shrink-0 flex-wrap items-center gap-1 border-t border-border px-3 py-2">
            <button
              className="btn-primary shrink-0 py-1.5"
              onClick={() => void send()}
              disabled={state.kind === "sending" || !to.trim()}
            >
              {state.kind === "sending" ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              {state.kind === "sending" ? "Sending…" : "Send"}
            </button>

            <span className="mx-1 h-5 w-px bg-[var(--border-strong)]" />

            <Tool onClick={() => exec("bold")} label="Bold"><Bold size={14} /></Tool>
            <Tool onClick={() => exec("italic")} label="Italic"><Italic size={14} /></Tool>
            <Tool onClick={() => exec("underline")} label="Underline"><Underline size={14} /></Tool>
            <Tool onClick={() => exec("insertUnorderedList")} label="Bulleted list"><List size={14} /></Tool>
            <Tool onClick={() => exec("insertOrderedList")} label="Numbered list"><ListOrdered size={14} /></Tool>
            <Tool onClick={addLink} label="Insert link"><Link2 size={14} /></Tool>
            <Tool onClick={() => fileRef.current?.click()} label="Attach a file"><Paperclip size={14} /></Tool>

            <input
              ref={fileRef} type="file" multiple className="hidden"
              onChange={(e) => void pickFiles(e.target.files)}
            />

            <button
              className="btn-ghost ml-auto shrink-0 border border-border px-2 py-1 text-[11px]"
              onClick={() => void draft()}
              disabled={drafting}
            >
              <Sparkles size={12} /> {drafting ? "Writing…" : "Write it for me"}
            </button>
          </div>
        </>
      )}
    </div>,
    document.body,
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-2 border-b border-border">{children}</div>;
}

function Tool({ onClick, label, children }: { onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button
      // Mouse-down, not click: clicking a toolbar button would otherwise blur
      // the editable body first and take the selection with it, so Bold would
      // apply to nothing.
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      title={label}
      aria-label={label}
      className="grid h-8 w-8 shrink-0 place-items-center rounded text-muted hover:bg-[var(--chip-bg)] hover:text-text"
    >
      {children}
    </button>
  );
}
