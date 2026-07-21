import { useMemo, useState, type ReactNode } from "react";
import { Sparkles, FileText, ShieldCheck, AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { OutputViewer } from "@/components/OutputViewer";
import { useClients, useMeetings, useMessages, useTasks, useWorkspaceMembers } from "@/data/hooks";
import { useSlaSettings } from "@/store/slaSettings";
import { generate } from "@/lib/ai";
import { formatMetric } from "@/lib/scoreboard";
import {
  assembleUpdate,
  EMPTY_UPDATE_INPUTS,
  isThinUpdate,
  updatePromptInputs,
  type UpdateInputs,
} from "@/lib/investorUpdate";

const PERIODS = [30, 60, 90];
const TONES = ["Direct", "Confident", "Measured", "Warm"];

export default function InvestorUpdate() {
  const { data: tasks = [] } = useTasks();
  const { data: messages = [] } = useMessages();
  const { data: meetings = [] } = useMeetings();
  const { data: clients = [] } = useClients();
  const { data: members = [] } = useWorkspaceMembers();
  const cfg = useSlaSettings((s) => s.config);

  const [periodDays, setPeriodDays] = useState(30);
  const [inputs, setInputs] = useState<UpdateInputs>(EMPTY_UPDATE_INPUTS);
  const [output, setOutput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const facts = useMemo(
    () =>
      assembleUpdate(
        { tasks, messages, meetings, clients, members: members.map((m) => ({ user_id: m.user_id, name: m.name })) },
        periodDays,
        cfg,
      ),
    [tasks, messages, meetings, clients, members, periodDays, cfg],
  );

  const thin = isThinUpdate(facts);
  const set = (k: keyof UpdateInputs, v: string) => setInputs((p) => ({ ...p, [k]: v }));

  async function run() {
    setBusy(true);
    setError("");
    setOutput("");
    try {
      const out = await generate({
        tool: "investor_update",
        format: `Investor update — ${inputs.periodLabel || `last ${periodDays} days`}`,
        inputs: updatePromptInputs(facts, inputs),
      });
      setOutput(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't generate the update.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Investor-Update Helper"
        subtitle="Assembles the period's real activity first, then writes it up. No figure reaches the draft that wasn't measured or typed by you."
      />

      <div className="grid gap-5 lg:grid-cols-[22rem_1fr]">
        {/* ---- what only you can supply ---- */}
        <div className="space-y-3">
          <div className="card p-5">
            <p className="field-label">Period covered</p>
            <div className="mb-4 flex rounded-lg border border-border bg-surface-2 p-0.5 text-xs">
              {PERIODS.map((d) => (
                <button
                  key={d}
                  onClick={() => setPeriodDays(d)}
                  className={`flex-1 rounded-md px-2 py-1 transition-colors ${
                    d === periodDays ? "bg-accent text-white" : "text-muted hover:text-zinc-100"
                  }`}
                >
                  {d} days
                </button>
              ))}
            </div>

            <div className="space-y-3">
              <Field label="Company" value={inputs.company} onChange={(v) => set("company", v)} placeholder="e.g. Harrington Capital" />
              <Field label="Recipients" value={inputs.recipients} onChange={(v) => set("recipients", v)} placeholder="e.g. Seed investors & advisory board" />
              <Field label="Period label" value={inputs.periodLabel} onChange={(v) => set("periodLabel", v)} placeholder="e.g. October 2026" />
              <div>
                <label className="field-label">Headline business metrics</label>
                <textarea
                  className="input min-h-[76px]"
                  placeholder="e.g. ARR £8.2M (+18% MoM), runway 14 months, headcount 24"
                  value={inputs.headlineMetrics}
                  onChange={(e) => set("headlineMetrics", e.target.value)}
                />
                <p className="mt-1 text-[11px] text-faint">
                  The app can't see your finances. Anything you don't type here is left out, not guessed.
                </p>
              </div>
              <div>
                <label className="field-label">Lowlights / what didn't go well</label>
                <textarea
                  className="input min-h-[60px]"
                  placeholder="e.g. Enterprise pilot slipped a month"
                  value={inputs.lowlights}
                  onChange={(e) => set("lowlights", e.target.value)}
                />
              </div>
              <div>
                <label className="field-label">Asks</label>
                <textarea
                  className="input min-h-[60px]"
                  placeholder="e.g. Intros to Series A funds, two senior engineering referrals"
                  value={inputs.asks}
                  onChange={(e) => set("asks", e.target.value)}
                />
              </div>
              <div>
                <label className="field-label">Tone</label>
                <select className="input" value={inputs.tone} onChange={(e) => set("tone", e.target.value)}>
                  {TONES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <button className="btn-primary mt-4 w-full" onClick={run} disabled={busy}>
              <Sparkles size={15} />
              {busy ? "Drafting…" : "Draft the update"}
            </button>
          </div>
        </div>

        {/* ---- what the app measured, shown before generating ---- */}
        <div className="space-y-5">
          <section className="card p-5">
            <div className="mb-3 flex items-center gap-2">
              <ShieldCheck size={15} className="text-emerald-400" />
              <h2 className="font-semibold">Facts that will go into the draft</h2>
              <span className="ml-auto text-xs text-faint">
                {facts.from.toDateString()} → {facts.to.toDateString()}
              </span>
            </div>

            {thin && (
              <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-100/90">
                <AlertTriangle size={13} className="mr-1 inline text-amber-400" />
                Nothing completed and no meetings recorded in this window. Drafting now would produce an
                update with no substance behind it — widen the period or fill in the headline metrics.
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {facts.metrics.map((m) => (
                <div key={m.key} className="rounded-lg bg-surface-2 p-3">
                  <p className="eyebrow">{m.label}</p>
                  <p className="display mt-1 text-2xl">{formatMetric(m)}</p>
                </div>
              ))}
            </div>

            <FactList title="Delivered this period" empty="Nothing with a completion timestamp in this window">
              {facts.highlights.map((h, i) => (
                <li key={i}>
                  {h.title} <span className="text-faint">— {h.client}, {h.when}</span>
                </li>
              ))}
            </FactList>

            <FactList title="Meetings held" empty="None recorded">
              {facts.meetingsHeld.map((m, i) => (
                <li key={i}>
                  {m.title} <span className="text-faint">— {m.with}, {m.when}</span>
                </li>
              ))}
            </FactList>

            <FactList title="Risks & blockers (included by default)" empty="None detected">
              {facts.risks.map((r, i) => (
                <li key={i} className="text-amber-200/90">{r}</li>
              ))}
            </FactList>

            {facts.warnings.length > 0 && (
              <p className="mt-4 text-[11px] leading-snug text-faint">
                Caveats passed to the writer: {facts.warnings.join(" ")}
              </p>
            )}
          </section>

          <section className="card p-5">
            <p className="field-label">Draft</p>
            {error && <p className="mb-3 text-sm text-red-300">{error}</p>}
            {output ? (
              <OutputViewer output={output} title={`Investor update — ${inputs.company || "draft"}`} />
            ) : (
              <div className="flex flex-col items-center justify-center gap-2 py-10 text-center text-faint">
                <FileText size={28} />
                <p className="text-sm">Review the facts above, then draft the update</p>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="field-label">{label}</label>
      <input className="input" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function FactList({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string;
  children: ReactNode[];
}) {
  return (
    <div className="mt-4">
      <p className="field-label">{title}</p>
      {children.length ? (
        <ul className="space-y-1 text-sm text-muted">{children}</ul>
      ) : (
        <p className="text-xs text-faint">{empty}</p>
      )}
    </div>
  );
}
