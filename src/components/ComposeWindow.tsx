import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  X, Minus, Maximize2, Minimize2, Send, Sparkles, Paperclip, Trash2,
  Bold, Italic, Underline, List, ListOrdered, Link2, Loader2, CheckCircle2, AlertTriangle,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useSendEmail, reconnectMail, PROVIDER_LABEL } from "@/hooks/useSendEmail";
import { useMyEmail, useMailConnections } from "@/data/hooks";
import type { MailProvider } from "@/types/db";
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
  /** Outlook threading: Graph's id for the message being replied to. */
  replyToOutlookId?: string | null;
  /** Which mailbox to answer from. Set by whoever opened the window. */
  provider?: MailProvider;
  title?: string;
}

interface Attached {
  filename: string;
  mime_type: string;
  data: string;
  size: number;
}

/* Gmail allows 25MB, but every attachment travels as base64 inside a JSON body
   through an edge function, and base64 inflates by about a third. Capped well
   under that so a large file fails HERE, with a sentence explaining why, rather
   than as an opaque request-too-large after the upload appears to have worked.

   Outlook's ceiling is lower and it is Microsoft's, not ours: Graph carries
   attachments inline only up to 3MB per message and wants an upload session
   beyond that. Enforcing the smaller number when Outlook is the sender is the
   difference between a clear sentence at the file picker and a refusal after
   the whole mail has been written. */
const MAX_TOTAL: Record<MailProvider, number> = {
  gmail: 6 * 1024 * 1024,
  outlook: 3 * 1024 * 1024,
};

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
  /* Shared with the reading pane's inline reply, so both report the same
     failures from the same code. */
  const { state, setState, send: sendEmail } = useSendEmail();

  /* WHOSE NAME GOES ON THIS EMAIL.
     There was no From anywhere in this window. On a product where one EA writes
     on behalf of several executives, the field that must never be wrong was the
     one field absent, and the app already knew the answer: useMyEmail was
     imported on the page and used only to strip your own address out of
     reply-all.
     Read-only, deliberately. Sending as somebody else needs Gmail send-as
     delegation, which is not set up, and a picker offering identities that do
     not work would be worse than no picker. It states the truth and leaves the
     choice for when there is one. */
  const myEmail = useMyEmail();

  /* WHICH MAILBOX SENDS THIS.
     A reply inherits it from the message being answered (the seed carries it),
     because answering an Outlook thread from Gmail sends from an address the
     recipient has never seen. A new mail has nothing to inherit, so it starts
     on whichever account is connected, preferring Gmail when both are: it is
     the one that shipped first and the one most of these mailboxes are.
     Read-only when only one is connected. A picker that offers a single option
     is furniture. */
  const { data: mail } = useMailConnections();
  /* Null means "nobody has chosen", which is not the same as "Gmail" and has to
     be storable: the connections arrive a moment after the window opens, so a
     provider resolved once at open time would be stale for the person who only
     has Outlook. Derived per render instead, and a picked value wins from the
     moment it is picked. */
  const [picked, setPicked] = useState<MailProvider | null>(null);
  const provider: MailProvider =
    picked ?? seed?.provider ?? (mail && !mail.gmail.connected && mail.outlook.connected ? "outlook" : "gmail");
  const both = Boolean(mail?.gmail.connected && mail?.outlook.connected);
  const fromLabel =
    provider === "outlook"
      ? (mail?.outlook.account_email ?? "Your Outlook account")
      : (myEmail ?? "Not signed in");

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
    /* Cleared on every open, like every other field here. Without it the window
       keeps the account chosen for the last message it answered, which is the
       same wrong-recipient class of bug as keeping the last To address. */
    setPicked(null);

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

  /* Escape closes it, which it did not, so the reflexive key did nothing and
     the window just sat there. Guarded by the same discard check as the X, or
     Escape would become the fastest way to lose a half-written email. */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") attemptClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  if (!open) return null;

  /* Closing threw the email away silently: no confirm, no autosave, no drafts.
     A confirm is the smallest honest guard. It only fires when there is
     something to lose, because asking about an empty window trains people to
     click through the dialog they should be reading. */
  function attemptClose() {
    const typed = (bodyRef.current?.innerText ?? "").trim();
    const seeded = (seed?.html ?? "").replace(/<[^>]*>/g, "").trim();
    const hasOwnWords = typed.length > seeded.length;
    const hasRecipient = to.trim().length > 0 && !seed?.to;
    if ((hasOwnWords || hasRecipient || files.length > 0) && state.kind !== "sent") {
      if (!window.confirm("Discard this email? What you have written will be lost.")) return;
    }
    onClose();
  }

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
      if (total + f.size > MAX_TOTAL[provider]) {
        setState({
          kind: "error",
          detail: `${f.name} would take the attachments past ${prettyBytes(MAX_TOTAL[provider])}, which is the limit for sending through ${PROVIDER_LABEL[provider]}. Share a link instead.`,
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
    const ok = await sendEmail({
      to, cc, bcc, subject, text, html,
      attachments: files.map(({ filename, mime_type, data }) => ({ filename, mime_type, data })),
      threadId: seed?.threadId,
      inReplyTo: seed?.inReplyTo,
      replyToOutlookId: seed?.replyToOutlookId,
      provider,
    });
    // Long enough to read the confirmation, short enough to sit there.
    if (ok) setTimeout(onClose, 1600);
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
      /* Deliberately NOT aria-modal, and deliberately no focus trap.
         This window is non-modal by design: the whole reason it docks instead
         of covering the screen is that you can read the message you are
         answering while you write. A review flagged that focus can tab out of
         it into the list, which is true and is correct behaviour for a
         non-modal dialog; Gmail's compose behaves the same way. Declaring
         aria-modal here would tell a screen reader the rest of the page is
         inert when it is not, which is worse than the thing it appears to fix.
         Escape closes it, so there is always a way out. */
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
          onClick={(e) => { e.stopPropagation(); attemptClose(); }}
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
              <span className="w-10 shrink-0 text-[12.5px] text-faint">From</span>
              {/* A control only when there is a genuine choice. With one mailbox
                  connected this is the same read-only line it has always been:
                  a select with one option invites a decision that does not
                  exist, and sending as somebody else still needs delegation
                  that is not set up. */}
              {both ? (
                <select
                  aria-label="Send from"
                  value={provider}
                  onChange={(e) => setPicked(e.target.value as MailProvider)}
                  className="min-w-0 flex-1 bg-transparent py-2 text-[13px] text-muted outline-none"
                >
                  <option value="gmail">{myEmail ?? "Google account"}</option>
                  <option value="outlook">{mail?.outlook.account_email ?? "Outlook account"}</option>
                </select>
              ) : (
                <span className="min-w-0 flex-1 truncate py-2 text-[13px] text-muted" title={fromLabel}>
                  {fromLabel}
                </span>
              )}
            </Row>
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
                {prettyBytes(totalBytes)} of {prettyBytes(MAX_TOTAL[provider])}
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
                        ? `This ${PROVIDER_LABEL[state.provider]} account is connected for reading only, so the send was refused. Reconnect once to allow sending.`
                        : `No ${PROVIDER_LABEL[state.provider]} account is connected for you yet.`}
                    </span>
                  </p>
                  <button
                    className="btn-primary mt-2 py-1 text-[11px]"
                    onClick={async () => {
                      const err = await reconnectMail(state.provider);
                      if (err) setState({ kind: "error", detail: err });
                    }}
                  >
                    {state.kind === "needs_scope" ? "Reconnect" : "Connect"} {PROVIDER_LABEL[state.provider]}
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
