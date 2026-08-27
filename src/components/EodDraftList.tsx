import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * An editable list of draft lines.
 *
 * Lifted out of pages/EodReports when clocking out started collecting the EOD
 * as well. Two copies of a list editor would have meant two behaviours for the
 * same report: the page's version could grow a fix the clock-out dialog never
 * got, and the difference would only show up in whichever surface somebody
 * happened not to be using.
 */
export function DraftList({
  title,
  items,
  dot,
  empty,
  onChange,
  onPush,
  pushLabel,
}: {
  title: string;
  items: string[];
  dot: string;
  empty: string;
  onChange: (next: string[]) => void;
  /** R-4.3.4: turn this line into a real task. Only the plan list passes it. */
  onPush?: (title: string) => void;
  pushLabel?: string;
}) {
  const [add, setAdd] = useState("");
  /* Which lines have been pushed, by index. Local and deliberately not
     persisted: it exists so you can see the click landed and not create the
     same task three times in one sitting. The board is the real record. */
  const [pushed, setPushed] = useState<Set<number>>(new Set());

  return (
    <div>
      <p className="eyebrow mb-1.5">{title}</p>
      <ul className="space-y-1">
        {items.map((t, i) => (
          <li key={i} className="group flex items-start gap-2 rounded-md px-1 py-0.5 hover:bg-surface-2/60">
            <span className={cn("mt-2 h-1.5 w-1.5 shrink-0 rounded-sm", dot)} />
            <span className="min-w-0 flex-1 text-sm text-zinc-200">{t}</span>
            {onPush && (
              <button
                className={cn(
                  "shrink-0 text-[11px] transition-opacity",
                  pushed.has(i)
                    ? "text-emerald-400 opacity-100"
                    : "reveal-on-hover text-faint hover:text-accent",
                )}
                onClick={() => { onPush(t); setPushed((s) => new Set(s).add(i)); }}
                disabled={pushed.has(i)}
                title={pushed.has(i) ? "Already on the board" : `${pushLabel} for the next day`}
              >
                {pushed.has(i) ? "On the board" : pushLabel}
              </button>
            )}
            <button
              className="reveal-on-hover shrink-0 text-[11px] text-faint hover:text-red-400"
              onClick={() => onChange(items.filter((_, j) => j !== i))}
              aria-label={`Remove "${t}"`}
            >
              Remove
            </button>
          </li>
        ))}
        {items.length === 0 && <li className="px-1 text-xs text-faint">{empty}</li>}
      </ul>
      <form
        className="mt-1.5 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!add.trim()) return;
          onChange([...items, add.trim()]);
          setAdd("");
        }}
      >
        <input
          className="input py-1 text-xs"
          placeholder={`Add to ${title.toLowerCase()}…`}
          value={add}
          onChange={(e) => setAdd(e.target.value)}
        />
        <button type="submit" className="btn-ghost shrink-0 px-3 py-1 text-xs" disabled={!add.trim()}>
          Add
        </button>
      </form>
    </div>
  );
}
