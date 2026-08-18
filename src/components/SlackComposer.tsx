import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Send, RefreshCw, CheckCircle2, AlertTriangle, Info, Loader2 } from "lucide-react";
import { SlackMark } from "@/components/BrandIcons";
import {
  sendToSlack, syncSlack, listSlackChannels, SLACK_MESSAGE,
  type SlackSendResult, type SlackChannelInfo,
} from "@/lib/slack";

/**
 * Post to Slack, and pull Slack in.
 *
 * WHAT WAS WRONG BEFORE. The destination was a text input labelled "channel".
 * You had to already know the workspace's channel names, spell one correctly,
 * and guess whether it wanted a leading hash. Every one of those goes wrong
 * silently until after you press Send, which is the worst moment to learn that
 * a channel does not exist. Worse, leaving it blank posted to a server-side
 * default that the screen never named, so people were sending messages without
 * being told where they went.
 *
 * Now the destination is picked from the real workspace list and stated in
 * words above the box, because "where is this going" should be answerable
 * without pressing anything.
 *
 * THE ASYMMETRY THIS SURFACES. Slack lets a bot post to a public channel it has
 * never joined, but never lets it READ one. So a channel can be a perfectly
 * valid destination whose replies will never reach this inbox. That trips
 * people up badly and is invisible unless something says so, so the picker says
 * so at the moment of choosing rather than in a help page nobody opens.
 */
