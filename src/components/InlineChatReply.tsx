import { useEffect, useRef, useState } from "react";
import { Send, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import type { Message } from "@/types/db";
import { sendChatReply, isChatSource, type ChatSendResult } from "@/lib/chat";
import { cn } from "@/lib/utils";

/**
 * Answering a Slack, Discord or Teams message without leaving it.
 *
 * WHAT THIS REPLACES. A sentence: "This did not arrive by email, so there is no
 * address to reply to from here." That was true about EMAIL and false about the
 * message: a chat message carries the room it came from, which is a better
 * reply target than an email address because it cannot be typed wrong. Slack
 * had a composer at the bottom of the page where you re-picked the channel by
 * hand; Discord and Teams had nothing at all.
 *
 * WHY IT IS A SEPARATE COMPONENT FROM InlineReply. The email reply box carries
 * Reply all, Forward, a quoted original, cc/bcc, attachments and a pop-out to
 * the full composer. None of those exist in a chat: there is one room, one box
 * and one button. Sharing a component would have meant six props that are
 * always undefined on one side and a wrapper that hides half the UI.
 *
 * WHERE THE REPLY GOES, and why that is stated on screen. Into the same channel
 * or chat, named above the box. A chat reply that lands in the wrong room is
 * public in a way a misaddressed email is not.
 */
export function InlineChatReply({ message, onSent }: { message: Message; onSent?: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ChatSendResult | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  const source = message.source;
  /* Three different notions of "where does this go", because the services
     genuinely differ and pretending otherwise misroutes a reply:
       Slack     a channel NAME, which is what its subject holds
       Discord   the channel id, and Teams the chat id, both in thread_id
       Meta      a person, whose scoped id sync stored in reply_target */
  const target =
    source === "slack"
      ? (message.subject ?? "").replace(/^#/, "").trim()
      : source === "instagram" || source === "whatsapp"
        ? (message.reply_target ?? "").trim()
        : (message.thread_id ?? "").trim();
  const room = message.subject || "this conversation";

  /* A new message means a new reply. Without this, moving down the list with
     j/k carries a half-written answer onto somebody else's message, which in a
     chat means posting it to the wrong room. */
  useEffect(() => {
    setText("");
    setResult(null);
  }, [message.id]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  if (!isChatSource(source)) return null;

  async function send() {
    if (!text.trim() || busy || !isChatSource(source)) return;
    setBusy(true);
    setResult(null);
    const r = await sendChatReply(source, target, text, message.subject ?? undefined);
    setResult(r);
    setBusy(false);
    if (r.ok) { setText(""); onSent?.(); }
  }

  /* No target means the row predates sync storing one. Better to say that than
     to show a box whose Send can only ever fail. */
  if (!target) {
    return (
      <p className="mt-4 border-t border-border pt-3 text-xs text-faint">
        This message did not record where to send a reply, so it cannot be answered here. Sync again
        and the newer copy will be answerable.
      </p>
    );
  }

  return (
    <div className="mt-4 border-t border-border pt-3">
      <p className="mb-1.5 text-[11px] text-faint">
        Replying in <span className="font-medium text-muted">{room}</span>
      </p>
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // Enter sends, Shift+Enter is a newline. That is the convention in
          // every chat client, and this box is answering one.
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); }
        }}
        rows={2}
        placeholder={`Reply in ${room}…`}
        aria-label={`Reply in ${room}`}
        className="w-full resize-none rounded-lg border border-border bg-surface-2 px-3 py-2 text-[13px] outline-none placeholder:text-faint focus:border-accent/50"
      />
      <div className="mt-2 flex items-center gap-2">
        <button className="btn-primary py-1 text-[12px]" onClick={send} disabled={!text.trim() || busy}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Send
        </button>
        <span className="text-[11px] text-faint">Enter to send, Shift + Enter for a new line</span>
      </div>

      {result?.ok && (
        <p className="mt-2 flex items-center gap-1.5 text-[12.5px] text-emerald-300">
          <CheckCircle2 size={13} /> Sent.
        </p>
      )}
      {result && !result.ok && (
        <p className={cn(
          "mt-2 flex items-start gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/5 p-2 text-[12.5px] text-amber-200",
        )}>
          <AlertTriangle size={13} className="mt-px shrink-0" />
          {/* The reason, not "something went wrong": each of these has a
              different fix and the person reading it is the one who can apply
              it. */}
          <span>{result.detail ?? "Not sent."}</span>
        </p>
      )}
    </div>
  );
}
