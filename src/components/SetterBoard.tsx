import { useMemo, useState, type ReactNode } from "react";
import { Copy, Check, MessageSquare, CalendarCheck, UserX, Loader2, AlertTriangle } from "lucide-react";
import { useAdsSetterMutations } from "@/data/hooks";
import { nextReply } from "@/lib/adsSetter";
import type { AdCampaign, AdLead, AdOffer, AdStage, ThreadMsg } from "@/types/db";

/**
 * The half of a setter that is identical inbound or outbound: the pipeline list
 * and the conversation. Ads Setter and DM Setter differ only in how the first
 * message comes to exist — everything after it is score, thread, book or release.
 *
 * Extracted rather than copied so the two can't drift: a fix to the "keep what the
 * lead actually said when the model fails" path has to apply to both, and two
 * copies is how one of them silently stops doing it.
 */

const STAGE_LABEL: Record<AdStage, string> = {
  new: "New", qualifying: "In conversation", booked: "Booked", disqualified: "Not a fit",
};
const STAGE_TONE: Record<AdStage, string> = {
  new: "bg-zinc-500/15 text-faint",
  qualifying: "bg-amber-500/15 text-amber-400",
  booked: "bg-emerald-500/15 text-emerald-400",
  disqualified: "bg-red-500/15 text-red-400",
};

const scoreColor = (s: number | null) =>
  s == null ? "text-faint" : s >= 70 ? "text-emerald-400" : s >= 45 ? "text-amber-400" : "text-red-400";

export const EMPTY_OFFER: AdOffer = {
  name: "", audience: "", problem: "", outcome: "", price: "",
  geo: "", platform: "meta", tone: "direct, confident, no hype", notes: "",
};

export { STAGE_LABEL, STAGE_TONE, scoreColor };

