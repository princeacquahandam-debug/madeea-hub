import { useState } from "react";
import { track } from "@/lib/analytics";
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
  boxed = false,
  editable = false,
  aiFilled,
  review,
  onAccept,
  onRevert,
}: {
  title: string;
  items: string[];
  dot: string;
  empty: string;
  onChange: (next: string[]) => void;
  /** R-4.3.4: turn this line into a real task. Only the plan list passes it. */
  onPush?: (title: string) => void;
  pushLabel?: string;
  /** A bordered box with a dashed "Add item" field, for three side by side
      (12 Oct 2026, UI review deck slide 7). */
  boxed?: boolean;
  /** Click a line to reword it in place. */
  editable?: boolean;
  /** ✦ Lines Madeline wrote, highlighted (.ai-filled) until edited (AI quick actions deck, 6 Nov 2026). */
  aiFilled?: (text: string) => boolean;
  /** "Polish wording": the line's old text when it was reworded, for Accept / Revert. */
  review?: (text: string) => string | undefined;
  onAccept?: (index: number) => void;
  onRevert?: (index: number) => void;
}) {
  const [add, setAdd] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [value, setValue] = useState("");
  const commit = (i: number) => {
    const v = value.trim();
    setEditing(null);
    if (!v) onChange(items.filter((_, j) => j !== i));
    else if (v !== items[i]) onChange(items.map((x, j) => (j === i ? v : x)));
  };
  /* Which lines have been pushed, by index. Local and deliberately not
     persisted: it exists so you can see the click landed and not create the
     same task three times in one sitting. The board is the real record. */
  const [pushed, setPushed] = useState<Set<number>>(new Set());

  return (
    <div className={cn(boxed && "flex min-w-0 flex-col rounded-lg border border-border p-3")}>
      <p className={boxed ? "mb-1.5 text-[13px] font-semibold" : "eyebrow mb-1.5"}>{title}</p>
      <ul className={cn("space-y-1", boxed && "flex-1")}>
        {items.map((t, i) => {
          const was = review?.(t);
          return (
          <li key={i} className={cn("group flex flex-wrap items-start gap-x-2 rounded-md px-1 py-0.5 hover:bg-surface-2/60", aiFilled?.(t) && "ai-filled")} data-ai={aiFilled?.(t) ? "1" : undefined}>
            <span className={cn("mt-2 h-1.5 w-1.5 shrink-0 rounded-sm", dot)} />
            {editable && editing === i ? (
              <textarea
                autoFocus
                rows={2}
                className="input min-w-0 flex-1 py-1 text-sm"
                aria-label={`Edit "${t}"`}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onBlur={() => commit(i)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commit(i); }
                  if (e.key === "Escape") setEditing(null);
                }}
              />
            ) : editable ? (
              <button type="button" className="min-w-0 flex-1 cursor-text text-left text-sm text-zinc-200" title="Click to edit" onClick={() => { setValue(t); setEditing(i); }}>{t}</button>
            ) : (
              <span className="min-w-0 flex-1 text-sm text-zinc-200">{t}</span>
            )}
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
            {/* Polish wording: the old line beside the new, nothing kept until chosen. */}
            {was !== undefined && (
              <div className="mt-1 flex w-full flex-wrap items-center gap-2 pl-3.5 text-[11px]" data-testid="polish-review">
                <span className="min-w-0 flex-1 text-faint">Was: <span className="line-through decoration-faint/60">{was}</span></span>
                <button type="button" className="font-semibold text-emerald-500 hover:underline" onClick={() => onAccept?.(i)}>Accept</button>
                <button type="button" className="font-semibold text-muted hover:text-text hover:underline" onClick={() => onRevert?.(i)}>Revert</button>
              </div>
            )}
          </li>
          );
        })}
        {items.length === 0 && <li className="px-1 text-xs text-faint">{empty}</li>}
      </ul>
      <form
        className="mt-1.5 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!add.trim()) return;
          track("eod_item_added", { section: title.toLowerCase().replace(/[^a-z]+/g, "_").replace(/^_|_$/g, ""), source: "manual" });
          onChange([...items, add.trim()]);
          setAdd("");
        }}
      >
        <input
          className={cn("input py-1 text-xs", boxed && "mt-2 border-dashed")}
          placeholder={boxed ? "+ Add item" : `Add to ${title.toLowerCase()}…`}
          aria-label={`Add to ${title.toLowerCase()}`}
          value={add}
          onChange={(e) => setAdd(e.target.value)}
        />
        <button type="submit" className={cn("btn-ghost shrink-0 px-3 py-1 text-xs", boxed && !add.trim() && "hidden", boxed && "mt-2")} disabled={!add.trim()}>
          Add
        </button>
      </form>
    </div>
  );
}
