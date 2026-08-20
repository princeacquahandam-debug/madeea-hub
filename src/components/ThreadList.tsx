import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Client, Message } from "@/types/db";
import type { Thread } from "@/lib/threads";
import { MessageRow } from "@/components/MessageRow";
import { dayLength, formatDuration, isBreaching, waitingHours } from "@/lib/sla";
import type { SlaConfig } from "@/store/slaSettings";

/**
 * The message list, rendering only what is on screen.
 *
 * WHY VIRTUALIZE 89 ROWS. It is not for 89. The inbox holds one mailbox's
 * recent mail today; the product is sold to an agency whose EAs each cover
 * several executives, and the acceptance target is 5,000 messages. At that size
 * the un-virtualized list is 5,000 buttons, each with an avatar, a relative
 * timestamp and an SLA computation, all mounted at once: the page takes seconds
 * to become interactive and every keystroke in the search box re-renders all of
 * them. Windowing is the difference between a list that scales and one that
 * works right up until the day it matters.
 *
 * THE SCROLLER IS THIS ELEMENT, not the page. That is the one real cost: the
 * list scrolls inside its own box rather than with the document. It is also
 * what lets the reader stay put beside it without a sticky hack fighting the
 * page scroll.
 *
 * ROW HEIGHT IS FIXED. Both lines of a row are `truncate`, so nothing wraps and
 * every row is exactly 62px. `measureElement` was here with a 68px estimate,
 * which meant every row reported a correction; dropping it is right on the
 * merits, but be clear that it was NOT a performance fix. Removing it changed
 * frame time by nothing at all, and the profile explains why: during a scroll
 * the main thread is 88% idle, so there was no measure loop to remove.
 *
 * If a row ever gains a wrapping element, put measureElement back.
 *
 * WHAT THE FRAME BUDGET ACTUALLY GOES ON, since it is not this component.
 * Measured at 1440x900 with 1,000 messages, scrolling 200px per frame:
 *
 *   as shipped                          187ms median
 *   with the ambient background off      34ms median
 *
 * The page paints an animated gradient behind everything, and repainting it is
 * the cost. The list's own JavaScript is about 23ms per frame by CPU profile.
 * Both numbers come from headless Chromium, which rasterises in software with
 * no GPU, so a real machine will be considerably cheaper: treat them as a
 * ranking of causes, not as what a user experiences.
 */
export function ThreadList({
  threads, selectedId, clients, cfg, now, showChannel, onSelect, clientFor, emptyState,
}: {
  threads: Thread[];
  selectedId: string | null;
  clients: Client[];
  cfg: SlaConfig;
  now: number;
  showChannel: boolean;
  onSelect: (m: Message) => void;
  clientFor: (m: Message) => Client | null;
  emptyState: React.ReactNode;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const dl = dayLength(cfg);

  const rows = useVirtualizer({
    count: threads.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 62,
    // A few rows above and below, so a fast scroll does not show blank space
    // before React catches up.
    overscan: 8,
  });

  if (threads.length === 0) {
    return <div className="card p-1.5">{emptyState}</div>;
  }

  return (
    <div
      ref={parentRef}
      className="card max-h-[calc(100dvh-13rem)] overflow-y-auto p-1.5"
      // The list is a single selection, and a screen reader should hear that
      // rather than 89 unrelated buttons.
      role="listbox"
      aria-label="Conversations"
    >
      <div className="relative w-full" style={{ height: rows.getTotalSize() }}>
        {rows.getVirtualItems().map((v) => {
          const t = threads[v.index];
          const m = t.head;
          const late = isBreaching(m, clientFor(m), cfg);
          const waiting = waitingHours(m, cfg);
          // Only an UNANSWERED breach is actionable. An answered-but-late thread
          // is history: worth recording, but flagging it red implies work that
          // no longer exists.
          const breached = late && waiting !== null;
          return (
            <div
              key={t.head.id}
              data-index={v.index}
              className="absolute left-0 top-0 w-full"
              style={{ height: v.size, transform: `translateY(${v.start}px)` }}
              role="option"
              aria-selected={selectedId === m.id}
            >
              <MessageRow
                m={m}
                now={now}
                selected={selectedId === m.id}
                breached={breached}
                threadCount={t.count}
                unread={t.unread}
                showChannel={showChannel}
                waitingLabel={waiting !== null ? formatDuration(waiting, dl) : undefined}
                onSelect={() => onSelect(m)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
