import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
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
 * Channels that do not exist yet are NOT here. They used to hold permanent
 * space in the rail while doing nothing. They live behind Connect, which is
 * where you would go to change that, and Integrations still lists what each one
 * needs.
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

      <Link
        to="/integrations"
        className="flex min-h-[30px] items-center gap-1 rounded-full border border-dashed border-border px-2.5 text-xs font-medium text-faint transition-colors hover:border-[var(--border-strong)] hover:text-text"
        title="Connect WhatsApp, Discord and other channels"
      >
        <Plus size={12} /> Connect
      </Link>
    </div>
  );
}
