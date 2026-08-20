import { AlertTriangle, Paperclip } from "lucide-react";
import type { Message } from "@/types/db";
import { REAL_CHANNELS } from "@/lib/channels";
import { initials, cn } from "@/lib/utils";
import { relativeTime, fullTime, avatarHue, avatarColors } from "@/lib/relativeTime";

/**
 * One row in the unified inbox.
 *
 * Two lines, because a merged inbox has to answer two questions per message and
 * they compete for the same horizontal space: WHO is this from, and WHAT do
 * they want. The previous single-line layout gave the sender a fixed 144px
 * column and let the subject take the rest, which is right for Gmail (one
 * account, one naming convention) and wrong here, where a row can be a person
 * on Slack or a no-reply address on Gmail and the names are wildly different
 * lengths. Stacking them means neither gets truncated to fit the other.
 *
 * Line 1 is identity and age: name, then how long it has been sitting there.
 * Line 2 is the ask, in one line of muted text.
 *
 * The channel mark sits on the RIGHT, away from the avatar. Both are small
 * circles-ish and adjacent they read as one blob; separated, the eye picks up
 * "who" on the left and "where" on the right without confusing them.
 *
 * Unread is weight, never colour alone (§1 color-not-only). A breach adds an
 * icon as well as a tint, so it survives greyscale and a colourblind reader.
 */
export function MessageRow({
  m, selected, breached, waitingLabel, onSelect, now,
}: {
  m: Message;
  selected: boolean;
  breached: boolean;
  waitingLabel?: string;
  onSelect: () => void;
  /** Passed in so every row in a render agrees on "now" and the list is stable. */
  now?: number;
}) {
  const unread = m.direction !== "outbound" && !m.first_reply_at;
  const channel = REAL_CHANNELS.find((c) => c.source === (m as { source?: string }).source);
  const avatar = avatarColors(avatarHue(m.sender_email ?? m.sender_name ?? "?"));

  /* One line describing what the message is about. Subject first because it is
     the writer's own summary; the preview continues it only if there is room.
     Deliberately NOT an AI-generated intent line: the reference design shows
     those, we do not store one, and inventing "Wants you to..." from a snippet
     would put words in a sender's mouth. When a real summary column exists this
     is the single place that changes. */
  const summary = [m.subject, m.preview].filter(Boolean).join(" — ");

  return (
    <button
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
        // The selected row lifts rather than just tinting, which is what makes
        // the reference layout readable without dividing lines everywhere.
        selected
          ? "bg-[var(--nav-active-bg)] ring-1 ring-inset ring-[var(--border-strong)]"
          : "hover:bg-[var(--chip-bg)]",
        breached && !selected && "bg-red-500/[0.045]",
      )}
    >
      {/* Stand-in for a profile photo: a stable colour per sender, so the same
          person is the same circle every time. */}
      <span
        aria-hidden="true"
        className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full text-[11px] font-semibold"
        style={{ background: avatar.bg, color: avatar.fg }}
      >
        {initials(m.sender_name)}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className={cn("min-w-0 truncate text-sm", unread ? "font-semibold text-text" : "text-muted")}>
            {m.sender_name}
          </span>
          <span
            className="shrink-0 text-xs tabular-nums text-faint"
            title={fullTime(m.received_at)}
          >
            {relativeTime(m.received_at, now)}
          </span>

          {breached && (
            <span
              className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-red-400"
              title={waitingLabel ? `Waiting ${waitingLabel}` : "Past the response target"}
            >
              <AlertTriangle size={11} />
              <span className="hidden xl:inline">{waitingLabel ?? "Late"}</span>
            </span>
          )}
          {(m as { has_attachment?: boolean }).has_attachment && (
            <Paperclip size={12} className="shrink-0 text-faint" />
          )}
        </span>

        <span className={cn("mt-0.5 block truncate text-[13px]", unread ? "text-muted" : "text-faint")}>
          {summary || "No subject"}
        </span>
      </span>

      {/* Where it came from. Only meaningful in a merged view, but keeping it in
          every view means the row does not change shape when you filter. */}
      {channel && (
        <span className="mt-1 shrink-0" title={channel.label} aria-label={`via ${channel.label}`}>
          <channel.icon size={16} />
        </span>
      )}
    </button>
  );
}
