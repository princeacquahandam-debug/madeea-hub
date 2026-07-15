/**
 * ToolExecution — the "loading experience". Instead of a spinner, shows an
 * animated typing indicator with a live progress verb (Creating…, Searching…,
 * Thinking…) while a tool runs, and a success/error flourish when it resolves.
 */
import { Check, AlertTriangle } from "lucide-react";
import type { Turn } from "@/lib/command-center/types";

export function ToolExecution({ turn }: { turn: Turn }) {
  if (turn.status === "running") {
    return (
      <div className="flex items-center gap-2.5 text-sm text-muted" role="status" aria-live="polite">
        <span className="cc-typing" aria-hidden>
          <span /><span /><span />
        </span>
        <span>{turn.progress ?? "Working…"}</span>
      </div>
    );
  }
  if (turn.status === "error") {
    return (
      <div className="flex items-center gap-2 text-sm text-red-400">
        <AlertTriangle size={15} /> <span>Couldn’t complete that.</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 text-sm text-emerald-400 cc-pop">
      <Check size={15} /> <span>Done</span>
    </div>
  );
}
