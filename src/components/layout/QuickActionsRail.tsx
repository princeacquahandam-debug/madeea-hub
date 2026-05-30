import { Sparkles } from "lucide-react";
import { QUICK_RAIL } from "@/lib/constants";

export function QuickActionsRail() {
  return (
    <aside className="hidden xl:flex h-full w-72 flex-col border-l border-border bg-surface">
      <div className="px-5 py-5">
        <h2 className="text-sm font-semibold">Quick AI Actions</h2>
        <p className="text-xs text-faint">Contextual shortcuts</p>
      </div>
      <div className="flex-1 overflow-y-auto px-3 space-y-2">
        {QUICK_RAIL.map((label) => (
          <button
            key={label}
            className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-left transition-colors hover:border-accent/40"
          >
            <span className="flex items-center gap-2 text-sm font-medium">
              <Sparkles size={14} className="text-accent-soft" />
              {label}
            </span>
            <p className="mt-0.5 pl-6 text-xs text-faint">Run AI instantly</p>
          </button>
        ))}
      </div>
      <div className="m-3 rounded-lg border border-border bg-surface-2 p-3">
        <div className="flex items-center gap-2 text-xs font-medium">
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          Claude AI Online
        </div>
        <p className="mt-1 text-xs text-faint">
          Communication Studio and Bookkeeping AI are powered by Claude. Chat assistant available
          24/7.
        </p>
      </div>
    </aside>
  );
}