export function SetterBoard({ leads, campaignFor, intake, actions, emptyHint, subtitleFor }: {
  leads: AdLead[];
  campaignFor: (l: AdLead) => AdCampaign | null;
  /** Page-specific panel for bringing people in. */
  intake: ReactNode;
  /** Page-specific action strip (e.g. "Qualify new leads"). */
  actions: ReactNode;
  emptyHint: string;
  /** Second line under the name in the conversation header. */
  subtitleFor: (l: AdLead) => string;
}) {
  const { updateLead } = useAdsSetterMutations();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [theirReply, setTheirReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hint, setHint] = useState("");
  const [copied, setCopied] = useState("");

  const selected = useMemo(() => leads.find((l) => l.id === selectedId) ?? null, [leads, selectedId]);

  function copy(text: string, key: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? "" : c)), 1400);
    }).catch(() => {});
  }

  async function draftReply() {
    if (!selected || !theirReply.trim()) return;
    setBusy(true); setError(""); setHint("");
    const c = campaignFor(selected);
    const withTheirs: ThreadMsg[] = [...selected.thread, { role: "lead", text: theirReply.trim(), ts: Date.now() }];
    try {
      const r = await nextReply(c?.offer ?? EMPTY_OFFER, selected.thread, theirReply, c?.qualifying_questions ?? []);
      await updateLead.mutateAsync({
        id: selected.id,
        patch: {
          thread: [...withTheirs, { role: "setter", text: r.reply ?? "", ts: Date.now() }],
          stage: r.shouldDisqualify ? "disqualified" : "qualifying",
          disqualified_reason: r.shouldDisqualify ? (r.reasoning ?? "").slice(0, 200) : null,
        },
      });
      setTheirReply("");
      setHint(r.shouldDisqualify ? `Suggests releasing this one — ${r.reasoning}`
        : r.readyToBook ? `Ready to book — ${r.reasoning}` : r.reasoning);
    } catch (e) {
      // Persist what they actually said even when the draft fails, so a human
      // takes over a real conversation rather than a truncated one.
      try { await updateLead.mutateAsync({ id: selected.id, patch: { thread: withTheirs } }); } catch { /* keep the original error */ }
      setError(e instanceof Error ? e.message : "Couldn't draft a reply.");
      setTheirReply("");
    } finally { setBusy(false); }
  }

  async function close(action: "book" | "disqualify") {
    if (!selected) return;
    let when = "";
    if (action === "book") {
      const answer = prompt("When is the call? (free text)");
      if (answer === null) return;   // cancelled — not a booking
      when = answer;
    }
    setError("");
    try {
      await updateLead.mutateAsync({
        id: selected.id,
        patch: action === "book"
          ? {
              stage: "booked",
              booked_at: new Date().toISOString(),
              thread: [...selected.thread, { role: "setter", text: `Booked${when ? ` — ${when}` : ""}.`, ts: Date.now() }],
            }
          : { stage: "disqualified", disqualified_reason: "Released by the setter" },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't update.");
    }
  }

  return (
    <>
      {error && (
        <div className="card mb-4 flex items-start gap-2 p-3 text-sm text-red-400">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {error}
        </div>
      )}
      {hint && !error && <div className="card mb-4 p-3 text-sm text-muted">{hint}</div>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <div className="space-y-4">
          {intake}
          {actions}
          <div className="card p-3">
            <div className="max-h-[520px] space-y-1 overflow-y-auto">
              {leads.length === 0 && <p className="py-8 text-center text-sm text-faint">{emptyHint}</p>}
              {leads.map((l) => (
                <button
                  key={l.id}
                  onClick={() => { setSelectedId(l.id); setHint(""); setError(""); }}
                  className={`w-full rounded-lg p-3 text-left transition-colors ${selectedId === l.id ? "bg-surface-2" : "hover:bg-surface-2"}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{l.name}</span>
                    {l.score != null && <span className={`text-xs font-semibold ${scoreColor(l.score)}`}>{l.score}</span>}
                  </div>
                  <div className="mt-1 flex items-center gap-1.5">
                    <span className={`pill ${STAGE_TONE[l.stage]}`}>{STAGE_LABEL[l.stage]}</span>
                    {l.thread.length > 0 && (
                      <span className="pill bg-surface-2 text-faint"><MessageSquare size={10} /> {l.thread.length}</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div>
          {!selected ? (
            <div className="card p-10 text-center text-sm text-faint">Pick someone to see the conversation.</div>
          ) : (
            <div className="card p-5">
              <div className="flex items-start justify-between gap-3 border-b border-border pb-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{selected.name}</p>
                  <p className="mt-0.5 truncate text-xs text-faint">{subtitleFor(selected)}</p>
                  {selected.reason && <p className="mt-1.5 text-xs text-muted">{selected.reason}</p>}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <span className={`pill ${STAGE_TONE[selected.stage]}`}>{STAGE_LABEL[selected.stage]}</span>
                  {selected.score != null && (
                    <span className={`text-lg font-semibold ${scoreColor(selected.score)}`}>{selected.score}</span>
                  )}
                </div>
              </div>

              {selected.note && (
                <p className="mt-3 rounded-lg bg-surface-2 p-2.5 text-xs text-muted">
                  <span className="text-faint">What we know: </span>{selected.note}
                </p>
              )}

              <div className="mt-4 max-h-[360px] space-y-2.5 overflow-y-auto">
                {selected.thread.length === 0 && (
                  <p className="py-6 text-center text-sm text-faint">Nothing sent yet.</p>
                )}
                {selected.thread.map((m, i) => (
                  <div key={i} className={`flex ${m.role === "setter" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[80%] rounded-xl px-3.5 py-2.5 text-sm ${m.role === "setter" ? "bg-accent/15 text-zinc-100" : "bg-surface-2 text-muted"}`}>
                      <p className="whitespace-pre-wrap">{m.text}</p>
                      <div className="mt-1.5 flex items-center justify-end gap-2">
                        <span className="text-[10px] text-faint">{m.role === "setter" ? "you" : "them"}</span>
                        {m.role === "setter" && (
                          <button className="text-faint hover:text-zinc-200" onClick={() => copy(m.text, `msg${i}`)}>
                            {copied === `msg${i}` ? <Check size={11} /> : <Copy size={11} />}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {selected.stage !== "booked" && selected.stage !== "disqualified" && (
                <div className="mt-4 border-t border-border pt-4">
                  <textarea
                    value={theirReply}
                    onChange={(e) => setTheirReply(e.target.value)}
                    rows={3}
                    placeholder="Paste what they replied…"
                    className="w-full resize-y rounded-lg bg-surface-2 px-3 py-2 text-sm outline-none"
                  />
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button className="btn-primary" onClick={draftReply} disabled={busy || !theirReply.trim()}>
                      {busy ? <Loader2 size={15} className="animate-spin" /> : <MessageSquare size={15} />}
                      {busy ? "Drafting…" : "Draft the reply"}
                    </button>
                    <button className="btn-ghost border border-border text-emerald-400" onClick={() => close("book")}>
                      <CalendarCheck size={15} /> Booked
                    </button>
                    <button className="btn-ghost border border-border" onClick={() => close("disqualify")}>
                      <UserX size={15} /> Not a fit
                    </button>
                  </div>
                  <p className="mt-2 text-[11px] text-faint">
                    Replies are drafted, never sent — copy the message into the channel they're actually in.
                  </p>
                </div>
              )}

              {selected.stage === "disqualified" && selected.disqualified_reason && (
                <p className="mt-4 border-t border-border pt-4 text-xs text-faint">Released — {selected.disqualified_reason}</p>
              )}
              {selected.stage === "booked" && (
                <p className="mt-4 border-t border-border pt-4 text-xs text-emerald-400">
                  Call booked{selected.booked_at ? ` on ${new Date(selected.booked_at).toLocaleDateString()}` : ""}.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
