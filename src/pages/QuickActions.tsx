import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
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
  const [busy, setBusy] = useState(false);

  // Curated first, then the superseded originals, so anything restored to the
  // menu from the §6 list still finds its form. See lib/quickActions.ts.
  const found = active ? CURATED_QUICK_ACTIONS[active] ?? QUICK_ACTION_SCHEMAS[active] : undefined;
  const schema = active ? found ?? DEFAULT_QUICK_ACTION : null;
  const example = found?.example;

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
    if (QUICK_ACTION_GROUPS.some((g) => g.actions.includes(wanted))) open(wanted);
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
            <OutputViewer output={output} title={active ?? "AI Output"} />
            <button className="btn-ghost border border-border" onClick={() => setOutput("")}>
              <ArrowLeft size={15} /> Back to inputs
            </button>
          </div>
        ) : schema ? (
          <div>
            <div className="space-y-3">
              {schema.fields.map((field) => (
                <div key={field.name}>
                  <label className="field-label">{field.label}</label>
                  {field.type === "textarea" ? (
                    <textarea
                      className="input min-h-[80px]"
                      placeholder={field.placeholder}
                      value={values[field.name] ?? ""}
                      onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
                    />
                  ) : field.type === "select" ? (
                    <select
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
