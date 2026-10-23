import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, RotateCw, Sparkles, X } from "lucide-react";
import type { PrioritizeResult, RankedRow } from "@/lib/taskInsights";
import { cn } from "@/lib/utils";

/**
 * "Suggested priorities": the Prioritize board answer (Abder's spec, AI
 * output 2 of 3, 14 Oct 2026).
 *
 * A 440px panel that slides in from the right and leaves the board visible
 * beside it. Short explanation, then the ranked tasks: each with a reason and,
 * for at most five, one exact change shown as "Field From → To", pre-checked.
 * Nothing is written until "Apply N changes"; the page then offers Undo for
 * ten seconds. "Continue in chat" hands over to Madeline.
 */
export function PrioritizePanel({
  result, generatedAt, onClose, onRefresh, onOpenTask, onApply, onContinueInChat,
}: {
  result: PrioritizeResult;
  generatedAt: Date;
  /** How it was closed, for analytics: the ×, Discard, or Escape. */
  onClose: (how: "close" | "discard" | "escape") => void;
  onRefresh: () => void;
  onOpenTask: (row: RankedRow) => void;
  onApply: (rows: RankedRow[]) => void;
  onContinueInChat: () => void;
}) {
  const withChange = useMemo(() => result.rows.filter((r) => r.change), [result]);
  const [checked, setChecked] = useState<Set<string>>(() => new Set(withChange.map((r) => r.task.id)));
  useEffect(() => setChecked(new Set(withChange.map((r) => r.task.id))), [withChange]);
  const count = withChange.filter((r) => checked.has(r.task.id)).length;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose("escape"); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const ago = Math.round((Date.now() - generatedAt.getTime()) / 60000);
  const when = ago < 1 ? "just now" : `${ago} min ago`;

  return createPortal(
    <aside
      role="dialog"
      aria-label="Suggested priorities"
      className="fixed bottom-0 right-0 top-0 z-[80] flex w-full flex-col border-l border-border bg-surface shadow-2xl sm:w-[440px]"
      style={{ animation: "slideInRight 0.25s cubic-bezier(0.22,1,0.36,1)" }}
    >
      {/* 1. Source line: what was read. */}
      <div className="flex items-start gap-2.5 border-b border-border px-4 py-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--nav-active-bg)] text-accent"><Sparkles size={15} /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Suggested priorities</p>
          <p className="text-xs text-faint">Madeline · {result.reviewed} {result.reviewed === 1 ? "task" : "tasks"} reviewed · {when}</p>
        </div>
        <button onClick={onRefresh} aria-label="Review again" title="Review again" className="icon-btn text-faint hover:text-text"><RotateCw size={15} /></button>
        <button onClick={() => onClose("close")} aria-label="Close" className="icon-btn text-faint hover:text-text"><X size={16} /></button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {/* 2. Summary, counts first. */}
        <p className="mb-3 text-sm text-muted">{result.summary}</p>
        <ul className="divide-y divide-border">
          {result.rows.map((r) => {
            const on = checked.has(r.task.id);
            const grey = !r.change;
            return (
              <li key={r.task.id} className={cn("flex gap-2.5 py-3", grey && "opacity-60")}>
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 shrink-0 accent-[rgb(var(--c-accent))]"
                  checked={on && !grey}
                  disabled={grey}
                  aria-label={grey ? `${r.task.title}: no change` : `Apply the change to ${r.task.title}`}
                  onChange={() => setChecked((s) => { const n = new Set(s); if (n.has(r.task.id)) n.delete(r.task.id); else n.add(r.task.id); return n; })}
                />
                <div className="min-w-0 flex-1">
                  {/* 3. Ranked task: real title, opens the card. */}
                  <button onClick={() => onOpenTask(r)} className="text-left text-sm font-semibold hover:text-accent hover:underline">
                    {r.rank !== null ? `${r.rank} · ` : ""}{r.task.title}
                  </button>
                  {/* 4. Reason: one fact. */}
                  <p className="text-xs text-muted">{r.reason}</p>
                  {/* 5. Change chip: Field From → To. */}
                  {r.change && (
                    <span className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs">
                      <span className="text-muted">{r.change.label}</span>
                      {r.change.field !== "assignee" && <><span className="text-faint line-through decoration-faint/60">{r.change.from}</span><ArrowRight size={11} className="text-faint" /></>}
                      <span className="font-semibold text-accent">{r.change.to}</span>
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {/* 7. Sticky footer: nothing is saved before the click. */}
      <div className="border-t border-border px-4 py-3">
        <div className="flex gap-2">
          <button className="btn-primary flex-1 justify-center" disabled={count === 0} onClick={() => onApply(withChange.filter((r) => checked.has(r.task.id)))}>
            Apply {count} {count === 1 ? "change" : "changes"}
          </button>
          <button className="btn-ghost border border-border" onClick={() => onClose("discard")}>Discard</button>
        </div>
        <div className="mt-2 flex items-center justify-between text-[11px]">
          <span className="text-faint">Nothing changes until you apply.</span>
          <button onClick={onContinueInChat} className="font-semibold text-accent-soft hover:underline">Continue in chat →</button>
        </div>
      </div>
    </aside>,
    document.body,
  );
}
