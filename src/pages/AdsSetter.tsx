import { useMemo, useState } from "react";
import {
  Megaphone, Target, Sparkles, Loader2, Copy, Check, Plus, ArrowRight, AlertTriangle,
} from "lucide-react";
import { Badge, PageHeader } from "@/components/ui";
import { SetterBoard, EMPTY_OFFER } from "@/components/SetterBoard";
import { useAdCampaigns, useAdLeads, useAdsSetterMutations } from "@/data/hooks";
import { draftCampaign, qualify, leadsFromCsv, utmFor } from "@/lib/adsSetter";
import { supabase } from "@/lib/supabase";
import type { AdCampaign, AdLead, AdOffer, AdPlatform, AdStage } from "@/types/db";

const OFFER_FIELDS: [keyof AdOffer, string, string][] = [
  ["name", "What are you selling?", "Fractional EA placement"],
  ["audience", "Who is it for?", "Founders of 10-50 person agencies, US/UK"],
  ["problem", "What pain does it solve?", "Drowning in admin, can't hire fast enough"],
  ["outcome", "What do they get?", "A vetted EA working inside their tools in 14 days"],
  ["price", "Price / entry point", "$2k/mo, or a free workflow audit"],
  ["geo", "Where?", "United States, United Kingdom"],
];

