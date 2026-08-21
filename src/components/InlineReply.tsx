import { useEffect, useRef, useState } from "react";
import {
  Send, Sparkles, ReplyAll, Forward, Maximize2,
  Loader2, CheckCircle2, AlertTriangle, Link2,
} from "lucide-react";
import type { Message } from "@/types/db";
import { useSendEmail, reconnectGoogle, textToHtml } from "@/hooks/useSendEmail";
import { generate } from "@/lib/ai";
import { cn } from "@/lib/utils";

/**
 * Answering the message you are reading, without leaving it.
 *
 * WHAT THIS REPLACES. The reading pane was a row of four buttons above a box
 * labelled "Original Message". Reply, Reply all, Forward and Draft a reply all
 * did the same thing to the screen: they opened a separate window docked in the
 * far corner, which covered the message being answered. Reading and replying
 * are one task and they had been split across two surfaces, so the commonest
 * action in an inbox cost a click and a context switch before a single
 * character could be typed.
 *
 * The box is now under the message, ready to type into. That is Gmail's shape,
 * and it is Gmail's shape for a reason: the thing you are answering stays on
 * screen while you answer it.
 *
 * WHAT STAYED IN THE WINDOW. Attachments, cc and bcc, and rich formatting. They
 * are real but occasional, and putting them inline would rebuild the whole
 * composer inside a 380px column. "Full composer" hands over whatever has been
 * typed, so reaching for them never costs the draft.
 *
 * WHY A TEXTAREA AND NOT contentEditable. A reply typed in a hurry is prose.
 * The rich editor is one button away for when it is not, and a plain field
 * cannot produce the pasted-markup mess contentEditable does.
 */
