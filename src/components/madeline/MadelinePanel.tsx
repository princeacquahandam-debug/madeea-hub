import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { ArrowUp, Check, Copy, PanelRightClose, Paperclip, RotateCcw, X } from "lucide-react";
import { Orb } from "@/components/layout/Orb";
import { ResultCard } from "@/components/command-center/ResultCard";
import { ConfirmDialog } from "@/components/command-center/ConfirmDialog";
import { useAuth } from "@/hooks/useAuth";
import { useMadelineEngine } from "@/hooks/useMadeline";
import { useMadeline, ITEM_LABEL, type MadelineItemKind, type MadelineTurn } from "@/store/madeline";
import { renderMarkdown } from "@/lib/sanitize";
import { cn } from "@/lib/utils";

/** A starter: `send` runs it at once, `fill` puts it in the box to finish. */
interface Starter { label: string; send?: string; fill?: string }

const STARTERS: Starter[] = [
  { label: "What's on my plate?", send: "What's on my plate today?" },
  { label: "Triage my inbox", send: "Triage my unread inbox: what needs a reply first, and why?" },
  { label: "Prep my next meeting", send: "Prep me for my next meeting." },
  { label: "Write an email", fill: "Write an email to " },
  { label: "Status report", send: "Write a short status report of my tasks this week." },
  { label: "How do I…", fill: "How do I " },
];

/* What people ask about the thing they have open. These are the reason the
   panel knows where you are: one tap instead of retyping the subject. */
const FOR_ITEM: Record<MadelineItemKind, Starter[]> = {
  task: [
    { label: "What's the next step?", send: "What's the next step on this task?" },
    { label: "Draft a client update", send: "Draft a short update for the client on this task." },
  ],
  meeting: [
    { label: "Prep me for this meeting", send: "Prep me for this meeting." },
    { label: "Draft a follow-up", send: "Draft a follow-up email for this meeting." },
  ],
  client: [
    { label: "Brief me on this client", send: "Brief me on this client: open tasks, recent emails and anything overdue." },
    { label: "Draft a check-in", send: "Draft a short check-in email to this client." },
  ],
  email: [
    { label: "Draft a reply", send: "Draft a reply to this email." },
    { label: "What does it need from me?", send: "Summarise this email and tell me what it needs from me." },
  ],
};

/**
 * The one Madeline panel. Docked beside the page on wide screens, sliding over
 * it below xl. Same component, same conversation, either way: the old rail and
 * floating bubble were two assistants with two histories, and crossing 1280px
 * swapped one for the other mid-conversation.
 */