export default function AdsSetter() {
  const { data: allCampaigns = [] } = useAdCampaigns();
  const { data: allLeads = [] } = useAdLeads();
  const { createCampaign, addLeads, updateLead } = useAdsSetterMutations();

  const [tab, setTab] = useState<"build" | "set">("build");
  const [offer, setOffer] = useState<AdOffer>(EMPTY_OFFER);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [hint, setHint] = useState("");
  const [copied, setCopied] = useState("");
  const [csv, setCsv] = useState("");

  // Ads campaigns only. DM playbooks share these tables but never this board —
  // the two pipelines are worked differently and mixing them hides both.
  const campaigns = useMemo(() => allCampaigns.filter((c) => c.kind === "ads"), [allCampaigns]);
  const active = useMemo(
    () => campaigns.find((c) => c.id === activeId) ?? campaigns[0] ?? null,
    [campaigns, activeId],
  );
  const leads = useMemo(() => {
    const ids = new Set(campaigns.map((c) => c.id));
    return allLeads.filter((l) => l.campaign_id && ids.has(l.campaign_id));
  }, [allLeads, campaigns]);

  const counts = useMemo(() => {
    const by = (s: AdStage) => leads.filter((l) => l.stage === s).length;
    return { new: by("new"), qualifying: by("qualifying"), booked: by("booked"), disqualified: by("disqualified") };
  }, [leads]);

  function copy(text: string, key: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? "" : c)), 1400);
    }).catch(() => {});
  }

  async function build() {
    setBusy("build"); setError(""); setHint("");
    try {
      const draft = await draftCampaign(offer);
      const saved = await createCampaign.mutateAsync({
        kind: "ads",
        name: draft.name || offer.name,
        platform: offer.platform,
        objective: draft.objective ?? null,
        daily_budget: draft.dailyBudget ?? null,
        targeting: draft.targeting ?? {},
        creatives: draft.creatives ?? [],
        offer,
        qualifying_questions: draft.qualifyingQuestions ?? [],
      });
      // The UTM carries the row id, so it can only be written once the row exists.
      if (supabase) {
        await supabase.from("ad_campaigns")
          .update({ utm: utmFor(saved.name, saved.platform, saved.id) }).eq("id", saved.id);
      }
      setActiveId(saved.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't generate the campaign.");
    } finally { setBusy(null); }
  }

  async function importCsv() {
    if (!active) { setError("Pick a campaign first — the setter needs to know what the ad promised."); return; }
    const rows = leadsFromCsv(csv);
    if (!rows.length) { setError("No rows found — include a name, email or phone per line."); return; }
    setBusy("csv"); setError(""); setHint("");
    try {
      const inserted = await addLeads.mutateAsync(rows.map((r) => ({ ...r, campaign_id: active.id, source: "csv" })));
      setCsv("");
      setHint(inserted.length
        ? `Added ${inserted.length} lead${inserted.length === 1 ? "" : "s"}.`
        : "Nothing new — those leads were already on the board.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the leads.");
    } finally { setBusy(null); }
  }

  async function qualifyNew() {
    const targets = leads.filter((l) => l.stage === "new").slice(0, 25);
    if (!targets.length) return;
    setBusy("qualify"); setError(""); setHint("");
    let done = 0;
    const failed: string[] = [];
    // Sequential: one model call each against a shared rate limit, and a burst is
    // the reliable way to get 429s. One bad lead must not abandon the batch.
    for (const lead of targets) {
      const c = campaigns.find((x) => x.id === lead.campaign_id) ?? null;
      try {
        const r = await qualify(c?.offer ?? EMPTY_OFFER, lead, c?.qualifying_questions ?? []);
        await updateLead.mutateAsync({
          id: lead.id,
          patch: {
            score: Math.max(0, Math.min(100, Math.round(r.score))),
            reason: r.reason?.slice(0, 300) ?? null,
            stage: "qualifying",
            thread: [...lead.thread, { role: "setter", text: r.opener ?? "", ts: Date.now() }],
          },
        });
        done++;
      } catch { failed.push(lead.name); }
    }
    setHint(`Qualified ${done}.${failed.length ? ` Skipped: ${failed.join(", ")}.` : ""}`);
    setBusy(null);
  }

  const subtitleFor = (l: AdLead) => {
    const c = campaigns.find((x) => x.id === l.campaign_id);
    return [[l.email, l.phone].filter(Boolean).join(" · ") || "no contact details", c?.name ?? ""]
      .filter(Boolean).join(" · ");
  };

  return (
    <div>
      <PageHeader title="Ads Setter" subtitle="Launch the campaign, then set the leads it brings in" />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(["build", "set"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium ${tab === t ? "bg-accent text-white" : "bg-surface-2 text-muted hover:text-zinc-100"}`}
          >
            {t === "build" ? "1 · Build the ads" : "2 · Set the leads"}
          </button>
        ))}
        <span className="ml-auto flex flex-wrap gap-1.5">
          <span className="pill bg-zinc-500/15 text-faint">{counts.new} new</span>
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

      {/* ── 1 · BUILD ──────────────────────────────────────────────── */}
      {tab === "build" && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
          <div className="card p-5">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Megaphone size={15} className="text-accent-soft" /> The offer
            </h3>
            <p className="mb-4 mt-1 text-xs text-faint">
              What you write as the audience becomes the bar every lead is scored against later. Vague in, vague out.
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
              <span className="field-label">Platform</span>
              <select
                value={offer.platform}
                onChange={(e) => setOffer({ ...offer, platform: e.target.value as AdPlatform })}
                className="w-full rounded-lg bg-surface-2 px-3 py-2 text-sm outline-none"
              >
                <option value="meta">Meta (Facebook / Instagram)</option>
                <option value="google">Google Ads</option>
                <option value="linkedin">LinkedIn</option>
                <option value="tiktok">TikTok</option>
              </select>
            </label>

            <label className="mb-4 block">
              <span className="field-label">Anything else? (optional)</span>
              <textarea
                value={offer.notes}
                onChange={(e) => setOffer({ ...offer, notes: e.target.value })}
                rows={3}
                placeholder="Proof points, things to avoid saying, compliance limits…"
                className="w-full resize-y rounded-lg bg-surface-2 px-3 py-2 text-sm outline-none"
              />
            </label>

            <button
              className="btn-primary w-full justify-center"
              onClick={build}
              disabled={busy === "build" || !offer.name.trim() || !offer.audience.trim()}
            >
              {busy === "build" ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
              {busy === "build" ? "Writing the campaign…" : "Generate campaign"}
            </button>

            {campaigns.length > 0 && (
              <div className="mt-5">
                <span className="field-label">Saved campaigns</span>
                <div className="space-y-1">
                  {campaigns.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => setActiveId(c.id)}
                      className={`w-full rounded-lg px-3 py-2 text-left text-xs ${active?.id === c.id ? "bg-surface-2 text-zinc-100" : "text-muted hover:bg-surface-2"}`}
                    >
                      {c.name} <span className="text-faint">· {c.platform}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div>
            {!active ? (
              <div className="card p-10 text-center text-sm text-faint">
                Describe the offer. You&apos;ll get five different ad angles, targeting, a UTM string, and the
                questions the setter must answer before booking anyone.
              </div>
            ) : (
              <div className="space-y-4">
                <CampaignHeader campaign={active} copied={copied} onCopy={copy} />
                <TargetingCard campaign={active} />
                {active.creatives.map((c, i) => (
                  <div key={i} className="card p-4">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <span className="pill bg-accent/15 text-accent-soft">{c.angle}</span>
                      <button
                        className="text-faint transition-colors hover:text-zinc-200"
                        onClick={() => copy(`${c.headline}\n\n${c.primaryText}\n\n${c.description}\n\nCTA: ${c.cta}`, `ad${i}`)}
                        title="Copy this ad"
                      >
                        {copied === `ad${i}` ? <Check size={14} /> : <Copy size={14} />}
                      </button>
                    </div>
                    <p className="text-sm font-semibold">{c.headline}</p>
                    <p className="mt-1.5 whitespace-pre-wrap text-sm text-muted">{c.primaryText}</p>
                    <p className="mt-2 text-xs text-faint">{c.description}</p>
                    <span className="pill mt-2.5 bg-surface-2 text-muted">{c.cta}</span>
                  </div>
                ))}
                {active.qualifying_questions.length > 0 && (
                  <div className="card p-5">
                    <h4 className="text-sm font-semibold">Before anyone gets a call slot</h4>
                    <p className="mb-3 mt-1 text-xs text-faint">
                      The setter works through these and won&apos;t offer a time until they&apos;re answered.
                    </p>
                    <ol className="space-y-1.5">
                      {active.qualifying_questions.map((q, i) => (
                        <li key={i} className="flex gap-2 text-sm text-muted">
                          <span className="text-faint">{i + 1}.</span> {q}
                        </li>
                      ))}
                    </ol>
                    <button className="btn-primary mt-4" onClick={() => setTab("set")}>
                      Bring in the leads <ArrowRight size={14} />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── 2 · SET ────────────────────────────────────────────────── */}
      {tab === "set" && (
        <SetterBoard
          leads={leads}
          campaignFor={(l) => campaigns.find((c) => c.id === l.campaign_id) ?? null}
          emptyHint="No leads yet."
          subtitleFor={subtitleFor}
          intake={
            <div className="card p-5">
              <h3 className="text-sm font-semibold">Bring leads in</h3>
              <p className="mb-3 mt-1 text-xs text-faint">
                {active ? <>Attaching to <span className="text-zinc-300">{active.name}</span>.</> : "Generate a campaign first."}
              </p>
              <textarea
                value={csv}
                onChange={(e) => setCsv(e.target.value)}
                rows={5}
                placeholder={"name,email,phone,note\nJane Doe,jane@co.com,,Wants pricing"}
                className="w-full resize-y rounded-lg bg-surface-2 px-3 py-2 font-mono text-xs outline-none"
              />
              <button
                className="btn-primary mt-2 w-full justify-center"
                onClick={importCsv}
                disabled={busy === "csv" || !csv.trim() || !active}
              >
                {busy === "csv" ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Add from CSV
              </button>
              <p className="mt-2 text-[11px] text-faint">
                Re-pasting the same export is safe — leads are matched on email or phone, and a live conversation is never overwritten.
              </p>
            </div>
          }
          actions={
            <div className="card p-5">
              <button
                className="btn-primary w-full justify-center"
                onClick={qualifyNew}
                disabled={busy === "qualify" || counts.new === 0}
              >
                {busy === "qualify" ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
                {busy === "qualify" ? "Qualifying…" : `Qualify ${counts.new} new lead${counts.new === 1 ? "" : "s"}`}
              </button>
              <p className="mt-2 text-[11px] text-faint">
                Scores each against the campaign audience and writes the opening message. One at a time, to stay under the AI rate limit.
              </p>
            </div>
          }
        />
      )}
    </div>
  );
}

function CampaignHeader({ campaign, copied, onCopy }: {
  campaign: AdCampaign; copied: string; onCopy: (t: string, k: string) => void;
}) {
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">{campaign.name}</h3>
          <p className="mt-0.5 text-xs text-faint">
            {campaign.platform}{campaign.objective ? ` · ${campaign.objective}` : ""}{campaign.daily_budget ? ` · ${campaign.daily_budget}` : ""}
          </p>
        </div>
        {campaign.utm && (
          <button className="pill bg-surface-2 text-muted" onClick={() => onCopy(campaign.utm!, "utm")} title="Copy the UTM query string">
            {copied === "utm" ? <Check size={12} /> : <Copy size={12} />} UTM
          </button>
        )}
      </div>
      {campaign.utm && <code className="mt-3 block break-all text-[11px] text-faint">{campaign.utm}</code>}
      <p className="mt-2 text-[11px] text-faint">
        Append this to your landing page URL — it carries the campaign id, so leads trace back without manual tagging.
      </p>
    </div>
  );
}

function TargetingCard({ campaign }: { campaign: AdCampaign }) {
  const t = campaign.targeting ?? { locations: [], ageRange: "", interests: [], keywords: [], exclusions: [] };
  const groups: [string, string[]][] = [
    ["Locations", t.locations ?? []],
    ["Interests", t.interests ?? []],
    ["Keywords", t.keywords ?? []],
    ["Exclude", t.exclusions ?? []],
  ];
  return (
    <div className="card p-5">
      <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <Target size={14} className="text-accent-soft" /> Targeting
      </h4>
      <div className="grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
        {groups.map(([label, vals]) => vals.length > 0 && (
          <div key={label}>
            <span className="text-faint">{label}</span>
            <p className="mt-0.5 text-muted">{vals.join(", ")}</p>
          </div>
        ))}
        {t.ageRange && (
          <div><span className="text-faint">Age</span><p className="mt-0.5 text-muted">{t.ageRange}</p></div>
        )}
      </div>
      <Badge tone="reply">{campaign.creatives.length} ad variations</Badge>
    </div>
  );
}
