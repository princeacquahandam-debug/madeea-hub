import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PlanProposals, parseProposals } from "@/components/calendar/PlanProposals";
import { useCalendarTimezone } from "@/data/hooks";
import { DurationSlider } from "@/components/DurationSlider";
import { cn } from "@/lib/utils";
import { Sparkles, Mail, Calendar, Search, BarChart3, Share2, Infinity as InfinityIcon, ArrowLeft } from "lucide-react";
import { QUICK_ACTION_GROUPS } from "@/lib/constants";
import { CURATED_QUICK_ACTIONS, QUICK_ACTION_SCHEMAS, DEFAULT_QUICK_ACTION } from "@/lib/quickActions";
import { PageHeader, Modal } from "@/components/ui";
import { generate } from "@/lib/ai";
import { OutputViewer } from "@/components/OutputViewer";

// Keyed by title, not by position. The old array was positional, so when the
// §5.1 consolidation reordered the groups every icon silently pointed at the
// wrong heading.
const GROUP_ICONS: Record<string, typeof Mail> = {
  "Email & Communication": Mail,
  Research: Search,
  "Social & LinkedIn": Share2,
  "Meetings & Calendar": Calendar,
  Reporting: BarChart3,
};

export default function QuickActions() {
  const [params, setParams] = useSearchParams();
  const [active, setActive] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [output, setOutput] = useState("");
  /* The calendar's own zone, so a block the model calls 09:30 is booked at
     09:30 where the calendar lives rather than where this laptop happens to be.
     Deliberately its own cached query: deriving it from a date range built with
     Date.now() changed the query key on every render, so the answer was never
     ready and this silently fell back to the browser's zone. */
  const { data: calendarTz } = useCalendarTimezone();
  const planTz = calendarTz ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [busy, setBusy] = useState(false);

  // Curated first, then the superseded originals, so anything restored to the
  // menu from the §6 list still finds its form. See lib/quickActions.ts.
  const found = active ? CURATED_QUICK_ACTIONS[active] ?? QUICK_ACTION_SCHEMAS[active] : undefined;
  const schema = active ? found ?? DEFAULT_QUICK_ACTION : null;
  const example = found?.example;
  const plan = active === "Plan the Calendar" && output ? parseProposals(output) : null;

  function open(action: string) {
    setActive(action);
    setValues({});
    setOutput("");
    setBusy(false);
  }

  function close() {
    setActive(null);
    // Drop ?action= too, otherwise closing the modal leaves a URL that reopens
    // it on the next refresh or back-navigation.
    if (params.has("action")) setParams({}, { replace: true });
  }

  // Deep link from the Inbox (R-5.1.3). Only opens an action
  // that is actually in the menu, so a stale or hand-typed link lands on the
  // list rather than an empty form.
  useEffect(() => {
    const wanted = params.get("action");
    if (!wanted) return;
    if (!QUICK_ACTION_GROUPS.some((g) => g.actions.includes(wanted))) return;
    open(wanted);

    /* Fields can arrive prefilled, which is how the Calendar hands over a real
       meeting instead of making somebody retype what the app already knows.
       Only keys the chosen action actually declares are accepted: a hand-typed
       or stale URL cannot inject arbitrary values into the model's inputs. */
    const found = CURATED_QUICK_ACTIONS[wanted] ?? QUICK_ACTION_SCHEMAS[wanted] ?? DEFAULT_QUICK_ACTION;
    const seeded: Record<string, string> = {};
    for (const f of found.fields) {
      const v = params.get(f.name);
      if (v) seeded[f.name] = v;
    }
    if (Object.keys(seeded).length) setValues(seeded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  async function run() {
    if (!active) return;
    setOutput("");
    setBusy(true);
    try {
      const out = await generate({ tool: "quick_action", format: active, inputs: values });
      setOutput(out);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="AI Quick Actions"
        subtitle="Eleven actions, one per job. Each absorbed the four or five near-duplicates it replaced."
      />

      {/* R-5.1.5. Rowena at 1:24:46: this is a real, cited win with a past EA
          (Tessa), and it is the reason to use these rather than the free tier
          of something else. It was nowhere in the app, so nobody knew. */}
      <div className="mb-6 flex items-start gap-2.5 rounded-xl border border-border bg-surface px-4 py-3">
        <InfinityIcon size={16} className="mt-0.5 shrink-0 text-accent" />
        <p className="text-[13px] leading-relaxed text-muted">
          <span className="font-semibold text-fg">No usage limits.</span>{" "}
          Run these as many times as the work needs. Free ChatGPT throttles you part way
          through a busy morning, which is exactly when it matters.
        </p>
      </div>

      <div className="space-y-6">
        {QUICK_ACTION_GROUPS.map((group) => {
          const Icon = GROUP_ICONS[group.title] ?? Sparkles;
          return (
            <section key={group.title}>
              <div className="mb-3 flex items-center gap-2">
                <Icon size={16} className="text-accent-soft" />
                <h2 className="font-semibold">{group.title}</h2>
              </div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                {group.actions.map((a) => (
                  <button
                    key={a}
                    onClick={() => open(a)}
                    className="flex items-center gap-2 rounded-lg border border-border bg-surface p-4 text-left text-sm font-medium transition-colors hover:border-accent/40"
                  >
                    <Sparkles size={14} className="shrink-0 text-accent-soft" />
                    {a}
                  </button>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <Modal open={active !== null} onClose={close}>
        <div className="mb-3 flex items-center gap-2">
          <Sparkles size={16} className="text-accent-soft" />
          <h2 className="font-semibold">{active}</h2>
        </div>

        {schema && <p className="mb-4 text-sm text-muted">{schema.howTo}</p>}

        {busy ? (
          <p className="py-8 text-center text-sm text-faint">Generating with AI…</p>
        ) : output ? (
          <div className="space-y-4">
            {/* A plan you can book, rather than one you retype. The prose still
                renders either way: if the model returns no block, or a broken
                one, there are simply no buttons. Never invented ones. */}
            {plan ? (
              <>
                <OutputViewer output={plan.prose} title={active ?? "AI Output"} />
                {plan.proposals && (
                  <PlanProposals proposals={plan.proposals} date={values.date ?? ""} tz={planTz} />
                )}
              </>
            ) : (
              <OutputViewer output={output} title={active ?? "AI Output"} />
            )}
            <button className="btn-ghost border border-border" onClick={() => setOutput("")}>
              <ArrowLeft size={15} /> Back to inputs
            </button>
          </div>
        ) : schema ? (
          <div>
            <div className="space-y-3">
              {schema.fields.map((field) => (
                <div key={field.name}>
                  <label className="field-label" htmlFor={`qa-${field.name}`}>{field.label}</label>
                  {field.type === "duration" ? (
                    <DurationSlider
                      id={`qa-${field.name}`}
                      value={values[field.name] ?? ""}
                      onChange={(v) => setValues((x) => ({ ...x, [field.name]: v }))}
                    />
                  ) : field.type === "date" ? (
                    <input
                      id={`qa-${field.name}`}
                      type="date"
                      className="input"
                      value={values[field.name] ?? ""}
                      onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
                    />
                  ) : field.type === "combo" ? (
                    <>
                      {/* An input with a datalist: free text, with the presets
                          offered rather than imposed. A select could not carry
                          an agenda nobody anticipated. */}
                      <input
                        id={`qa-${field.name}`}
                        className="input"
                        list={`qa-${field.name}-options`}
                        placeholder={field.placeholder}
                        value={values[field.name] ?? ""}
                        onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
                      />
                      <datalist id={`qa-${field.name}-options`}>
                        {field.options?.map((o) => <option key={o} value={o} />)}
                      </datalist>
                      {/* Datalists are near-invisible on some browsers, so the
                          presets are also real buttons. */}
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {field.options?.map((o) => (
                          <button
                            key={o}
                            type="button"
                            onClick={() => setValues((v) => ({ ...v, [field.name]: o }))}
                            aria-pressed={values[field.name] === o}
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[11px] transition-colors",
                              values[field.name] === o
                                ? "bg-[var(--nav-active-bg)] text-[color:var(--nav-active-text)]"
                                : "text-faint hover:bg-[var(--chip-bg)] hover:text-text",
                            )}
                          >
                            {o}
                          </button>
                        ))}
                      </div>
                    </>
                  ) : field.type === "textarea" ? (
                    <textarea
                      id={`qa-${field.name}`}
                      className="input min-h-[80px]"
                      placeholder={field.placeholder}
                      value={values[field.name] ?? ""}
                      onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
                    />
                  ) : field.type === "select" ? (
                    <select
                      id={`qa-${field.name}`}
                      className="input"
                      value={values[field.name] ?? ""}
                      onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
                    >
                      <option value="">Select…</option>
                      {field.options?.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id={`qa-${field.name}`}
                      className="input"
                      placeholder={field.placeholder}
                      value={values[field.name] ?? ""}
                      onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
                    />
                  )}
                </div>
              ))}
            </div>

            {example && <p className="mt-3 text-xs text-faint">Example: {example}</p>}

            <button className="btn-primary mt-4 w-full" onClick={run} disabled={busy}>
              <Sparkles size={15} />
              Generate
            </button>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
