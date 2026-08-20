import { CHANNELS, STATUS_LABEL, isUsable, type Channel, type ChannelId } from "@/lib/channels";
import { cn } from "@/lib/utils";

/**
 * The channel switcher: a vertical strip of brand marks down the left edge.
 *
 * WHY ICON-ONLY HERE, WHEN ICON-ONLY NAV IS NORMALLY A MISTAKE.
 * §9 nav-label-icon is right that stripping labels usually hurts discovery,
 * because a glyph has to be learned. Brand marks are the exception: nobody has
 * to learn what the Gmail envelope or the Slack hash means, and the marks are
 * more recognisable than the words next to them would be. That is the whole
 * argument for this layout, and it stops being true the moment a channel has no
 * well-known logo.
 *
 * So the label is removed from the screen, not from the interface. Every button
 * keeps an aria-label and a title, the count is announced rather than implied,
 * and the active channel is marked by a filled tile plus aria-current, not by
 * colour alone (§1 color-not-only, §9 nav-state-active).
 *
 * Channels that do not exist yet stay visible, dimmed, with the reason on hover
 * (§9 empty-nav-state). Hiding WhatsApp is why somebody asks every week whether
 * we support WhatsApp.
 */
export function ChannelRail({
  active, counts, onSelect,
}: {
  active: ChannelId;
  counts: Record<string, number>;
  onSelect: (id: ChannelId) => void;
}) {
  return (
    /* A column beside the list on desktop, a strip above it on mobile. Left as
       a column at every width, five tiles ate 300px of a phone screen before
       the first message. */
    <nav
      aria-label="Message channels"
      className="flex flex-row flex-wrap items-center justify-center gap-1.5 lg:flex-col"
    >
      {CHANNELS.map((c) => {
        const usable = isUsable(c);
        const on = active === c.id;
        const n = counts[c.id] ?? 0;
        const label = usable
          ? `${c.label}${n > 0 ? `, ${n} message${n === 1 ? "" : "s"}` : ""}`
          : `${c.label}, ${STATUS_LABEL[c.status]}. ${c.note ?? ""}`;

        return (
          <button
            key={c.id}
            onClick={() => usable && onSelect(c.id)}
            disabled={!usable}
            aria-current={on ? "page" : undefined}
            aria-label={label}
            title={c.note ?? c.label}
            className={cn(
              /* 44px target (§2 touch-target-size). Everything lives INSIDE
                 these bounds: badges hung off the corners overlapped the
                 neighbouring tiles and clipped against the rail's edge. */
              "relative grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-xl transition-colors",
              on
                ? "bg-[var(--nav-active-bg)] ring-1 ring-inset ring-[var(--border-strong)]"
                : "hover:bg-[var(--chip-bg)]",
              !usable && "cursor-not-allowed opacity-45 hover:bg-transparent",
            )}
          >
            {/* Nudged up when something sits beneath it, so the icon stays
                optically centred in the tile rather than crowding the label. */}
            <c.icon size={20} className={cn((n > 0 && usable) || !usable ? "-mt-1" : "")} />

            {/* Count and status occupy the same strip at the bottom of the
                tile: a channel is either countable or not-yet, never both, so
                they can never collide. The aria-label already says either in
                words, which is why these are hidden from the reader. */}
            {n > 0 && usable && (
              <span
                aria-hidden="true"
                className={cn(
                  "absolute inset-x-0 bottom-0.5 text-center text-[9px] font-bold leading-none tabular-nums",
                  on ? "text-[color:var(--nav-active-text)]" : "text-faint",
                )}
              >
                {n > 999 ? "999+" : n}
              </span>
            )}

            {/* A "not yet" channel is dimmed AND labelled: dimming alone is a
                colour signal and reads as merely inactive (§1 color-not-only). */}
            {!usable && (
              <span aria-hidden="true" className="absolute inset-x-0 bottom-0.5 text-center text-[9px] font-bold leading-none text-faint">
                soon
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}

/** The note for a channel that cannot do what you just asked of it. */
export function ChannelNotice({ channel }: { channel: Channel }) {
  if (!channel.note) return null;
  /* A note is not automatically a warning. A connected channel can still carry
     an operating detail (Slack needs the bot invited per channel), and painting
     that amber would report a healthy integration as a problem. Amber is for
     the states where something is actually unavailable. */
  const tone =
    channel.status === "connected" || channel.status === "planned"
      ? "border-border bg-surface-2/50 text-muted"
      : "border-amber-500/40 bg-amber-500/5 text-amber-200";
  return (
    <p className={cn("rounded-lg border p-3 text-[12.5px] leading-relaxed", tone)}>
      <span className="font-semibold">{channel.label}: {STATUS_LABEL[channel.status]}.</span>{" "}
      {channel.note}
    </p>
  );
}
