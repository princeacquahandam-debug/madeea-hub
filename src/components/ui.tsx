import { useEffect, type ReactNode } from "react";
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    if (open) document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center overflow-y-auto bg-black/70 sm:items-center sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      {/* Bottom sheet on mobile, centered card on sm+. */}
      <div
        className="modal-panel relative max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl rounded-b-none p-6 pb-8 sm:max-h-[85vh] sm:rounded-b-2xl sm:pb-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Grab handle (mobile only). */}
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-[var(--border-strong)] sm:hidden" />
        <button
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-lg text-faint transition-colors hover:bg-[var(--chip-bg)] hover:text-text"
          onClick={onClose}
          aria-label="Close"
        >
          <X size={18} />
        </button>
        {children}
      </div>
    </div>
  );
}
