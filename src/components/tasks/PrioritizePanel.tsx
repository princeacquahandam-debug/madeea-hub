import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, Check, RotateCw, Sparkles, X } from "lucide-react";
import type { PrioritizeResult, RankedRow } from "@/lib/taskInsights";
import { useOutsideClose } from "@/hooks/useOutsideClose";
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
 *
 * 6 Nov 2026 call: a task with nothing to change used to show a greyed-out,
 * disabled checkbox, which read as "broken" next to a run that did offer
 * changes. Only rows with a change get a checkbox now; the others say "No
 * change needed", and a board with nothing to change says so and offers Done.
 * The top task is set apart as "Start here": what to do next is the point of
 * the feature. A click anywhere outside the panel closes it.
 */
export function PrioritizePanel({
  result, generatedAt, onClose, onRefresh, onOpenTask, onApply, onContinueInChat,
}: {
  result: PrioritizeResult;
  generatedAt: Date;
  /** How it was closed, for analytics: the ×, Discard, Escape or a click outside. */
  onClose: (how: "close" | "discard" | "escape" | "outside") => void;
  onRefresh: () => void;
  onOpenTask: (row: RankedRow) => void;
  onApply: (rows: RankedRow[]) => void;
  onContinueInChat: () => void;
}) {
  const withChange = useMemo(() => result.rows.filter((r) => r.change), [result]);
  const [checked, setChecked] = useState<Set<string>>(() => new Set(withChange.map((r) => r.task.id)));
  useEffect(() => setChecked(new Set(withChange.map((r) => r.task.id))), [withChange]);
  const count = withChange.filter((r) => checked.has(r.task.id)).length;
  const panelRef = useRef<HTMLElement>(null);
  useOutsideClose(panelRef, () => onClose("outside"));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose("escape"); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const ago = Math.round((Date.now() - generatedAt.getTime()) / 60000);
  const when = ago < 1 ? "just now" : `${ago} min ago`;
  const [first, ...rest] = result.rows;

  const changeChip = (r: RankedRow) => r.change && (
    <span className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs">
      <span className="text-muted">{r.change.label}</span>
      {r.change.field !== "assignee" && <><span className="text-faint line-through decoration-faint/60">{r.change.from}</span><ArrowRight size={11} className="text-faint" /></>}
      <span className="font-semibold text-accent">{r.change.to}</span>
    </span>
  );
  const toggle = (id: string) => setChecked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  /* A checkbox only where there is something to apply; otherwise a plain note. */
  const box = (r: RankedRow) => r.change ? (
    <input
      type="checkbox"
      className="mt-1 h-4 w-4 shrink-0 accent-[rgb(var(--c-accent))]"
      checked={checked.has(r.task.id)}
      aria-label={`Apply the change to ${r.task.title}`}
      onChange={() => toggle(r.task.id)}
    />
  ) : <span className="mt-1 h-4 w-4 shrink-0" aria-hidden="true" />;

  return createPortal(
    <aside
      ref={panelRef}
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

        {/* 3. The next action, set apart: this is what the feature is for. */}
        {first && (
          <div className="mb-3 rounded-xl border-2 border-accent/60 bg-[var(--nav-active-bg)] p-3">
            <p className="mb-1 flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-accent">
              <ArrowRight size={12} /> Start here
            </p>
            <div className="flex gap-2.5">
              {box(first)}
              <div className="min-w-0 flex-1">
                <button onClick={() => onOpenTask(first)} className="text-left text-[15px] font-bold text-[color:var(--nav-active-text)] hover:underline">
                  {first.task.title}
                </button>
                <p className="mt-0.5 text-sm font-medium text-text">{first.reason}</p>
                {changeChip(first)}
              </div>
            </div>
          </div>
        )}

        {rest.length > 0 && <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-faint">Then</p>}
        <ul className="divide-y divide-border">
          {rest.map((r) => (
            <li key={r.task.id} className="flex gap-2.5 py-3">
              {box(r)}
              <div className="min-w-0 flex-1">
                {/* Ranked task: real title, opens the card. */}
                <button onClick={() => onOpenTask(r)} className="text-left text-sm font-semibold hover:text-accent hover:underline">
                  {r.rank !== null ? `${r.rank} · ` : ""}{r.task.title}
                </button>
                {/* Reason: one fact. */}
                <p className="text-xs text-muted">{r.reason}</p>
                {r.change ? changeChip(r) : <p className="mt-1 flex items-center gap-1 text-[11px] text-faint"><Check size={11} /> No change needed</p>}
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* Sticky footer: nothing is saved before the click. */}
      <div className="border-t border-border px-4 py-3">
        {withChange.length === 0 ? (
          <>
            <p className="mb-2 text-xs text-muted">Nothing on the board needs changing. Work through the tasks in this order.</p>
            <button className="btn-primary w-full justify-center" onClick={() => onClose("close")}>Done</button>
          </>
        ) : (
          <div className="flex gap-2">
            <button className="btn-primary flex-1 justify-center" disabled={count === 0} onClick={() => onApply(withChange.filter((r) => checked.has(r.task.id)))}>
              Apply {count} {count === 1 ? "change" : "changes"}
            </button>
            <button className="btn-ghost border border-border" onClick={() => onClose("discard")}>Discard</button>
          </div>
        )}
        <div className="mt-2 flex items-center justify-between text-[11px]">
          <span className="text-faint">{withChange.length ? "Nothing changes until you apply." : "Click outside to close."}</span>
          <button onClick={onContinueInChat} className="font-semibold text-accent-soft hover:underline">Continue in chat →</button>
        </div>
      </div>
    </aside>,
    document.body,
  );
}
