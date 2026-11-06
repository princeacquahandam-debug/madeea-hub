import { useMemo, useState } from "react";
import { Check, Copy, Download, Loader2, Send, Sparkles } from "lucide-react";
import { AiPanel } from "@/components/ai/AiResult";
import { useSendEmail, textToHtml } from "@/hooks/useSendEmail";
import { isSupabaseConfigured } from "@/lib/supabase";
import {
  clientWeekFacts, runClientWeekly, short, weeklyText, WEEKLY_EMPTY, WEEKLY_SECTIONS,
  type ClientWeekFacts, type ClientWeekly,
} from "@/lib/eodAi";
import type { Client, EodReport, Task } from "@/types/db";

/**
 * "Client weekly report" (Abder's "AI quick actions and cost" deck, 6 Nov
 * 2026): a ready-to-send weekly update per client, in a side panel. One
 * client at a time and only on request, to keep the cost down: pick the
 * client, then "Write update". Copy, Send (with a confirm step) or Download
 * PDF; nothing is sent without that last click.
 */
export function ClientWeeklyPanel({
  clients, tasks, reports, lo, hi, assigneeId, scopeLabel, sender, onClose,
}: {
  clients: Client[];
  tasks: Task[];
  /** Reports in scope (EA filter applied). */
  reports: EodReport[];
  lo: string;
  hi: string;
  assigneeId?: string;
  scopeLabel: string;
  sender?: string;
  onClose: () => void;
}) {
  const facts = useMemo(
    () => clients.map((client) => clientWeekFacts({ client, tasks, reports, lo, hi, assigneeId })).sort((a, b) => b.count - a.count),
    [clients, tasks, reports, lo, hi, assigneeId],
  );
  const [pick, setPick] = useState(() => facts[0]?.client.id ?? "");
  const f = facts.find((x) => x.client.id === pick);
  const [at] = useState(() => new Date());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, ClientWeekly>>({});
  const w = f ? done[f.client.id] : undefined;

  async function write() {
    if (!f) return;
    setBusy(true);
    setError(null);
    try {
      const r = await runClientWeekly(f);
      setDone((d) => ({ ...d, [f.client.id]: r.data }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Madeline couldn't be reached. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const active = facts.filter((x) => x.count > 0).length;
  return (
    <AiPanel
      title="Client weekly report"
      source={`the EOD reports and tasks for ${short(lo)} to ${short(hi)}, ${scopeLabel}`}
      at={at}
      summary={`${active} of ${clients.length} ${clients.length === 1 ? "client has" : "clients have"} activity this week. Pick one to write their update.`}
      onClose={onClose}
      chat={f && w ? `Help me improve this weekly update for ${f.client.name}:\n\n${weeklyText(f, w, sender)}` : undefined}
      footer={f && w ? <Actions f={f} w={w} sender={sender} /> : <p className="text-xs text-faint">Each update is written only when you ask for it.</p>}
    >
      <div className="mb-3 flex gap-2">
        <select className="input min-w-0 flex-1" value={pick} onChange={(e) => { setPick(e.target.value); setError(null); }} aria-label="Client">
          {facts.map((x) => (
            <option key={x.client.id} value={x.client.id}>{x.client.name}{x.count ? ` (${x.count} ${x.count === 1 ? "item" : "items"})` : " (no activity)"}</option>
          ))}
        </select>
        <button className="btn-primary shrink-0" onClick={() => void write()} disabled={!f || !f.count || busy}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} {w ? "Rewrite" : "Write update"}
        </button>
      </div>
      {!f || !f.count ? (
        <p className="text-sm text-muted">{WEEKLY_EMPTY}</p>
      ) : error ? (
        <p className="text-sm text-red-500">{error}</p>
      ) : busy ? (
        <p className="flex items-center gap-2 text-sm text-muted"><Loader2 size={14} className="animate-spin" /> Madeline is writing…</p>
      ) : w ? (
        <div className="space-y-3 text-sm" data-testid="weekly-body">
          <p className="text-muted">Hi {f.client.name.split(" ")[0]}, here is your update for the week of {short(f.lo)} to {short(f.hi)}.</p>
          {WEEKLY_SECTIONS.filter(([k]) => w[k].length).map(([k, label]) => (
            <div key={k}>
              <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-faint">{label}</p>
              <ul className="list-disc space-y-0.5 pl-5">{w[k].map((x, i) => <li key={i}>{x}</li>)}</ul>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted">
          {f.completed.length} completed, {f.inProgress.length} in progress, {f.needs.length} waiting on the client, {f.nextWeek.length} due next week
          {f.eodLines.length ? `, ${f.eodLines.length} mentions in EOD reports` : ""}.
        </p>
      )}
    </AiPanel>
  );
}

function Actions({ f, w, sender }: { f: ClientWeekFacts; w: ClientWeekly; sender?: string }) {
  const text = weeklyText(f, w, sender);
  const subject = `Weekly update: ${short(f.lo)} to ${short(f.hi)}`;
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const { state, send } = useSendEmail();
  const to = f.client.email?.trim() ?? "";
  /* Send uses the app's own mail path (gmail-send / outlook-send) and asks
     first. Without a mailbox (demo mode) or an address, it says why. */
  const why = !isSupabaseConfigured ? "Sending needs a connected mailbox, which demo mode doesn't have." : !to ? "No email address is saved for this client." : "";

  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopied(true); } catch { setCopied(false); }
  }

  /* A print-friendly page in a hidden frame; the browser's print dialog offers "Save as PDF". */
  function pdf() {
    const frame = document.createElement("iframe");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
    document.body.appendChild(frame);
    const doc = frame.contentDocument;
    if (!doc) return;
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
    doc.open();
    doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(f.client.name)}: ${esc(subject)}</title>
<style>body{font:14px/1.5 system-ui,sans-serif;color:#111;max-width:640px;margin:32px auto}h1{font-size:18px}h2{font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:#555;margin:18px 0 4px}</style></head>
<body><h1>${esc(f.client.name)} · ${esc(subject)}</h1>${WEEKLY_SECTIONS.filter(([k]) => w[k].length).map(([k, label]) => `<h2>${label}</h2><ul>${w[k].map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`).join("")}</body></html>`);
    doc.close();
    window.setTimeout(() => { frame.contentWindow?.focus(); frame.contentWindow?.print(); window.setTimeout(() => frame.remove(), 1000); }, 50);
  }

  return (
    <div className="space-y-2">
      {confirm ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-xs">
          <span className="min-w-0 flex-1">Send this update to <b>{to}</b>?</span>
          <button
            className="btn-primary px-2.5 py-1 text-xs"
            disabled={state.kind === "sending"}
            onClick={async () => { if (await send({ to, subject, text, html: textToHtml(text), aiDrafted: true })) setConfirm(false); }}
          >
            {state.kind === "sending" ? "Sending…" : "Send now"}
          </button>
          <button className="btn-ghost border border-border px-2.5 py-1 text-xs" onClick={() => setConfirm(false)}>Cancel</button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost border border-border" onClick={() => void copy()}>{copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy"}</button>
          {/* Wrapped so the reason shows on hover even though the button is disabled. */}
          <span title={why || `Send to ${to}`}>
            <button className="btn-ghost border border-border" disabled={!!why} onClick={() => setConfirm(true)}><Send size={14} /> Send</button>
          </span>
          <button className="btn-ghost border border-border" onClick={pdf}><Download size={14} /> Download PDF</button>
        </div>
      )}
      {state.kind === "sent" && <p className="text-xs text-emerald-600">Sent to {to}.</p>}
      {state.kind === "error" && <p className="text-xs text-red-500">{state.detail}</p>}
      {(state.kind === "not_connected" || state.kind === "needs_scope") && <p className="text-xs text-red-500">Connect your mailbox in Settings to send from here.</p>}
    </div>
  );
}