export function SlackComposer({ onSent }: { onSent?: () => void }) {
  const [text, setText] = useState("");
  const [channelId, setChannelId] = useState("");
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<SlackSendResult | null>(null);
  const [syncNote, setSyncNote] = useState<string | null>(null);

  const { data: dir, isLoading, refetch: refetchDir } = useQuery({
    queryKey: ["slack-channels"],
    queryFn: listSlackChannels,
    staleTime: 60_000,
  });

  const channels = useMemo(() => dir?.channels ?? [], [dir]);
  const selected: SlackChannelInfo | undefined =
    channels.find((c) => c.id === channelId) ?? channels.find((c) => c.can_post);

  /* Default to somewhere real as soon as the list arrives, rather than leaving
     the picker blank and posting to an unnamed server-side default. */
  useEffect(() => {
    if (!channelId && selected) setChannelId(selected.id);
  }, [channelId, selected]);

  const joined = channels.filter((c) => c.can_read);
  const postOnly = channels.filter((c) => c.can_post && !c.can_read);

  async function send() {
    if (!text.trim() || !selected) return;
    setBusy(true);
    setResult(null);
    try {
      // Sends the NAME: it is what the server and Slack both accept, and what
      // the success line echoes back.
      const r = await sendToSlack(text.trim(), selected.name);
      setResult(r);
      if (r.ok) { setText(""); onSent?.(); }
    } finally {
      setBusy(false);
    }
  }

  async function pull() {
    setSyncing(true);
    setSyncNote(null);
    try {
      const r = await syncSlack();
      setSyncNote(
        r.ok
          ? r.channels === 0
            ? "No channels to read. The bot has not been invited to any, so there is nothing to pull."
            : `Pulled ${r.synced} new message${r.synced === 1 ? "" : "s"} from ${r.channels} channel${r.channels === 1 ? "" : "s"}.`
          : `Could not read Slack. ${r.detail ?? ""}`,
      );
      if (r.ok && r.synced) onSent?.();
      void refetchDir();
    } finally {
      setSyncing(false);
    }
  }

  return (
    <section className="card mb-3 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SlackMark size={16} />
        <span className="text-sm font-semibold">Slack</span>
        {dir?.ok && (
          <span className="text-xs text-faint">
            {channels.length} channel{channels.length === 1 ? "" : "s"} · {joined.length} readable
          </span>
        )}
        <button
          onClick={() => void pull()}
          disabled={syncing}
          className="btn-ghost ml-auto border border-border px-2.5 py-1 text-xs"
        >
          <RefreshCw size={12} className={syncing ? "animate-spin" : ""} />
          {syncing ? "Reading…" : "Pull messages"}
        </button>
      </div>

      {isLoading ? (
        <p className="flex items-center gap-2 text-[12.5px] text-faint">
          <Loader2 size={13} className="animate-spin" /> Loading channels…
        </p>
      ) : !dir?.ok ? (
        <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-2.5 text-[12.5px] text-amber-200">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>{SLACK_MESSAGE[dir?.failure ?? "unknown"]}</span>
        </p>
      ) : channels.length === 0 ? (
        <p className="text-[12.5px] text-muted">No channels found in this workspace.</p>
      ) : (
        <>
          {/* Destination first and labelled, not an afterthought beside the
              message box. A visible label, not a placeholder. */}
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="slack-dest" className="text-xs font-medium text-muted">
              Post to
            </label>
            <select
              id="slack-dest"
              className="input min-h-[38px] w-auto min-w-[180px] py-1.5"
              value={selected?.id ?? ""}
              onChange={(e) => { setChannelId(e.target.value); setResult(null); }}
            >
              {joined.length > 0 && (
                <optgroup label="Bot is in these (reads and posts)">
                  {joined.map((c) => (
                    <option key={c.id} value={c.id}>#{c.name}</option>
                  ))}
                </optgroup>
              )}
              {postOnly.length > 0 && (
                <optgroup label="Not joined (posts only, cannot read replies)">
                  {postOnly.map((c) => (
                    <option key={c.id} value={c.id}>#{c.name}</option>
                  ))}
                </optgroup>
              )}
            </select>
            {selected && (
              <span className="text-xs text-faint">
                {selected.is_private ? "Private" : "Public"}
                {selected.members !== null && ` · ${selected.members} member${selected.members === 1 ? "" : "s"}`}
              </span>
            )}
          </div>

          {/* The trap, named at the moment it matters. */}
          {selected && !selected.can_read && (
            <p className="mt-2 flex items-start gap-2 rounded-lg border border-border bg-surface-2/50 p-2.5 text-[12.5px] leading-relaxed text-muted">
              <Info size={14} className="mt-0.5 shrink-0" />
              <span>
                This posts fine, but the bot is not in <span className="font-medium">#{selected.name}</span>,
                so anything anyone replies there will not appear in this inbox. Run{" "}
                <span className="mono text-text">/invite @MadeEA OS</span> in the channel to read it too.
              </span>
            </p>
          )}

          <div className="mt-2 flex flex-wrap gap-2">
            <label htmlFor="slack-text" className="sr-only">Message</label>
            <input
              id="slack-text"
              className="input min-w-0 flex-1"
              // Names the destination again, right where you are typing.
              placeholder={selected ? `Message #${selected.name}…` : "Message…"}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && text.trim()) void send(); }}
            />
            <button
              className="btn-primary shrink-0"
              onClick={() => void send()}
              disabled={busy || !text.trim() || !selected}
            >
              <Send size={14} />
              {busy ? "Sending…" : selected ? `Send to #${selected.name}` : "Send"}
            </button>
          </div>
        </>
      )}

      {syncNote && <p className="mt-2 text-[12.5px] text-muted">{syncNote}</p>}

      {result?.ok && (
        <p className="mt-2 flex items-start gap-2 text-[12.5px] text-emerald-300">
          <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
          <span>
            {/* Slack's own timestamp is the message's identity in Slack, so it
                is the thing to check when somebody asks whether it really sent. */}
            Posted to #{result.channel}. Slack message id <span className="mono text-emerald-200">{result.ts}</span>
            {result.recorded === false && " (sent, but not recorded here)"}
          </span>
        </p>
      )}

      {result && !result.ok && (
        <p className="mt-2 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-2.5 text-[12.5px] text-amber-200">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            {SLACK_MESSAGE[result.failure ?? "unknown"]}
            {result.detail && <span className="mt-0.5 block text-[11px] text-amber-300/70">{result.detail.slice(0, 160)}</span>}
          </span>
        </p>
      )}
    </section>
  );
}
