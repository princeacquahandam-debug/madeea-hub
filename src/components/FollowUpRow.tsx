import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { BellOff, MailQuestion, Clock3, ArrowRight } from "lucide-react";
import { useSnoozeMutations } from "@/data/hooks";
import { useFollowUpSettings } from "@/store/followupSettings";
import type { Flag } from "@/lib/followups";

const ICONS = { dead_thread: MailQuestion, stale_task: Clock3 } as const;

/**
 * One flagged item: what it is, WHY it's flagged, and the two things you can do
 * about it. Snoozing is the "stop nagging me" escape hatch — without it, a nudge
 * you've consciously decided to ignore would just keep shouting.
 */
export function FollowUpRow({ flag, onAction }: { flag: Flag; onAction?: () => void }) {
  const nav = useNavigate();
  const { snooze } = useSnoozeMutations();
  const snoozeDays = useFollowUpSettings((s) => s.config.snoozeDays);
  const [snoozeError, setSnoozeError] = useState("");
  const Icon = ICONS[flag.kind];

  async function doSnooze() {
    setSnoozeError("");
    try {
      // Await the write and only dismiss the row once it actually took. If the DB
      // refused it, keep the nag on screen with the reason rather than pretending
      // it was silenced.
      await snooze.mutateAsync({ item_type: flag.itemType, item_id: flag.itemId, days: snoozeDays });
      onAction?.();
    } catch (e) {
      setSnoozeError(e instanceof Error ? e.message : "Couldn't snooze that — please try again.");
    }
  }

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
      <div className="flex items-center gap-3">
        <Icon size={16} className="shrink-0 text-amber-400" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{flag.title}</p>
          <p className="truncate text-xs text-faint">
            {flag.subtitle} · <span className="text-amber-400">{flag.reason}</span>
          </p>
        </div>
        <button
          className="btn-ghost shrink-0 px-2 py-1 text-xs"
          onClick={doSnooze}
          disabled={snooze.isPending}
          title={`Hide for ${snoozeDays} days`}
        >
          <BellOff size={13} /> Snooze
        </button>
        <button
          className="btn-primary shrink-0 px-2.5 py-1 text-xs"
          onClick={() => {
            nav(flag.path);
            onAction?.();
          }}
        >
          Follow up <ArrowRight size={13} />
        </button>
      </div>
      {snoozeError && <p className="mt-2 text-xs text-red-300">{snoozeError}</p>}
    </div>
  );
}
