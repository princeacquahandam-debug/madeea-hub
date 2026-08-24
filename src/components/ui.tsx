import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useDirtyGuard } from "@/hooks/useDirtyGuard";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const PILL_STYLES: Record<string, string> = {
  urgent: "bg-red-500/15 text-red-400",
  high: "bg-amber-500/15 text-amber-400",
  normal: "bg-zinc-500/15 text-zinc-300",
  low: "bg-zinc-500/10 text-zinc-400",
  reply: "bg-blue-500/15 text-blue-400",
  delegate: "bg-violet-500/15 text-violet-400",
  archive: "bg-zinc-500/10 text-zinc-400",
  done: "bg-emerald-500/15 text-emerald-400",
  in_progress: "bg-blue-500/15 text-blue-400",
  pending: "bg-zinc-500/15 text-zinc-300",
  prepared: "bg-emerald-500/15 text-emerald-400",
  needs_prep: "bg-amber-500/15 text-amber-400",
  active: "bg-emerald-500/15 text-emerald-400",
  paused: "bg-zinc-500/15 text-zinc-400",
};

export function Badge({ tone, children }: { tone?: string; children: ReactNode }) {
  return <span className={cn("pill", PILL_STYLES[tone ?? "normal"] ?? PILL_STYLES.normal)}>{children}</span>;
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 mb-6">
      <div>
        <h1 className="display text-3xl">{title}</h1>
        {subtitle && <p className="text-sm text-muted mt-1">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Modal({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const { ref, isDirty } = useDirtyGuard(open);
  /* Two separate states on purpose. A stray click on the backdrop is almost
     never a decision, so it does not get to discard anything: it nudges. A
     deliberate Escape or Close is a decision, so it gets asked. */
  const [confirming, setConfirming] = useState(false);
  const [nudge, setNudge] = useState(false);

  const attemptClose = useCallback(() => {
    if (isDirty()) { setConfirming(true); return; }
    onClose();
  }, [isDirty, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") attemptClose(); };
    if (open) document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, attemptClose]);

  useEffect(() => {
    if (!open) { setConfirming(false); setNudge(false); }
  }, [open]);

  useEffect(() => {
    if (!nudge) return;
    const t = setTimeout(() => setNudge(false), 2600);
    return () => clearTimeout(t);
  }, [nudge]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center overflow-y-auto bg-black/70 sm:items-center sm:p-4"
      /* NOT onClose. Clicking beside a dialog used to throw away everything
         typed into it, with no warning and no undo, which is a lot of damage
         for a misplaced click. */
      onClick={() => { if (isDirty()) setNudge(true); else onClose(); }}
      role="dialog"
      aria-modal="true"
    >
      {/* Bottom sheet on mobile, centered card on sm+. */}
      <div
        ref={ref as React.RefObject<HTMLDivElement>}
        className="modal-panel relative max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl rounded-b-none p-6 pb-8 sm:max-h-[85vh] sm:rounded-b-2xl sm:pb-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Grab handle (mobile only). */}
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-[var(--border-strong)] sm:hidden" />
        <button
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-lg text-faint transition-colors hover:bg-[var(--chip-bg)] hover:text-text"
          onClick={attemptClose}
          aria-label="Close"
        >
          <X size={18} />
        </button>

        {confirming && (
          <div
            role="alertdialog"
            aria-label="Discard changes?"
            className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 pr-12 text-[13px] text-amber-200"
          >
            <span className="min-w-0 flex-1">You have unsaved changes here.</span>
            <button className="btn-ghost border border-amber-500/40 px-2.5 py-1 text-xs" onClick={() => setConfirming(false)}>
              Keep editing
            </button>
            <button className="btn-primary px-2.5 py-1 text-xs" onClick={onClose}>
              Discard
            </button>
          </div>
        )}

        {nudge && !confirming && (
          <p className="mb-4 rounded-xl border border-border bg-surface-2 p-2.5 pr-12 text-[12.5px] text-muted" role="status">
            Your changes are still here. Use Close or Escape to leave.
          </p>
        )}

        {children}
      </div>
    </div>
  );
}
