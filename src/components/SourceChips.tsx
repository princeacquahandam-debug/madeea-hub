import { Link } from "react-router-dom";
import { Lock, Plus } from "lucide-react";
import { REAL_CHANNELS, isUsable, type ChannelId } from "@/lib/channels";
import { cn } from "@/lib/utils";

/**
 * Where messages came FROM, as a filter rather than a second navigation.
 *
 * THE PROBLEM THIS REPLACES. The screen had two navigations that had to be
 * mentally crossed: a rail down the left picked the source, tabs across the top
 * picked the view, and neither told you what the other was doing. Ten filter
 * affordances stood between you and the first message. The give-away was in the
 * help text, which had to spell out "Two separate questions." When a sentence
 * of prose is load-bearing for two adjacent controls, one of them is the wrong
 * control.
 *
 * A view is now the only navigation. Source is a filter that narrows it, which
 * is what it always was: nobody thinks of Gmail as a place they go, they think
 * of it as where a message happened to arrive.
 *
 * Multi-select, with "All sources" as the resting state, so the default answers
 * the question people actually have ("what needs me") rather than making them
 * assemble it from two coordinates.
 *
 * CHANNELS THAT DO NOT WORK YET ARE SHOWN, AND THIS IS THE DELICATE PART. They
 * are here so the answer to "does this handle Instagram?" is on the screen
 * rather than in someone's head. But a chip that looks like the Gmail chip and
 * silently matches nothing is worse than hiding it: you would filter to
 * LinkedIn, see an empty list, and reasonably conclude there were no LinkedIn
 * messages, rather than that we cannot read LinkedIn at all.
 *
 * So they are not filters. They are locked, sit behind a divider, carry a lock
 * glyph rather than only a lighter colour, and lead to the page that says what
 * each one actually needs. Three separate signals, because tone alone fails for
 * anyone who cannot see it.
 */
export function SourceChips({
  active, counts, onToggle,
}: {
  /** Empty set means all sources, which is the default. */
  active: Set<ChannelId>;
  counts: Record<string, number>;
  onToggle: (id: ChannelId) => void;
}) {
  const live = REAL_CHANNELS.filter(isUsable);
  const locked = REAL_CHANNELS.filter((c) => !isUsable(c));
  const all = active.size === 0;

  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filter by source">
      <button
        onClick={() => onToggle("all")}
        aria-pressed={all}
        className={cn(
          "flex min-h-[30px] items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-colors",
          all ? "bg-[var(--nav-active-bg)] text-[color:var(--nav-active-text)]" : "text-faint hover:bg-[var(--chip-bg)] hover:text-text",
        )}
      >
        All sources
      </button>

      {live.map((c) => {
        const on = active.has(c.id);
        const n = counts[c.id] ?? 0;
        return (
          <button
            key={c.id}
            onClick={() => onToggle(c.id)}
            aria-pressed={on}
            className={cn(
              "flex min-h-[30px] items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-colors",
              on ? "bg-[var(--nav-active-bg)] text-[color:var(--nav-active-text)]" : "text-faint hover:bg-[var(--chip-bg)] hover:text-text",
            )}
          >
            <c.icon size={13} />
            {c.label}
            {n > 0 && <span className="tabular-nums opacity-70">{n}</span>}
          </button>
        );
      })}

      {locked.length > 0 && (
        /* Structural, not decorative. It is what stops the eye reading the
           locked chips as more of the same row. */
        <span aria-hidden="true" className="mx-1 h-4 w-px shrink-0 bg-border" />
      )}

      {locked.map((c) => (
        <Link
          key={c.id}
          to="/integrations"
          /* The logo keeps its real colours: it is the fastest way to find the
             channel you are looking for, and greying it out would cost that for
             no gain. The lock and the muted label carry the state instead. */
          title={c.note ?? `${c.label} is not connected yet.`}
          aria-label={`${c.label}: not connected. See what it needs.`}
          className="flex min-h-[30px] items-center gap-1.5 rounded-full border border-dashed border-border px-2.5 text-xs font-medium text-faint transition-colors hover:border-[var(--border-strong)] hover:text-text"
        >
          <c.icon size={13} className="opacity-70" />
          {c.label}
          <Lock size={10} className="opacity-80" />
        </Link>
      ))}

      <Link
        to="/integrations"
        className="flex min-h-[30px] items-center gap-1 rounded-full border border-dashed border-border px-2.5 text-xs font-medium text-faint transition-colors hover:border-[var(--border-strong)] hover:text-text"
        title="Manage connections and see what each channel needs"
      >
        <Plus size={12} /> Connect
      </Link>
    </div>
  );
}
