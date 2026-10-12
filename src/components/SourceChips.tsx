import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { Check, ChevronDown, Lock, Plus } from "lucide-react";
import { useAnchoredPanel, ANCHORED_PANEL_CLASS } from "@/hooks/useAnchoredPanel";
import { REAL_CHANNELS, isUsable, type ChannelId } from "@/lib/channels";
import { useChannelStates } from "@/components/ChannelConnections";
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
  /* LIVE STATE, NOT THE CATALOGUE. isUsable() says the Hub supports a
     channel, which read as "connected" for Slack and Instagram on accounts
     that had never connected either (28 Sep audit). A chip is a filter when
     this person has the channel connected, or messages from it are already
     here (a workspace Slack someone else installed). Anything else is shown
     locked, as not connected, and leads to Integrations. While the check is
     still loading nothing is locked, so the chips don't flicker. */
  const states = useChannelStates();
  const works = (id: ChannelId) => Boolean(states[id]?.loading || states[id]?.connected || (counts[id] ?? 0) > 0);
  const live = REAL_CHANNELS.filter((c) => isUsable(c) && works(c.id));
  /* Not shown at all any more (client review, 6 Oct: locked chips were
     clutter). "+ Connect" leads to the rest. */
  const locked: typeof REAL_CHANNELS = [];
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
        <span aria-hidden="true" className="mx-1 hidden h-4 w-px shrink-0 bg-border sm:block" />
      )}

      {locked.map((c) => (
        <Link
          key={c.id}
          to="/integrations"
          /* The logo keeps its real colours: it is the fastest way to find the
             channel you are looking for, and greying it out would cost that for
             no gain. The lock and the muted label carry the state instead. */
          title={isUsable(c) ? `${c.label} isn't connected on your account. Connect it in Integrations.` : c.note ?? `${c.label} isn't available yet.`}
          aria-label={`${c.label}: not connected. See what it needs.`}
          className="hidden min-h-[30px] items-center gap-1.5 rounded-full border border-dashed border-border px-2.5 text-xs font-medium text-faint transition-colors hover:border-[var(--border-strong)] hover:text-text sm:flex"
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
        <Plus size={12} /> Connect{live.length === 0 ? " a channel" : ""}
      </Link>
    </div>
  );
}

/**
 * The same filter as one "All sources" dropdown (12 Oct 2026, UI review deck
 * slide 4: two filter rows became one). It also holds "Connect a channel".
 * Same rules as the chips: only channels this person has, or has messages from.
 */
export function SourceMenu({
  active, counts, onToggle,
}: {
  active: Set<ChannelId>;
  counts: Record<string, number>;
  onToggle: (id: ChannelId) => void;
}) {
  const { anchorRef, panelRef, open, setOpen, pos } = useAnchoredPanel<HTMLButtonElement>();
  const states = useChannelStates();
  const works = (id: ChannelId) => Boolean(states[id]?.loading || states[id]?.connected || (counts[id] ?? 0) > 0);
  const live = REAL_CHANNELS.filter((c) => isUsable(c) && works(c.id));
  const all = active.size === 0;
  const label = all ? "All sources" : active.size === 1 ? REAL_CHANNELS.find((c) => active.has(c.id))?.label ?? "1 source" : `${active.size} sources`;
  const row = "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-surface-2";
  return (
    <>
      <button ref={anchorRef} onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open}
        className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 text-sm text-text transition-colors hover:bg-[var(--chip-bg)]">
        {label} <ChevronDown size={14} className="text-faint" />
      </button>
      {open && pos && createPortal(
        <div ref={panelRef} role="menu" aria-label="Filter by source" style={{ top: pos.top, right: pos.right }} className={`card ${ANCHORED_PANEL_CLASS} !w-60 p-1.5 shadow-xl`}>
          <button role="menuitemradio" aria-checked={all} className={row} onClick={() => { onToggle("all"); setOpen(false); }}>
            <span className="w-4">{all && <Check size={14} className="text-accent" />}</span> All sources
          </button>
          {live.map((c) => {
            const on = active.has(c.id);
            const n = counts[c.id] ?? 0;
            return (
              <button key={c.id} role="menuitemcheckbox" aria-checked={on} className={row} onClick={() => onToggle(c.id)}>
                <span className="w-4">{on && <Check size={14} className="text-accent" />}</span>
                <c.icon size={14} /> <span className="flex-1">{c.label}</span>
                {n > 0 && <span className="text-xs tabular-nums text-faint">{n}</span>}
              </button>
            );
          })}
          <div className="mt-1 border-t border-border pt-1">
            <Link to="/integrations" role="menuitem" className={cn(row, "text-muted")} onClick={() => setOpen(false)}>
              <span className="w-4"><Plus size={14} /></span> Connect a channel
            </Link>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
