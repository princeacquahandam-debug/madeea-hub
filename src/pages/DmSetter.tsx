import { useMemo, useState } from "react";
import { Send, Sparkles, Loader2, Copy, Check, Plus, ArrowRight, AlertTriangle, Clock } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { SetterBoard, EMPTY_OFFER } from "@/components/SetterBoard";
import { useAdCampaigns, useAdLeads, useAdsSetterMutations } from "@/data/hooks";
import { draftPlaybook, personaliseOpener, prospectsFromCsv, qualify } from "@/lib/adsSetter";
import type { AdLead, AdOffer, AdStage, DmChannel, DmOpener } from "@/types/db";

const CHANNELS: { value: DmChannel; label: string }[] = [
  { value: "instagram", label: "Instagram" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "x", label: "X / Twitter" },
  { value: "facebook", label: "Facebook" },
];

const OFFER_FIELDS: [keyof AdOffer, string, string][] = [
  ["name", "What are you selling?", "Fractional EA placement"],
  ["audience", "Who are you DMing?", "Founders of 10-50 person agencies, US/UK"],
  ["problem", "What pain do they have?", "Drowning in admin, can't hire fast enough"],
  ["outcome", "What do they get?", "A vetted EA working inside their tools in 14 days"],
  ["price", "Price / entry point", "$2k/mo, or a free workflow audit"],
];

