import { useState } from "react";
import { Sparkles, PenLine, Calendar, Search, BarChart3, Workflow, ArrowLeft } from "lucide-react";
import { QUICK_ACTION_GROUPS } from "@/lib/constants";
import { QUICK_ACTION_SCHEMAS, DEFAULT_QUICK_ACTION } from "@/lib/quickActions";
import { PageHeader, Modal } from "@/components/ui";
import { generate } from "@/lib/ai";
import { OutputViewer } from "@/components/OutputViewer";

const GROUP_ICONS = [PenLine, Calendar, Search, BarChart3, Workflow];

export default function QuickActions() {
  const [active, setActive] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [output, setOutput] = useState("");
  const [busy, setBusy] = useState(false);

  const schema = active ? QUICK_ACTION_SCHEMAS[active] ?? DEFAULT_QUICK_ACTION : null;
  const example = active ? QUICK_ACTION_SCHEMAS[active]?.example : undefined;

  function open(action: string) {
    setActive(action);
    setValues({});
    setOutput("");
    setBusy(false);
  }

  function close() {
    setActive(null);
  }

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
      <PageHeader title="AI Quick Actions" subtitle="Instant AI-powered outputs for executive operations" />

      <div className="space-y-6">
        {QUICK_ACTION_GROUPS.map((group, gi) => {
          const Icon = GROUP_ICONS[gi];
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
          <p className="py-8 text-center text-sm text-faint">Generating with Claude…</p>
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
