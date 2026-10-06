import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { MessageSquare, Sparkles, X } from "lucide-react";
import { useMadeline } from "@/store/madeline";
import { AiReply } from "@/components/madeline/MadelinePanel";

/**
 * The pop-up a one-click AI action answers in.
 *
 * Client review, 6 Oct: "Plan my day", "Prep me for this meeting" and the
 * other one-click actions should show their result over the page you're on,
 * not send you to the sidebar chat. So they run at once and land here: a
 * working state, then the answer with everything the sidebar shows (sources,
 * next steps, the Create task and Add-to-calendar cards, 👍/👎).
 *
 * The answer is still a turn in Madeline's thread. "Continue in Madeline"
 * opens the sidebar right after it, for follow-up questions.
 */
export function InsightModal() {
  const insight = useMadeline((s) => s.insight);
  const turn = useMadeline((s) => (s.insight ? s.turns.find((t) => t.id === s.insight!.turnId) ?? null : null));
  const close = () => useMadeline.getState().setInsight(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!insight) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [insight]);

  if (!insight) return null;

  function continueInMadeline() {
    close();
    useMadeline.getState().setOpen(true);
  }

  return createPortal(
    /* z-[90]: above page modals (80) and the docked sidebar (85), below the
       command palette (95). */
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/55 p-0 sm:items-center sm:p-6" onMouseDown={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={insight.title}
        onMouseDown={(e) => e.stopPropagation()}
        className="card flex max-h-[88vh] w-full flex-col overflow-hidden rounded-b-none shadow-2xl sm:max-w-2xl sm:rounded-2xl"
        style={{ animation: "slideInChip 0.25s cubic-bezier(0.22,1,0.36,1)" }}
      >
        <div className="flex items-start gap-3 border-b border-border px-5 py-4">
          <span className="madeline-orb madeline-orb-still mt-0.5 h-7 w-7 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-[16px] font-extrabold leading-tight">
              <Sparkles size={15} className="shrink-0 text-accent" /> {insight.title}
            </p>
            {turn?.about && <p className="mt-0.5 truncate text-xs text-faint">{turn.about}</p>}
          </div>
          <button
            ref={closeRef}
            onClick={close}
            aria-label="Close"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-[var(--chip-bg)] hover:text-text"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4" aria-live="polite">
          {!turn || turn.status === "running" ? (
            <div className="flex items-center gap-3 py-6 text-sm text-muted">
              <span className="cc-typing" aria-hidden="true"><span /><span /><span /></span>
              Reading your calendar, mail, notes and tasks…
            </div>
          ) : turn.result?.kind === "text" ? (
            <div className="flex flex-col gap-3">
              <AiReply turn={turn} bare />
            </div>
          ) : (
            <p className="py-4 text-sm text-red-400">
              {turn.result?.kind === "error" ? turn.result.message : "Something went wrong. Try again."}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-3">
          <p className="text-xs text-faint">Nothing is sent or saved until you click.</p>
          <div className="flex gap-2">
            <button onClick={continueInMadeline} className="btn-ghost border border-border px-3 py-1.5 text-xs">
              <MessageSquare size={13} /> Continue in Madeline
            </button>
            <button onClick={close} className="btn-primary px-3 py-1.5 text-xs">Done</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
