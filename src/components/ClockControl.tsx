import { useNavigate } from "react-router-dom";
import { Play, Square } from "lucide-react";
import { entrySeconds, useTimeEntries, useTimeMutations } from "@/data/hooks";
import { useNow } from "@/hooks/useNow";
import { cn } from "@/lib/utils";

/**
 * Clock in / out, in the header on every page.
 *
 * R-4.5.2 is the whole reason this is not tucked away on the Time page:
 * attendance is only recorded if the EA opens the app and starts the tracker,
 * and that is the deliberate adoption mechanism (Rowena 34:25, Rio 34:31). A
 * control you have to go looking for does not force anything — this one is
 * either counting or visibly not counting, on every screen.
 *
 * Clocking IN is one click. Clocking OUT is one click. Choosing a task is on
 * the Time page, because making it a required first decision is how people end
 * up not starting the timer at all.
 */
export function ClockControl() {
  const nav = useNavigate();
  const { data: entries = [] } = useTimeEntries();
  const { start, stop } = useTimeMutations();

  const running = entries.find((e) => !e.ended_at);
  const now = useNow(running ? 1000 : null);

  const label = (() => {
    if (!running) return "Clock in";
    const s = entrySeconds(running, now);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}`;
  })();

  return (
    <button
      className={cn(
        "flex h-10 items-center gap-1.5 rounded-xl border px-3 text-sm font-bold transition-colors",
        running
          ? "border-emerald-500/60 text-emerald-400 hover:bg-emerald-500/10"
          : "border-border text-muted hover:bg-[var(--chip-bg)] hover:text-text",
      )}
      onClick={() => (running ? stop.mutate(running.id) : start.mutate({}))}
      // Right-click / long-press goes to the full timesheet rather than
      // hijacking the primary click, which has to stay one-tap.
      onContextMenu={(e) => { e.preventDefault(); nav("/time"); }}
      disabled={start.isPending || stop.isPending}
      title={running ? "Clock out — right-click for the timesheet" : "Clock in. Attendance is recorded from this."}
      aria-label={running ? "Clock out" : "Clock in"}
    >
      {running ? <Square size={15} /> : <Play size={15} />}
      <span className="tabular-nums">{label}</span>
    </button>
  );
}
