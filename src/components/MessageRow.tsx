import { AlertTriangle, Paperclip } from "lucide-react";
import type { Message } from "@/types/db";
import { REAL_CHANNELS } from "@/lib/channels";
import { initials } from "@/lib/utils";
import { cn } from "@/lib/utils";

/**
 * One row in the inbox, at Gmail's density.
 *
 * The old version was a card per message: avatar, subject, two pill badges and
 * a preview, about 90px tall. Six fitted on screen. Gmail puts a line per
 * message because an inbox is scanned, not read, and the scan is
 * sender -> subject -> when. That order is why sender is bold and leftmost,
 * subject and preview share a line, and the time is right-aligned.
 *
 * Unread is weight, not colour (§1 color-not-only, §5 visual-hierarchy). A
 * breach adds an icon as well as a tint, so it survives a colourblind reader
 * and a greyscale screenshot.
 */
export function MessageRow({
  m, selected, breached, waitingLabel, onSelect,
}: {
  m: Message;
  selected: boolean;
  breached: boolean;
  waitingLabel?: string;
  onSelect: () => void;
}) {
  const unread = m.direction !== "outbound" && !m.first_reply_at;
  const channel = REAL_CHANNELS.find((c) => c.source === (m as { source?: string }).source);
  const when = m.received_at
    ? new Date(m.received_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : m.time;

  return (
    <button
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "flex min-h-[44px] w-full items-center gap-3 border-b border-border px-3 py-2 text-left transition-colors",
        selected ? "bg-[var(--nav-active-bg)]" : "hover:bg-[var(--chip-bg)]",
        breached && !selected && "bg-red-500/[0.045]",
      )}
    >
      {/* Channel origin, so a mixed inbox is readable at a glance. */}
      <span
        className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-[10px] font-bold"
        style={{ background: `${channel?.tint ?? "var(--accent)"}22`, color: channel?.tint ?? "var(--accent)" }}
        title={channel?.label ?? "Message"}
      >
        {channel ? <channel.icon size={12} /> : initials(m.sender_name)}
      </span>

      {/* Fixed but narrow. Gmail gives the sender about a fifth of the row and
          spends the rest on what the message says, because you scan the
          subject far more often than the name. */}
      <span className={cn("w-28 shrink-0 truncate text-sm lg:w-36", unread ? "font-bold text-text" : "text-muted")}>
        {m.sender_name}
      </span>

      <span className="min-w-0 flex-1 truncate text-sm">
        <span className={unread ? "font-semibold text-text" : "text-muted"}>{m.subject}</span>
        {m.preview && <span className="text-faint"> &mdash; {m.preview}</span>}
      </span>

      {/* The icon always, the duration only when there is room for it. The
          badge was eating the subject on narrower panes, which is the wrong
          trade: knowing WHICH message is late matters more than how late. */}
      {breached && (
        <span
          className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-red-400"
          title={waitingLabel ? `Waiting ${waitingLabel}` : "Past the response target"}
        >
          <AlertTriangle size={12} />
          <span className="hidden xl:inline">{waitingLabel ?? "Late"}</span>
        </span>
      )}
      {(m as { has_attachment?: boolean }).has_attachment && <Paperclip size={13} className="shrink-0 text-faint" />}

      {/* Tabular so the column does not jitter between 9:05 and 11:48. */}
      <span className={cn("w-14 shrink-0 text-right text-xs tabular-nums", unread ? "font-semibold text-text" : "text-faint")}>
        {when}
      </span>
    </button>
  );
}
