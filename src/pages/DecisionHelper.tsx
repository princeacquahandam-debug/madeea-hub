import { useMemo, useState } from "react";
import { Scale, Plus, Trash2, Sparkles, AlertTriangle, ShieldAlert, FileText } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { OutputViewer } from "@/components/OutputViewer";
import { generate } from "@/lib/ai";
import {
  CLOSE_MARGIN,
  MAX_SCORE,
  MAX_WEIGHT,
  MIN_WEIGHT,
  STARTER_CRITERIA,
  decide,
  decisionPromptInputs,
  emptyCriterion,
  emptyOption,
  type Criterion,
  type Option,
  type Scores,
} from "@/lib/decision";

let seq = 0;
const nextId = () => ++seq;

export default function DecisionHelper() {
  const [question, setQuestion] = useState("");
  const [context, setContext] = useState("");
  const [options, setOptions] = useState<Option[]>([emptyOption(nextId()), emptyOption(nextId())]);
  const [criteria, setCriteria] = useState<Criterion[]>(
    STARTER_CRITERIA.slice(0, 3).map((label) => ({ ...emptyCriterion(nextId()), label })),
  );
  const [scores, setScores] = useState<Scores>({});
  const [record, setRecord] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const result = useMemo(() => decide(options, criteria, scores), [options, criteria, scores]);

  const setScore = (optId: string, critId: string, v: number | null) =>
    setScores((prev) => {
      const row = { ...(prev[optId] ?? {}) };
      if (v === null) delete row[critId];
      else row[critId] = v;
      return { ...prev, [optId]: row };
    });

  async function writeRecord() {
    setBusy(true);
    setError("");
    setRecord("");
    try {
      setRecord(
        await generate({
          tool: "decision",
          format: `Decision record — ${question || "untitled"}`,
          inputs: decisionPromptInputs(question, context, result),
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't write the record.");
    } finally {
      setBusy(false);
    }
  }

  const flippers = result.sensitivity.filter((s) => s.flipsAt !== null);

  return (
    <div>
      <PageHeader
        title="Decision Helper"
        subtitle="Structures the decision so you can see what's driving it. It does not make the decision."
      />

      {/* This banner is load-bearing, not boilerplate. See lib/decision.ts. */}
      <div className="card mb-5 border-amber-500/30 bg-amber-500/5 p-4">
        <div className="flex items-start gap-2">
          <ShieldAlert size={15} className="mt-0.5 shrink-0 text-amber-400" />
          <div className="text-xs leading-relaxed text-amber-100/90">
            <p className="mb-1 font-medium text-amber-200">You decide. This does the arithmetic.</p>
            The options, the criteria and — most importantly — the weights are your judgement. All
            this does is multiply and sort, then tell you which weight would have to change to flip
            the answer. The AI writes the record afterwards; it is not asked what to choose, and it
            is instructed not to say.
          </div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-5">
          <section className="card p-5">
            <div className="space-y-3">
              <div>
                <label className="field-label">What's the decision?</label>
                <input
                  className="input"
                  placeholder="e.g. Which venue for the Q4 client dinner?"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                />
              </div>
              <div>
                <label className="field-label">Context worth recording</label>
                <textarea
                  className="input min-h-[60px]"
                  placeholder="e.g. 40 guests, budget £6k, James wants somewhere walkable from the office"
                  value={context}
                  onChange={(e) => setContext(e.target.value)}
                />
              </div>
            </div>
          </section>

          {/* ---- criteria ---- */}
          <section className="card p-5">
            <div className="mb-3 flex items-center gap-2">
              <Scale size={16} className="text-accent-soft" />
              <h2 className="font-semibold">What matters, and how much</h2>
              <button
                className="btn-ghost ml-auto border border-border py-1 text-xs"
                onClick={() => setCriteria((c) => [...c, emptyCriterion(nextId())])}
              >
                <Plus size={13} /> Add
              </button>
            </div>
            <div className="space-y-2">
              {criteria.map((c) => (
                <div key={c.id} className="flex items-center gap-3 rounded-lg bg-surface-2 p-3">
                  <input
                    className="input py-1 text-sm"
                    placeholder="e.g. Cost"
                    value={c.label}
                    onChange={(e) =>
                      setCriteria((prev) => prev.map((x) => (x.id === c.id ? { ...x, label: e.target.value } : x)))
                    }
                  />
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-[11px] text-faint">weight</span>
                    <input
                      type="range"
                      min={MIN_WEIGHT}
                      max={MAX_WEIGHT}
                      value={c.weight}
                      onChange={(e) =>
                        setCriteria((prev) =>
                          prev.map((x) => (x.id === c.id ? { ...x, weight: Number(e.target.value) } : x)),
                        )
                      }
                      className="w-24 accent-orange-500"
                      aria-label={`Weight for ${c.label || "criterion"}`}
                    />
                    <span className="w-4 text-sm font-semibold tabular-nums">{c.weight}</span>
                  </div>
                  <button
                    className="shrink-0 text-faint hover:text-red-400"
                    onClick={() => setCriteria((prev) => prev.filter((x) => x.id !== c.id))}
                    aria-label={`Remove ${c.label || "criterion"}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </section>

          {/* ---- the matrix ---- */}
          <section className="card p-5">
            <div className="mb-3 flex items-center gap-2">
              <h2 className="font-semibold">Score each option</h2>
              <span className="text-xs text-faint">0–{MAX_SCORE}, blank = not scored</span>
              <button
                className="btn-ghost ml-auto border border-border py-1 text-xs"
                onClick={() => setOptions((o) => [...o, emptyOption(nextId())])}
              >
                <Plus size={13} /> Add option
              </button>
            </div>

            <div className="space-y-3">
              {options.map((o) => (
                <div key={o.id} className="rounded-lg bg-surface-2 p-3">
                  <div className="flex items-center gap-2">
                    <input
                      className="input py-1 text-sm font-medium"
                      placeholder="Option name"
                      value={o.label}
                      onChange={(e) =>
                        setOptions((prev) => prev.map((x) => (x.id === o.id ? { ...x, label: e.target.value } : x)))
                      }
                    />
                    {options.length > 2 && (
                      <button
                        className="shrink-0 text-faint hover:text-red-400"
                        onClick={() => setOptions((prev) => prev.filter((x) => x.id !== o.id))}
                        aria-label={`Remove ${o.label || "option"}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>

                  <div className="mt-2 flex flex-wrap gap-3">
                    {criteria.filter((c) => c.label.trim()).map((c) => (
                      <div key={c.id} className="flex items-center gap-1.5">
                        <span className="text-[11px] text-faint">{c.label}</span>
                        <select
                          className="input w-auto py-0.5 text-xs"
                          value={scores[o.id]?.[c.id] ?? ""}
                          onChange={(e) =>
                            setScore(o.id, c.id, e.target.value === "" ? null : Number(e.target.value))
                          }
                          aria-label={`${o.label || "Option"} scored on ${c.label}`}
                        >
                          <option value="">—</option>
                          {Array.from({ length: MAX_SCORE + 1 }, (_, n) => (
                            <option key={n} value={n}>
                              {n}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>

                  <input
                    className="input mt-2 py-1 text-xs"
                    placeholder="Note (optional) — anything the score doesn't capture"
                    value={o.note}
                    onChange={(e) =>
                      setOptions((prev) => prev.map((x) => (x.id === o.id ? { ...x, note: e.target.value } : x)))
                    }
                  />
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* ---- result ---- */}
        <div className="space-y-4">
          <section className="card p-5">
            <h2 className="mb-3 font-semibold">Where the numbers land</h2>

            {result.tooCloseToCall && (
              <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-100">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>
                  Within {CLOSE_MARGIN} points — the numbers don't decide this. Choose on judgement
                  and write down why.
                </span>
              </div>
            )}

            <div className="space-y-2">
              {result.ranked.filter((r) => r.option.label.trim()).map((r, i) => (
                <div key={r.option.id} className="rounded-lg bg-surface-2 p-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-faint">#{i + 1}</span>
                    <p className="min-w-0 flex-1 truncate text-sm font-medium">{r.option.label}</p>
                    <span className="text-sm font-semibold tabular-nums">{r.normalised.toFixed(0)}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-bg">
                    <div
                      className={`h-full ${i === 0 && !result.tooCloseToCall ? "bg-accent" : "bg-zinc-500"}`}
                      style={{ width: `${Math.max(0, Math.min(100, r.normalised))}%` }}
                    />
                  </div>
                  {r.missing.length > 0 && (
                    <p className="mt-1 text-[11px] text-faint">unscored: {r.missing.join(", ")}</p>
                  )}
                </div>
              ))}
              {!result.ranked.some((r) => r.option.label.trim()) && (
                <p className="py-4 text-center text-xs text-faint">Name your options to see the ranking.</p>
              )}
            </div>
          </section>

          <section className="card p-5">
            <h2 className="mb-2 font-semibold">What would change the answer</h2>
            {flippers.length ? (
              <ul className="space-y-2 text-xs">
                {flippers.map((s) => (
                  <li key={s.criterionId} className="rounded-lg bg-surface-2 p-2.5 text-muted">
                    If <strong className="text-zinc-200">{s.label}</strong> were weighted{" "}
                    <strong className="text-zinc-200">{s.flipsAt}</strong>,{" "}
                    {s.outcome === "flip" ? (
                      <>
                        <strong className="text-zinc-200">{s.flipsTo}</strong> would win instead.
                      </>
                    ) : (
                      <>the lead would vanish — <strong className="text-zinc-200">nothing would be clearly ahead</strong>.</>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-faint">
                {result.leader
                  ? "No single weight change flips the result — the ranking is robust to how you've weighted things."
                  : "Score the options to see this."}
              </p>
            )}
          </section>

          {result.warnings.length > 0 && (
            <section className="card p-4">
              <p className="field-label">Worth knowing</p>
              <ul className="space-y-1 text-[11px] leading-snug text-faint">
                {result.warnings.map((w, i) => (
                  <li key={i}>• {w}</li>
                ))}
              </ul>
            </section>
          )}

          <section className="card p-5">
            <div className="mb-3 flex items-center gap-2">
              <p className="field-label mb-0">Decision record</p>
              <button
                className="btn-primary ml-auto py-1.5 text-xs"
                onClick={writeRecord}
                disabled={busy || !result.leader}
              >
                <Sparkles size={14} />
                {busy ? "Writing…" : "Write it up"}
              </button>
            </div>
            {error && <p className="mb-3 text-sm text-red-300">{error}</p>}
            {record ? (
              <OutputViewer output={record} title={`Decision — ${question || "record"}`} />
            ) : (
              <div className="flex flex-col items-center justify-center gap-2 py-6 text-center text-faint">
                <FileText size={22} />
                <p className="text-xs">A record of what you weighed and why — for the file, not a recommendation</p>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
