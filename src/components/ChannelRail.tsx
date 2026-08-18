import { CHANNELS, STATUS_LABEL, isUsable, type Channel, type ChannelId } from "@/lib/channels";
import { cn } from "@/lib/utils";

/**
 * The channel switcher. Primary navigation for the Communication Center.
 *
 * Kept visually distinct from the view filters below it (§9 nav-hierarchy):
 * this picks WHERE the messages come from, the filters pick WHICH of them you
 * are looking at. Two different questions, so two different controls rather
 * than one long row of pills that mixes them.
 *
 * Channels that do not exist yet are shown, disabled, with the reason on hover
 * and in the panel. §9 empty-nav-state: explain, do not hide. Hiding WhatsApp
 * is why somebody asks every week whether WhatsApp is supported.
 */
export function ChannelRail({
  active, counts, onSelect,
}: {
  active: ChannelId;
  counts: Record<string, number>;
  onSelect: (id: ChannelId) => void;
}) {
  return (
    <nav aria-label="Message channels" className="flex flex-col gap-0.5">
      {CHANNELS.map((c) => {
        const usable = isUsable(c);
        const on = active === c.id;
        const n = counts[c.id] ?? 0;
        return (
          <button
            key={c.id}
            onClick={() => usable && onSelect(c.id)}
            disabled={!usable}
            aria-current={on ? "page" : undefined}
            // The reason travels with the control, so it is available before
            // you click rather than only after something fails.
            title={c.note ?? STATUS_LABEL[c.status]}
            className={cn(
              // 44px min target.
              "group flex min-h-[44px] w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm transition-colors",
              on ? "bg-[var(--nav-active-bg)] font-semibold text-[color:var(--nav-active-text)]"
                 : "text-muted hover:bg-[var(--chip-bg)] hover:text-text",
              !usable && "cursor-not-allowed opacity-45 hover:bg-transparent hover:text-muted",
            )}
          >
            <c.icon size={16} className="shrink-0" style={on ? undefined : { color: usable ? c.tint : undefined }} />
            <span className="min-w-0 flex-1 truncate">{c.label}</span>

            {/* Status as a word, never colour alone (§1 color-not-only). */}
            {c.status === "read_only" && (
              <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400">Read</span>
            )}
            {c.status === "planned" && (
              <span className="shrink-0 rounded bg-zinc-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-400">Soon</span>
            )}
            {n > 0 && isUsable(c) && (
              <span className={cn(
                "shrink-0 tabular-nums text-xs",
                on ? "text-[color:var(--nav-active-text)]" : "text-faint",
              )}>
                {n}
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
    channel.status === "connected"
      ? "border-border bg-surface-2/50 text-muted"
      : channel.status === "planned"
        ? "border-border bg-surface-2/50 text-muted"
        : "border-amber-500/40 bg-amber-500/5 text-amber-200";
  return (
    <p className={cn("rounded-lg border p-3 text-[12.5px] leading-relaxed", tone)}>
      <span className="font-semibold">{channel.label}: {STATUS_LABEL[channel.status]}.</span>{" "}
      {channel.note}
    </p>
  );
}