export function MadelinePanel() {
  const open = useMadeline((s) => s.open);
  const setOpen = useMadeline((s) => s.setOpen);
  const turns = useMadeline((s) => s.turns);
  const clearTurns = useMadeline((s) => s.clearTurns);
  const draft = useMadeline((s) => s.draft);
  const setDraft = useMadeline((s) => s.setDraft);
  const focusToken = useMadeline((s) => s.focusToken);
  const setItem = useMadeline((s) => s.setItem);
  const { send, running, pendingConfirm, item, pageLabel } = useMadelineEngine();
  const { user } = useAuth();
  const navigate = useNavigate();

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, open]);

  // A page button filled the box: put the cursor at the end, ready to send.
  useEffect(() => {
    if (!open || !focusToken) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [focusToken, open]);

  // Grow the box with what's typed, up to about six lines.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [draft, open]);

  // Esc closes the slide-over. Docked on xl it stays, like any sidebar.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pendingConfirm && window.innerWidth < 1280) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, pendingConfirm, setOpen]);

  if (!open) return null;

  const firstName = user?.name?.split(" ")[0];
  const starters = item ? FOR_ITEM[item.kind] : STARTERS;

  function submit() {
    if (running || !draft.trim()) return;
    send(draft);
  }

  function runStarter(s: Starter) {
    if (s.send) send(s.send);
    else if (s.fill) { setDraft(s.fill); inputRef.current?.focus(); }
  }

  const go = (path: string) => navigate(path);

  /* Portalled to <body>. AppShell's root is `relative z-10`, a stacking
     context, so inside it z-[85] only outranks its siblings. Modals portal to
     <body> at z-[80] and were drawn over the panel, dimming it and eating its
     clicks at exactly the moment it has the open task as context. */
  return createPortal(
    <>
      {/* Below xl the panel covers the page, so the page dims and a tap outside closes it. */}
      <div className="fixed inset-0 z-[84] bg-black/50 xl:hidden" onClick={() => setOpen(false)} aria-hidden="true" />

      {/* z-[85] sits above page modals (z-[80]), so Madeline stays usable with a
          task or client open. That's exactly when it has something as context. */}
      <aside
        className={cn(
          "fixed right-0 z-[85] flex flex-col border-l border-border p-4 backdrop-blur-lg",
          "top-0 h-full w-full sm:w-[380px]",
          "xl:top-[66px] xl:h-[calc(100vh-66px)] xl:w-[340px]",
        )}
        style={{ background: "var(--glass)", animation: "slideInChip 0.3s cubic-bezier(0.22,1,0.36,1)" }}
        aria-label="Madeline"
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border pb-3">
          <Orb size={40} />
          <div className="min-w-0 flex-1">
            <p className="text-base font-extrabold tracking-tight">Madeline</p>
            <p className="truncate text-xs font-semibold text-accent" title={`You're on ${pageLabel}`}>
              On {pageLabel}
            </p>
          </div>
          {turns.length > 0 && (
            <button
              onClick={clearTurns}
              title="New conversation"
              aria-label="Start a new conversation"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-[var(--chip-bg)] hover:text-text"
            >
              <RotateCcw size={16} />
            </button>
          )}
          <button
            onClick={() => setOpen(false)}
            title="Close"
            aria-label="Close Madeline"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-[var(--chip-bg)] hover:text-text"
          >
            <PanelRightClose size={18} className="hidden xl:block" />
            <X size={18} className="xl:hidden" />
          </button>
        </div>

        {/* Conversation */}
        <div ref={scrollRef} className="flex flex-1 flex-col gap-3 overflow-y-auto py-3 pr-1" aria-live="polite">
          {turns.length === 0 && (
            <AiBubble>
              {`Hi${firstName ? ` ${firstName}` : ""}, I'm Madeline. I can see your tasks, calendar, inbox, clients and SOPs. ` +
                (item
                  ? `You have ${ITEM_LABEL[item.kind].toLowerCase()} "${item.label}" open, so ask me anything about it.`
                  : "Ask me anything, or pick a starter below.")}
            </AiBubble>
          )}
          {turns.map((t) => <TurnView key={t.id} turn={t} onNavigate={go} />)}
        </div>

        {/* Starters: about the open item when there is one, general otherwise. */}
        <div className="flex shrink-0 gap-2 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {starters.map((s) => (
            <button
              key={s.label}
              onClick={() => runStarter(s)}
              disabled={running && !!s.send}
              className="shrink-0 whitespace-nowrap rounded-full border border-border bg-surface-2 px-3 py-1.5 text-xs font-bold transition-colors hover:border-accent hover:text-accent disabled:opacity-40"
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* What Madeline is looking at. Removable: sometimes you want to ask
            about something else without closing the task first. */}
        {item && (
          <div className="mb-2 flex shrink-0 items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/10 px-2.5 py-1.5 text-xs">
            <Paperclip size={12} className="shrink-0 text-accent" />
            <span className="min-w-0 flex-1 truncate">
              <span className="font-bold">{ITEM_LABEL[item.kind]}:</span> {item.label}
            </span>
            <button onClick={() => setItem(null)} aria-label="Don't use this as context" className="shrink-0 text-faint hover:text-text">
              <X size={12} />
            </button>
          </div>
        )}

        {/* Input */}
        <form
          onSubmit={(e) => { e.preventDefault(); submit(); }}
          className="flex shrink-0 items-end gap-2 rounded-2xl border border-border py-1.5 pl-3.5 pr-1.5"
          style={{ background: "var(--glass-2)" }}
        >
          <textarea
            ref={inputRef}
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
            }}
            placeholder={item ? `Ask about this ${ITEM_LABEL[item.kind].toLowerCase()}…` : "Ask Madeline anything…"}
            aria-label="Message Madeline"
            className="min-w-0 flex-1 resize-none bg-transparent py-2 text-[13px] leading-snug text-text outline-none placeholder:text-faint"
          />
          <button
            type="submit"
            disabled={running || !draft.trim()}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent text-white transition-transform hover:scale-105 disabled:opacity-40"
            aria-label="Send"
          >
            <ArrowUp size={18} />
          </button>
        </form>

        {pendingConfirm && (
          <ConfirmDialog label={pendingConfirm.label} onConfirm={pendingConfirm.onConfirm} onCancel={pendingConfirm.onCancel} />
        )}
      </aside>
    </>,
    document.body,
  );
}