export default function DmSetter() {
  const { data: campaigns = [] } = useAdCampaigns();
  const { data: allLeads = [] } = useAdLeads();
  const { createCampaign, addLeads, updateLead } = useAdsSetterMutations();

  const [tab, setTab] = useState<"playbook" | "work">("playbook");
  const [offer, setOffer] = useState<AdOffer>(EMPTY_OFFER);
  const [channel, setChannel] = useState<DmChannel>("instagram");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [hint, setHint] = useState("");
  const [copied, setCopied] = useState("");
  const [csv, setCsv] = useState("");
  const [openerIdx, setOpenerIdx] = useState(0);

  const playbooks = useMemo(() => campaigns.filter((c) => c.kind === "dm"), [campaigns]);
  const active = useMemo(
    () => playbooks.find((p) => p.id === activeId) ?? playbooks[0] ?? null,
    [playbooks, activeId],
  );
  // Only this page's people. A DM prospect and an ad lead share a table but never
  // a board — the pipelines are worked differently and mixing them hides both.
  const prospects = useMemo(() => {
    const dmIds = new Set(playbooks.map((p) => p.id));
    return allLeads.filter((l) => l.campaign_id && dmIds.has(l.campaign_id));
  }, [allLeads, playbooks]);

  const counts = useMemo(() => {
    const by = (s: AdStage) => prospects.filter((l) => l.stage === s).length;
    return { new: by("new"), qualifying: by("qualifying"), booked: by("booked"), disqualified: by("disqualified") };
  }, [prospects]);

  function copy(text: string, key: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? "" : c)), 1400);
    }).catch(() => {});
  }

  async function build() {
    setBusy("build"); setError(""); setHint("");
    try {
      const draft = await draftPlaybook(offer, channel);
      const saved = await createCampaign.mutateAsync({
        kind: "dm",
        channel,
        name: draft.name || offer.name,
        objective: draft.objective ?? null,
        openers: draft.openers ?? [],
        follow_ups: draft.followUps ?? [],
        qualifying_questions: draft.qualifyingQuestions ?? [],
        offer,
        // Ads-only columns stay at their defaults; `kind` is what separates them.
        platform: "meta",
      });
      setActiveId(saved.id);
      setOpenerIdx(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't write the playbook.");
    } finally { setBusy(null); }
  }

  async function importCsv() {
    if (!active) { setError("Write a playbook first — the opener depends on it."); return; }
    const rows = prospectsFromCsv(csv);
    if (!rows.length) { setError("No rows found — one handle (or name) per line."); return; }
    setBusy("csv"); setError(""); setHint("");
    try {
      const inserted = await addLeads.mutateAsync(
        rows.map((r) => ({ ...r, campaign_id: active.id, channel: active.channel, source: "csv" })),
      );
      setCsv("");
      setHint(inserted.length
        ? `Added ${inserted.length} prospect${inserted.length === 1 ? "" : "s"}.`
        : "Nothing new — those handles are already on the board.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the prospects.");
    } finally { setBusy(null); }
  }

  /** Writes the personalised first DM for everyone still untouched, then scores them. */
  async function openAll() {
    if (!active) return;
    const targets = prospects.filter((l) => l.stage === "new").slice(0, 25);
    if (!targets.length) return;
    const opener: DmOpener | undefined = active.openers[openerIdx];
    if (!opener) { setError("This playbook has no openers — regenerate it."); return; }

    setBusy("open"); setError(""); setHint("");
    let done = 0;
    const failed: string[] = [];
    // Sequential: two model calls per prospect against a shared rate limit.
    for (const p of targets) {
      try {
        const [msg, score] = [
          await personaliseOpener(active.offer, opener, p, active.channel ?? "instagram"),
          await qualify(active.offer, p, active.qualifying_questions),
        ];
        await updateLead.mutateAsync({
          id: p.id,
          patch: {
            stage: "qualifying",
            score: Math.max(0, Math.min(100, Math.round(score.score))),
            reason: score.reason?.slice(0, 300) ?? null,
            thread: [...p.thread, { role: "setter", text: msg.message ?? "", ts: Date.now() }],
          },
        });
        done++;
      } catch { failed.push(p.name); }
    }
    setHint(`Wrote ${done} opener${done === 1 ? "" : "s"}.${failed.length ? ` Skipped: ${failed.join(", ")}.` : ""} Copy each one into ${active.channel ?? "the DM"} and send it yourself.`);
    setBusy(null);
  }

  const subtitleFor = (l: AdLead) =>
    [l.handle ? `@${l.handle}` : "", l.channel ?? "", active?.name ?? ""].filter(Boolean).join(" · ") || "no handle";

  return (
    <div>
      <PageHeader title="DM Setter" subtitle="Write the cold outreach playbook, then work the replies" />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(["playbook", "work"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium ${tab === t ? "bg-accent text-white" : "bg-surface-2 text-muted hover:text-zinc-100"}`}
          >
            {t === "playbook" ? "1 · Build the playbook" : "2 · Work the DMs"}
          </button>
        ))}
        <span className="ml-auto flex flex-wrap gap-1.5">
          <span className="pill bg-zinc-500/15 text-faint">{counts.new} not opened</span>
          <span className="pill bg-amber-500/15 text-amber-400">{counts.qualifying} in conversation</span>
          <span className="pill bg-emerald-500/15 text-emerald-400">{counts.booked} booked</span>
        </span>
      </div>

      {error && (
        <div className="card mb-4 flex items-start gap-2 p-3 text-sm text-red-400">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {error}
        </div>
      )}
      {hint && !error && <div className="card mb-4 p-3 text-sm text-muted">{hint}</div>}

      {/* ── 1 · PLAYBOOK ───────────────────────────────────────────── */}
      {tab === "playbook" && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
          <div className="card p-5">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Send size={15} className="text-accent-soft" /> The offer
            </h3>
            <p className="mb-4 mt-1 text-xs text-faint">
              Who you&apos;re DMing becomes the bar every prospect is scored against. Be specific.
            </p>

            {OFFER_FIELDS.map(([key, label, ph]) => (
              <label key={key} className="mb-3 block">
                <span className="field-label">{label}</span>
                <input
                  value={offer[key] as string}
                  onChange={(e) => setOffer({ ...offer, [key]: e.target.value })}
                  placeholder={ph}
                  className="w-full rounded-lg bg-surface-2 px-3 py-2 text-sm outline-none"
                />
              </label>
            ))}

            <label className="mb-3 block">
              <span className="field-label">Channel</span>
              <select
                value={channel}
                onChange={(e) => setChannel(e.target.value as DmChannel)}
                className="w-full rounded-lg bg-surface-2 px-3 py-2 text-sm outline-none"
              >
                {CHANNELS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </label>

            <label className="mb-4 block">
              <span className="field-label">Anything else? (optional)</span>
              <textarea
                value={offer.notes}
                onChange={(e) => setOffer({ ...offer, notes: e.target.value })}
                rows={3}
                placeholder="Proof points, things to avoid saying…"
                className="w-full resize-y rounded-lg bg-surface-2 px-3 py-2 text-sm outline-none"
              />
            </label>

            <button
              className="btn-primary w-full justify-center"
              onClick={build}
              disabled={busy === "build" || !offer.name.trim() || !offer.audience.trim()}
            >
              {busy === "build" ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
              {busy === "build" ? "Writing the playbook…" : "Generate playbook"}
            </button>

            {playbooks.length > 0 && (
              <div className="mt-5">
                <span className="field-label">Saved playbooks</span>
                <div className="space-y-1">
                  {playbooks.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => { setActiveId(p.id); setOpenerIdx(0); }}
                      className={`w-full rounded-lg px-3 py-2 text-left text-xs ${active?.id === p.id ? "bg-surface-2 text-zinc-100" : "text-muted hover:bg-surface-2"}`}
                    >
                      {p.name} <span className="text-faint">· {p.channel}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div>
            {!active ? (
              <div className="card p-10 text-center text-sm text-faint">
                Describe the offer. You&apos;ll get five cold openers on different angles, a follow-up
                cadence, and the questions to answer before booking anyone.
              </div>
            ) : (
              <div className="space-y-4">
                <div className="card p-5">
                  <h3 className="text-base font-semibold">{active.name}</h3>
                  <p className="mt-0.5 text-xs text-faint">
                    {active.channel}{active.objective ? ` · ${active.objective}` : ""}
                  </p>
                  <p className="mt-3 text-xs text-muted">
                    Pick the angle to open with. It&apos;s used for every prospect you haven&apos;t messaged yet,
                    so switching angles is how you A/B test — run a batch, then change it.
                  </p>
                </div>

                {active.openers.map((o, i) => (
                  <button
                    key={i}
                    onClick={() => setOpenerIdx(i)}
                    className={`card w-full p-4 text-left transition-colors ${openerIdx === i ? "ring-1 ring-accent/50" : "hover:bg-surface-2"}`}
                  >
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <span className={`pill ${openerIdx === i ? "bg-accent/20 text-accent-soft" : "bg-surface-2 text-muted"}`}>
                        {o.angle}{openerIdx === i ? " · in use" : ""}
                      </span>
                      <span
                        className="text-faint transition-colors hover:text-zinc-200"
                        onClick={(e) => { e.stopPropagation(); copy(o.message, `op${i}`); }}
                        title="Copy this opener"
                      >
                        {copied === `op${i}` ? <Check size={14} /> : <Copy size={14} />}
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap text-sm text-muted">{o.message}</p>
                  </button>
                ))}

                {active.follow_ups.length > 0 && (
                  <div className="card p-5">
                    <h4 className="flex items-center gap-2 text-sm font-semibold">
                      <Clock size={14} className="text-accent-soft" /> If they don&apos;t reply
                    </h4>
                    <p className="mb-3 mt-1 text-xs text-faint">Send these by hand — nothing here messages anyone for you.</p>
                    <ol className="space-y-2.5">
                      {active.follow_ups.map((f, i) => (
                        <li key={i} className="rounded-lg bg-surface-2 p-3">
                          <span className="pill bg-surface-2 text-faint">after {f.waitDays} day{f.waitDays === 1 ? "" : "s"}</span>
                          <p className="mt-1.5 whitespace-pre-wrap text-sm text-muted">{f.message}</p>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}

                {active.qualifying_questions.length > 0 && (
                  <div className="card p-5">
                    <h4 className="text-sm font-semibold">Before anyone gets a call slot</h4>
                    <ol className="mt-3 space-y-1.5">
                      {active.qualifying_questions.map((q, i) => (
                        <li key={i} className="flex gap-2 text-sm text-muted">
                          <span className="text-faint">{i + 1}.</span> {q}
                        </li>
                      ))}
                    </ol>
                    <button className="btn-primary mt-4" onClick={() => setTab("work")}>
                      Bring in prospects <ArrowRight size={14} />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── 2 · WORK ───────────────────────────────────────────────── */}
      {tab === "work" && (
        <SetterBoard
          leads={prospects}
          campaignFor={(l) => playbooks.find((p) => p.id === l.campaign_id) ?? null}
          emptyHint="No prospects yet."
          subtitleFor={subtitleFor}
          intake={
            <div className="card p-5">
              <h3 className="text-sm font-semibold">Bring prospects in</h3>
              <p className="mb-3 mt-1 text-xs text-faint">
                {active ? <>Using <span className="text-zinc-300">{active.name}</span> on {active.channel}.</> : "Write a playbook first."}
              </p>
              <textarea
                value={csv}
                onChange={(e) => setCsv(e.target.value)}
                rows={5}
                placeholder={"handle,name,note\n@janedoe,Jane Doe,Posted about hiring an EA"}
                className="w-full resize-y rounded-lg bg-surface-2 px-3 py-2 font-mono text-xs outline-none"
              />
              <button
                className="btn-primary mt-2 w-full justify-center"
                onClick={importCsv}
                disabled={busy === "csv" || !csv.trim() || !active}
              >
                {busy === "csv" ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Add prospects
              </button>
              <p className="mt-2 text-[11px] text-faint">
                The note is what the opener personalises on — one real, specific observation beats a generic compliment.
              </p>
            </div>
          }
          actions={
            <div className="card p-5">
              <button
                className="btn-primary w-full justify-center"
                onClick={openAll}
                disabled={busy === "open" || counts.new === 0 || !active}
              >
                {busy === "open" ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                {busy === "open" ? "Writing openers…" : `Write ${counts.new} opener${counts.new === 1 ? "" : "s"}`}
              </button>
              <p className="mt-2 text-[11px] text-faint">
                Personalises the chosen angle for each prospect and scores them. Nothing is sent — you copy each
                message into {active?.channel ?? "the channel"} yourself.
              </p>
            </div>
          }
        />
      )}
    </div>
  );
}
