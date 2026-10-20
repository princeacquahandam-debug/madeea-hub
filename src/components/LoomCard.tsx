import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Link2, Loader2, Video } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { LOOM_APP_ID as APP_ID, useLoomRecorder } from "@/lib/loom";

/**
 * Loom, on the Integrations page beside the message channels (19 Oct 2026,
 * client request; the 13 Oct call settled on Loom's free recording kit rather
 * than building screen recording ourselves).
 *
 * Record your screen and camera from inside the Hub, for SOPs, how-tos and
 * instructions to an EA, then paste the link wherever it's needed. Loom's free
 * plan covers 25 videos of up to 5 minutes each.
 *
 * It needs a Loom developer app: its Public App ID goes in VITE_LOOM_APP_ID.
 * Until that's set, the card says exactly how to get one. The recording kit
 * (@loomhq/record-sdk, pinned) is only downloaded when someone records, so it
 * costs the rest of the Hub nothing.
 */
const MAX_KEPT = 5;

interface Recording { title: string; url: string; at: string }

export function LoomMark({ size = 16, className }: { size?: string | number; className?: string }) {
  // Loom's burst, in its brand purple.
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-hidden="true" focusable="false">
      <g fill="#625DF5">
        {Array.from({ length: 8 }, (_, i) => (
          <rect key={i} x="14" y="2" width="4" height="12" rx="2" transform={`rotate(${i * 45} 16 16)`} />
        ))}
        <circle cx="16" cy="16" r="5" />
      </g>
      <circle cx="16" cy="16" r="2.6" fill="#fff" />
    </svg>
  );
}

export function LoomCard() {
  const { user } = useAuth();
  const key = `madeea-loom-recordings-${user?.id ?? "anon"}`;
  const [recent, setRecent] = useState<Recording[]>(() => {
    try { return JSON.parse(localStorage.getItem(key) ?? "[]") as Recording[]; } catch { return []; }
  });
  const [setup, setSetup] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  // The recorder lives in lib/loom, shared with Learn (Training Center, SOPs).
  const rec = useLoomRecorder((v) => setRecent((r) => [{ title: v.title, url: v.url, at: new Date().toISOString() }, ...r.filter((x) => x.url !== v.url)].slice(0, MAX_KEPT)));
  const { buttonRef: recordRef, state, error, prepare } = rec;

  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(recent.slice(0, MAX_KEPT))); } catch { /* storage blocked */ }
  }, [recent, key]);

  async function copy(url: string) {
    try { await navigator.clipboard?.writeText(url); setCopied(url); window.setTimeout(() => setCopied(null), 1500); } catch { /* clipboard blocked */ }
  }

  return (
    <div className="card relative flex flex-col p-4" data-channel="loom">
      <div className="flex items-start gap-2.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-2">
          <LoomMark size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold">Loom</h3>
          <p className="truncate text-[11px] text-faint">{APP_ID ? "Ready to record" : "Not set up yet"}</p>
        </div>
      </div>

      <p className="mt-2.5 flex-1 text-[12.5px] leading-relaxed text-muted">
        Record your screen and camera without leaving MadeEA, for SOPs, how-tos and instructions to your EA. Paste the link into a task, note or message. Free plan: 25 videos, up to 5 minutes each.
      </p>

      {APP_ID ? (
        <button
          ref={recordRef}
          onClick={() => { if (state !== "ready") void prepare(); }}
          disabled={state === "loading"}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-accent/50 py-2 text-[12.5px] font-medium text-accent-soft transition-colors hover:bg-accent/10"
        >
          {state === "loading" ? <><Loader2 size={14} className="animate-spin" /> Starting Loom…</> : <><Video size={14} /> Record a Loom</>}
        </button>
      ) : (
        <button
          onClick={() => setSetup((v) => !v)}
          aria-expanded={setup}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-accent/50 py-2 text-[12.5px] font-medium text-accent-soft transition-colors hover:bg-accent/10"
        >
          <Link2 size={14} /> Connect
        </button>
      )}

      {error && <p className="mt-2 text-[11.5px] leading-relaxed text-red-500">{error}</p>}

      {!APP_ID && setup && (
        <ol className="mt-3 list-decimal space-y-1.5 pl-4 text-[12px] leading-relaxed text-muted">
          <li>Create a free developer app at <a href="https://dev.loom.com" target="_blank" rel="noreferrer" className="text-accent-soft underline">dev.loom.com</a> with MadeEA's Loom account.</li>
          <li>Add the Hub's web address to the app's allowed domains.</li>
          <li>Copy its <b>Public App ID</b> into the Hub's settings on Vercel as <code className="rounded bg-surface-2 px-1">VITE_LOOM_APP_ID</code>, then redeploy. This card then shows Record a Loom.</li>
        </ol>
      )}

      {recent.length > 0 && (
        <div className="mt-3 border-t border-border pt-2.5">
          <p className="mb-1 text-[11px] font-semibold text-faint">Your recent recordings</p>
          <ul className="space-y-1">
            {recent.map((r) => (
              <li key={r.url} className="flex items-center gap-1.5 text-[12px]">
                <span className="min-w-0 flex-1 truncate" title={r.title}>{r.title}</span>
                <button onClick={() => void copy(r.url)} className="icon-btn text-faint hover:text-text" aria-label={`Copy the link to ${r.title}`} title="Copy link">
                  {copied === r.url ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
                </button>
                <a href={r.url} target="_blank" rel="noreferrer" className="icon-btn text-faint hover:text-text" aria-label={`Open ${r.title}`} title="Open"><ExternalLink size={13} /></a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