export function InlineReply({
  message, quotedHtml, myInitials, canReplyAll, onReplyAll, onForward, onPopOut, onSent,
}: {
  message: Message;
  /** The quoted original. Appended on send, never shown in the field. */
  quotedHtml: string;
  myInitials: string;
  canReplyAll: boolean;
  onReplyAll: () => void;
  onForward: () => void;
  /** Hands the half-written text to the full composer. */
  onPopOut: (text: string) => void;
  onSent: () => void;
}) {
  const [text, setText] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const { state, setState, send } = useSendEmail();
  const ref = useRef<HTMLTextAreaElement>(null);

  /* A new message means a new reply. Without this, moving down the list with
     j/k carries the previous half-written answer onto somebody else's mail,
     which is one of the few ways this screen could send a reply to the wrong
     person. */
  useEffect(() => {
    setText("");
    setDraftError(null);
    setState({ kind: "idle" });
  }, [message.id, setState]);

  /* Grows with the text rather than scrolling inside two lines. Capped, so a
     long reply cannot push the message it answers off the top of the pane. */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 260)}px`;
  }, [text]);

  /* Seven of the stored messages have an empty sender_email while carrying the
     address in sender_name, which is what Gmail gives us for mail you sent
     yourself. Keying the reply box on sender_email alone meant the message at
     the top of the inbox could not be answered at all. Nothing is invented
     here: the address is read from the other field it actually arrived in. */
  const looksLikeEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
  const to =
    message.sender_email?.trim() ||
    (looksLikeEmail(message.sender_name ?? "") ? (message.sender_name ?? "").trim() : "");
  const subject = /^re:/i.test(message.subject ?? "") ? message.subject ?? "" : `Re: ${message.subject ?? ""}`;
  const sending = state.kind === "sending";
  const busy = sending || drafting;

  async function onSend() {
    if (!text.trim() || busy) return;
    const ok = await send({
      to,
      subject,
      text,
      /* The quote travels with it, as in every mail client. It is not in the
         field because nobody edits it, and forty lines of it would bury the
         cursor. */
      html: textToHtml(text) + quotedHtml,
      threadId: (message as { thread_id?: string | null }).thread_id ?? null,
      inReplyTo: (message as { rfc_message_id?: string | null }).rfc_message_id ?? null,
    });
    if (ok) { setText(""); onSent(); }
  }

  async function onDraft() {
    if (busy) return;
    setDrafting(true);
    setDraftError(null);
    try {
      const out = await generate({
        tool: "quick_action",
        format: "AI Draft Response",
        inputs: { from: message.sender_name, subject: message.subject, message: message.body },
      });
      /* Written INTO the field, not into a panel beside it. A draft is a
         starting point you edit. An earlier version rendered it read-only, so
         using it meant retyping it. */
      setText(out.trim());
      requestAnimationFrame(() => ref.current?.focus());
    } catch (e) {
      setDraftError(e instanceof Error ? e.message : String(e));
    } finally {
      setDrafting(false);
    }
  }

  return (
    <div className="mt-4 border-t border-border pt-3">
      <div className="flex gap-2.5">
        <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[10px] font-semibold text-faint">
          {myInitials}
        </div>

        <div className="min-w-0 flex-1">
          <textarea
            ref={ref}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              /* Ctrl/Cmd+Enter sends. Plain Enter is a newline, because this is
                 a message body and not a search box. */
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void onSend(); }
              /* The page-level shortcuts treat single keys as commands, and
                 without this every "c" typed here would open the composer. */
              e.stopPropagation();
            }}
            rows={2}
            placeholder={to ? `Reply to ${message.sender_name}…` : "No address to reply to"}
            disabled={!to}
            aria-label={`Reply to ${message.sender_name}`}
            className="input min-h-[62px] w-full resize-none py-2 text-sm leading-relaxed"
          />

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <button
              className="btn-primary px-3 py-1.5 text-xs"
              onClick={onSend}
              disabled={!text.trim() || busy || !to}
              title="Send (Ctrl+Enter)"
            >
              {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
              {sending ? "Sending…" : "Send"}
            </button>

            <button
              className="btn-ghost border border-border px-2.5 py-1.5 text-xs"
              onClick={onDraft}
              disabled={busy}
              title="Write a first draft with AI, then edit it here"
            >
              {drafting ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
              {drafting ? "Writing…" : "AI draft"}
            </button>

            {/* Grouped and pushed right, so when the row runs out of width the
                three wrap together as a block instead of leaving one orphan
                glyph on a line of its own, which reads as a mistake. */}
            <div className="ml-auto flex items-center gap-1.5">
            {/* Icon-only, because the reading pane is about 330px wide and
                these three with labels wrapped the row onto three lines,
                pushing the message up out of the column that exists to show
                it. Each carries an aria-label as well as a title: a button
                whose only content is a glyph is unreadable to a screen
                reader, and a title alone does not fix that. */}
            <IconButton
              icon={<ReplyAll size={14} />}
              label="Reply all"
              onClick={onReplyAll}
              disabled={!canReplyAll}
              title={canReplyAll ? "Reply to everyone on this message" : "Only one recipient, so this is the same as replying"}
            />
            <IconButton
              icon={<Forward size={14} />}
              label="Forward"
              onClick={onForward}
              title="Forward this message"
            />
            <IconButton
              icon={<Maximize2 size={14} />}
              label="Open in full composer"
              onClick={() => onPopOut(text)}
              title="Full composer: attachments, cc and bcc, formatting"
            />
            </div>
          </div>

          <SendNotice state={state} draftError={draftError} />
        </div>
      </div>
    </div>
  );
}

function IconButton({
  icon, label, onClick, title, disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  title: string;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={label}
      className="btn-ghost grid h-8 w-8 place-items-center border border-border p-0"
    >
      {icon}
    </button>
  );
}

/**
 * What went wrong, phrased as the fix.
 *
 * A send that fails without saying so is the worst thing this screen can do,
 * because the reply looks sent and nobody chases it.
 */
function SendNotice({
  state, draftError,
}: {
  state: ReturnType<typeof useSendEmail>["state"];
  draftError: string | null;
}) {
  if (draftError) return <Notice>Could not write a draft. {draftError.slice(0, 160)}</Notice>;

  switch (state.kind) {
    case "sent":
      return (
        <p className="mt-2 flex items-center gap-1.5 text-[12.5px] text-emerald-300">
          <CheckCircle2 size={13} /> Sent.
        </p>
      );
    case "not_connected":
      return (
        <Notice>
          No Google account is connected, so this cannot send.{" "}
          <button className="underline underline-offset-2" onClick={() => void reconnectGoogle()}>
            <Link2 size={11} className="inline" /> Connect Google
          </button>
        </Notice>
      );
    case "needs_scope":
      return (
        <Notice>
          The Google connection can read mail but not send it.{" "}
          <button className="underline underline-offset-2" onClick={() => void reconnectGoogle()}>
            Reconnect and allow sending
          </button>
        </Notice>
      );
    case "error":
      return <Notice>Not sent. {state.detail.slice(0, 200)}</Notice>;
    default:
      return null;
  }
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p className={cn(
      "mt-2 flex items-start gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/5 p-2 text-[12.5px] text-amber-200",
    )}>
      <AlertTriangle size={13} className="mt-px shrink-0" />
      <span>{children}</span>
    </p>
  );
}
