import { useState } from "react";
import { Hash, Send, RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react";
import { sendToSlack, syncSlack, SLACK_MESSAGE, type SlackSendResult } from "@/lib/slack";

/**
 * Post to Slack from the Communication Center, and pull the channel in.
 *
 * The success state deliberately shows Slack's own message timestamp. It is the
 * message's identity in Slack, so it is the thing to check when somebody asks
 * whether it really sent, rather than trusting a green tick.
 *
 * Failures name the fix rather than saying "something went wrong". The one that
 * matters most here is missing_scope: the app can read this workspace but not
 * post to it, which is a box a Slack admin ticks, not an outage.
 */
export function SlackComposer({ onSent }: { onSent?: () => void }) {
  const [text, setText] = useState("");
  const [channel, setChannel] = useState("");
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<SlackSendResult | null>(null);
  const [syncNote, setSyncNote] = useState<string | null>(null);

  async function send() {
    if (!text.trim()) return;
    setBusy(true);
    setResult(null);
    try {
      const r = await sendToSlack(text.trim(), channel.trim() || undefined);
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
          ? `Pulled ${r.synced} new message${r.synced === 1 ? "" : "s"} from ${r.channels} channel${r.channels === 1 ? "" : "s"}.`
          : `Could not read Slack. ${r.detail ?? ""}`,
      );
      if (r.ok && r.synced) onSent?.();
    } finally {
      setSyncing(false);
    }
  }

  return (
    <section className="card mb-4 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Hash size={15} className="text-accent" />
        <span className="text-sm font-semibold">Slack</span>
        <button
          onClick={() => void pull()}
          disabled={syncing}
          className="btn-ghost ml-auto border border-border px-2.5 py-1 text-xs"
        >
          <RefreshCw size={12} className={syncing ? "animate-spin" : ""} /> {syncing ? "Reading…" : "Pull channel"}
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          className="input w-36 shrink-0"
          placeholder="channel"
          aria-label="Slack channel, leave blank for the default"
          value={channel}
          onChange={(e) => setChannel(e.target.value)}
        />
        <input
          className="input min-w-0 flex-1"
          placeholder="Message the channel…"
          aria-label="Message to post to Slack"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && text.trim()) void send(); }}
        />
        <button className="btn-primary shrink-0" onClick={() => void send()} disabled={busy || !text.trim()}>
          <Send size={14} /> {busy ? "Sending…" : "Send"}
        </button>
      </div>

      {syncNote && <p className="mt-2 text-[12.5px] text-muted">{syncNote}</p>}

      {result?.ok && (
        <p className="mt-2 flex items-start gap-2 text-[12.5px] text-emerald-300">
          <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
          <span>
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