function TurnView({ turn, onNavigate }: { turn: MadelineTurn; onNavigate: (path: string) => void }) {
  return (
    <>
      <div className="flex max-w-[88%] flex-col items-end gap-1 self-end">
        {turn.about && <span className="truncate text-[10.5px] font-semibold text-faint">About {turn.about}</span>}
        <div className="whitespace-pre-wrap rounded-[14px_14px_4px_14px] bg-accent px-3.5 py-2.5 text-[13px] leading-relaxed text-white">
          {turn.prompt}
        </div>
      </div>
      {turn.status === "running" && (
        <div className="flex items-end gap-2 self-start">
          <span className="madeline-orb h-[22px] w-[22px] shrink-0" aria-hidden="true" />
          <div className="rounded-[14px_14px_14px_4px] border border-border bg-surface-2 px-3 py-2.5">
            <span className="cc-typing" aria-label="Madeline is thinking"><span /><span /><span /></span>
          </div>
        </div>
      )}
      {turn.result?.kind === "text" && <AiMarkdown markdown={turn.result.markdown} />}
      {turn.result && turn.result.kind !== "text" && (
        <div className="max-w-[92%] self-start">
          <ResultCard result={turn.result} onNavigate={onNavigate} />
        </div>
      )}
    </>
  );
}

function AiBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex max-w-[92%] items-end gap-2 self-start">
      <span className="madeline-orb h-[22px] w-[22px] shrink-0" aria-hidden="true" />
      <div className="rounded-[14px_14px_14px_4px] border border-border bg-surface-2 px-3.5 py-2.5 text-[13px] leading-relaxed">
        {children}
      </div>
    </div>
  );
}

/* Replies are markdown (lists, bold, the odd table), rendered through the
   app's sanitising pipeline. The rail showed them as raw text, asterisks and all. */
function AiMarkdown({ markdown }: { markdown: string }) {
  const html = useMemo(() => renderMarkdown(markdown), [markdown]);
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };
  return (
    <div className="group flex max-w-[92%] items-end gap-2 self-start">
      <span className="madeline-orb h-[22px] w-[22px] shrink-0" aria-hidden="true" />
      <div className="relative min-w-0 rounded-[14px_14px_14px_4px] border border-border bg-surface-2 px-3.5 py-2.5 text-[13px] leading-relaxed">
        <div className="md-body" dangerouslySetInnerHTML={{ __html: html }} />
        <button
          onClick={copy}
          className="absolute -bottom-2.5 right-2 flex items-center gap-1 rounded-md border border-border bg-surface px-1.5 py-0.5 text-[10.5px] text-faint opacity-0 transition-opacity hover:text-text focus:opacity-100 group-hover:opacity-100"
          aria-label="Copy reply"
        >
          {copied ? <Check size={11} /> : <Copy size={11} />} {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
