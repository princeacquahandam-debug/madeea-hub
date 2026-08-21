import { useQuery } from "@tanstack/react-query";
import { Check, Loader2, Hash, Lock } from "lucide-react";
import { REAL_CHANNELS, STATUS_LABEL, type Channel } from "@/lib/channels";
import { listSlackChannels } from "@/lib/slack";
import { cn } from "@/lib/utils";

/**
 * Every message channel and its real state, in one place.
 *
 * WHY THIS EXISTS. "Which channels are connected" was answerable only by
 * opening the Inbox, choosing each channel, and reading a note beside it. That is three steps to learn something that should be a
 * glance, and it is the first question anyone asks when a client says they
 * messaged us somewhere.
 *
 * WHY IT DOES NOT OFFER A CONNECT BUTTON FOR EVERYTHING. The honest answer per
 * channel is wildly different. Gmail is an OAuth click. Slack was a scope and a
 * reinstall. Discord is a bot token. WhatsApp is a Meta Business review that
 * takes days and needs a phone number that has never been on WhatsApp. Giving
 * all four an identical "Connect" button would say those are the same job, and
 * whoever pressed the WhatsApp one would rightly feel lied to. So each states
 * what it actually needs, and only the ones that can be actioned here get a
 * control.
 */

function StatusPill({ channel }: { channel: Channel }) {
  // Status carries a word as well as a colour, so it survives being printed,
  // screenshotted, or read by someone who does not distinguish red from green.
  const tone: Record<Channel["status"], string> = {
    connected: "bg-emerald-500/15 text-emerald-400",
    read_only: "bg-amber-500/15 text-amber-400",
    not_connected: "bg-zinc-500/15 text-faint",
    planned: "bg-zinc-500/15 text-faint",
  };
  return <span className={cn("pill", tone[channel.status])}>{STATUS_LABEL[channel.status]}</span>;
}

/** The live channel list, shown only for Slack because only Slack has one. */
function SlackChannelList() {
  const { data, isLoading } = useQuery({
    queryKey: ["slack-channels"],
    queryFn: listSlackChannels,
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <p className="mt-3 flex items-center gap-2 text-xs text-faint">
        <Loader2 size={12} className="animate-spin" /> Loading channels…
      </p>
    );
  }
  if (!data?.ok || data.channels.length === 0) return null;

  return (
    <div className="mt-3 border-t border-border pt-3">
      <p className="field-label">Channels in this workspace</p>
      <ul className="mt-1.5 space-y-1">
        {data.channels.map((c) => (
          /* Name on its own line, capabilities beneath it. Side by side these
             competed for about 200px in a four-across card and the channel
             name lost, which is the one part you cannot guess: "all-ma…" and
             "new-c…" are not names anyone can act on. */
          <li key={c.id} className="text-[12.5px]">
            <div className="flex items-center gap-1.5">
              {c.is_private ? (
                <Lock size={11} className="shrink-0 text-faint" />
              ) : (
                <Hash size={11} className="shrink-0 text-faint" />
              )}
              <span className="min-w-0 truncate font-medium">{c.name}</span>
            </div>
            {/* Read and post stated separately, because they genuinely differ:
                a public channel is postable without an invite and never
                readable without one. One combined badge would be wrong for
                every channel the bot has not joined. */}
            <div className="ml-[18px] flex flex-wrap gap-x-2 text-[11px]">
              <span className={c.can_post ? "text-emerald-400" : "text-faint"}>
                {c.can_post ? "can post" : "cannot post"}
              </span>
              <span className={c.can_read ? "text-emerald-400" : "text-amber-400"}>
                {c.can_read ? "can read" : "not joined, cannot read"}
              </span>
            </div>
          </li>
        ))}
      </ul>
      {data.joined === 0 && (
        <p className="mt-2 text-[12px] leading-relaxed text-muted">
          The bot has joined nothing yet, so nothing can be pulled in. Run{" "}
          <span className="mono text-text">/invite @MadeEA OS</span> in each channel you want to read.
        </p>
      )}
    </div>
  );
}

export function ChannelConnections() {
  return (
    <section className="mb-5">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">Message channels</h2>
        <p className="text-xs text-faint">Where clients can reach you</p>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {REAL_CHANNELS.map((c) => (
          <div
            key={c.id}
            className={cn(
              "card flex flex-col p-4",
              // Unavailable channels are dimmed but never hidden. Hiding
              // WhatsApp is why somebody asks every week whether we support it.
              c.status === "planned" && "opacity-70",
            )}
          >
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-2">
                <c.icon size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-sm font-semibold">{c.label}</h3>
              </div>
            </div>

            <div className="mt-2">
              <StatusPill channel={c} />
            </div>

            {c.note && <p className="mt-2.5 text-[12.5px] leading-relaxed text-muted">{c.note}</p>}

            {c.requires && c.requires.length > 0 && (
              <div className="mt-3">
                <p className="field-label">
                  {c.status === "connected" ? "Ongoing" : "What this needs"}
                </p>
                <ul className="mt-1 space-y-1">
                  {c.requires.map((r) => (
                    <li key={r} className="flex items-start gap-1.5 text-[12px] leading-relaxed text-muted">
                      <Check size={11} className="mt-1 shrink-0 text-faint" />
                      <span className="min-w-0 break-words">{r}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {c.id === "slack" && <SlackChannelList />}
          </div>
        ))}
      </div>
    </section>
  );
}
