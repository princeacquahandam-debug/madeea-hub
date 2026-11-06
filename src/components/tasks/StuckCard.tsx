import { useRef, useState } from "react";
import { AlertTriangle, ArrowRight, CalendarDays, Check, MessageSquare, X } from "lucide-react";
import { APPROVAL_DAYS, STALE_DAYS, nextWorkingDay, type StuckRow } from "@/lib/taskInsights";
import { useOutsideClose } from "@/hooks/useOutsideClose";

/** When the rules (not the AI) found the task, the next step follows from its action. */
const FALLBACK_NEXT: Record<StuckRow["action"], string> = {
  set_date: "Agree a new due date and set it.",
  nudge: "Ask the assignee for an update today.",
  open: "Open it and decide the next step.",
};

/**
 * "Find stuck tasks" (Abder's spec, 14 Oct 2026): an inline card above the
 * board, with the stuck cards outlined on the board itself (Tasks.tsx). One row
 * per task: title · why it's stuck · days stuck · one action. Five at most,
 * then "Show N more". The source line states the thresholds used.
 *
 * Since the 6 Nov 2026 deck the rules decide what is stuck (at most 5) and the
 * AI writes each reason and next step (lib/taskStuckAi). When it can't be
 * reached the rules' own wording shows, and the summary says so.
 */
const SHOWN = 5;

export function StuckCard({
  rows, checked, summary, ai, onClose, onOpen, onSetDate, onNudge,
}: {
  rows: StuckRow[];
  checked: number;
  summary?: string;
  /** True when the AI made the list; false for the rules. */
  ai?: boolean;
  onClose: () => void;
  onOpen: (row: StuckRow) => void;
  onSetDate: (row: StuckRow, day: string) => void;
  onNudge: (row: StuckRow) => void;
}) {
  const [all, setAll] = useState(false);
  const [dating, setDating] = useState<string | null>(null);
  const [day, setDay] = useState(() => nextWorkingDay(new Date()));
  const [nudged, setNudged] = useState<Set<string>>(new Set());
  const shown = all ? rows : rows.slice(0, SHOWN);
  const actionBtn = "inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-border px-2 text-xs font-semibold transition-colors hover:bg-[var(--chip-bg)]";
  // A click anywhere else closes it (6 Nov 2026 call).
  const ref = useRef<HTMLElement>(null);
  useOutsideClose(ref, onClose);

  return (
    <section ref={ref} className="card mb-4 p-4" aria-label="Stuck tasks">
      <div className="mb-2 flex items-start gap-2">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold">
            {rows.length ? `${rows.length} stuck ${rows.length === 1 ? "task" : "tasks"}` : "Nothing is stuck"}
          </h2>
          <p className="text-xs text-faint">
            Madeline · {checked} open {checked === 1 ? "task" : "tasks"} checked · <>Stuck = overdue, blocked, no update in {STALE_DAYS}+ days, or waiting for approval {APPROVAL_DAYS}+ days{ai ? "; reasons by Madeline" : ""}</>
          </p>
          {summary && <p className="mt-1 text-sm text-muted">{summary}</p>}
        </div>
        <button onClick={onClose} aria-label="Close" className="icon-btn text-faint hover:text-text"><X size={16} /></button>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted">Nothing is stuck.</p>
      ) : (
        <ul className="divide-y divide-border">
          {shown.map((r) => (
            <li key={r.task.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2 text-sm">
              <button onClick={() => onOpen(r)} className="min-w-0 max-w-full truncate text-left font-semibold hover:text-accent hover:underline">{r.task.title}</button>
              <span className="min-w-0 flex-1 truncate text-muted">· {r.why}</span>
              <span className="shrink-0 text-xs tabular-nums text-faint">{r.days} {r.days === 1 ? "day" : "days"} stuck</span>
              {r.action === "set_date" && (dating === r.task.id ? (
                <span className="flex shrink-0 items-center gap-1">
                  <input type="date" className="input h-7 w-auto py-0 text-xs" value={day} min={nextWorkingDay(new Date())} onChange={(e) => setDay(e.target.value)} aria-label={`New due date for ${r.task.title}`} />
                  <button className={actionBtn} onClick={() => { onSetDate(r, day); setDating(null); }}><Check size={12} /> Save</button>
                </span>
              ) : (
                <button className={actionBtn} onClick={() => { setDay(nextWorkingDay(new Date())); setDating(r.task.id); }}><CalendarDays size={12} /> Set new date</button>
              ))}
              {r.action === "nudge" && (nudged.has(r.task.id)
                ? <span className="inline-flex h-7 items-center gap-1 text-xs font-semibold text-emerald-600"><Check size={12} /> Nudged</span>
                : <button className={actionBtn} onClick={() => { onNudge(r); setNudged((s) => new Set(s).add(r.task.id)); }}><MessageSquare size={12} /> Nudge assignee</button>)}
              {r.action === "open" && <button className={actionBtn} onClick={() => onOpen(r)}>Open</button>}
              {/* The next action is the point of this card (6 Nov 2026 call:
                  "you are ignoring it" in small grey type), so it stands out. */}
              <p className="flex w-full items-start gap-1.5 rounded-md bg-[var(--nav-active-bg)] px-2.5 py-1.5 text-[13px] font-semibold text-[color:var(--nav-active-text)]">
                <ArrowRight size={14} className="mt-[3px] shrink-0 text-accent" />
                <span><span className="text-accent">Next:</span> {r.next || FALLBACK_NEXT[r.action]}</span>
              </p>
            </li>
          ))}
        </ul>
      )}
      {rows.length > SHOWN && (
        <button className="mt-1 text-xs font-semibold text-accent-soft hover:underline" onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show ${rows.length - SHOWN} more`}
        </button>
      )}
    </section>
  );
}
