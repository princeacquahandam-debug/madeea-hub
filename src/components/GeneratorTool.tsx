import { useState } from "react";
import { Sparkles, FileText } from "lucide-react";
import type { StudioFormat } from "@/lib/constants";
import { generate } from "@/lib/ai";
import { useClients } from "@/data/hooks";
import { OutputViewer } from "@/components/OutputViewer";
import { Tooltip } from "@/components/Tooltip";
import { useSavedPrompts } from "@/store/savedPrompts";
import { Bookmark } from "lucide-react";

export function GeneratorTool({
  tool,
  formats,
  badge = "Claude AI Connected",
}: {
  tool: "studio" | "bookkeeping";
  formats: StudioFormat[];
  badge?: string;
}) {
  const [activeKey, setActiveKey] = useState(formats[0].key);
  const [values, setValues] = useState<Record<string, string>>({});
  const [output, setOutput] = useState("");
  const [busy, setBusy] = useState(false);
  const active = formats.find((f) => f.key === activeKey)!;
  const { data: clients = [] } = useClients();
  const { prompts, save } = useSavedPrompts();
  const savedForKey = prompts.filter((p) => p.key === active.title);
  // Replace any hardcoded client-list options with the user's real clients.
  const optionsFor = (fieldName: string, fallback?: string[]) =>
    fieldName === "client" ? [...clients.map((c) => c.name), "Internal"] : fallback;

  function saveCurrent() {
    if (Object.values(values).every((v) => !v)) return;
    const name = window.prompt("Name this saved prompt:");
    if (name?.trim()) save({ key: active.title, name: name.trim(), inputs: values });
  }

  function selectFormat(key: string) {
    setActiveKey(key);
    setValues({});
    setOutput("");
  }

  async function run() {
    setBusy(true);
    try {
      const out = await generate({ tool, format: active.title, inputs: values });
      setOutput(out);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[16rem_1fr]">
      {/* Format picker */}
      <div className="space-y-2">
        <p className="field-label">Select Format</p>
        {formats.map((f) => (
          <button
            key={f.key}
            onClick={() => selectFormat(f.key)}
            className={`w-full rounded-lg border p-3 text-left transition-colors ${
              f.key === activeKey ? "border-accent bg-accent/10" : "border-border hover:border-accent/40"
            }`}
          >
            <p className="text-sm font-medium">{f.title}</p>
            <p className="mt-0.5 text-xs text-faint">{f.desc}</p>
          </button>
        ))}
      </div>

      {/* Form + output */}
      <div className="space-y-5">
        <div className="card p-5">
          <div className="mb-1 flex items-center gap-2">
            <Sparkles size={16} className="text-accent-soft" />
            <h2 className="font-semibold">{active.title}</h2>
            <span className="pill bg-emerald-500/15 text-emerald-400 ml-auto">{badge}</span>
          </div>
          {active.howTo && <p className="mb-1 text-xs text-muted">{active.howTo}</p>}
          {active.example && <p className="mb-3 text-xs text-faint">Example — {active.example}</p>}
          {!active.howTo && !active.example && <div className="mb-3" />}

          <div className="mb-3 flex items-center gap-2">
            {savedForKey.length > 0 && (
              <select
                className="input py-1 text-xs"
                defaultValue=""
                onChange={(e) => { const p = savedForKey.find((x) => x.id === e.target.value); if (p) setValues(p.inputs); e.target.value = ""; }}
              >
                <option value="">Load saved…</option>
                {savedForKey.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            )}
            <button className="btn-ghost ml-auto border border-border py-1 text-xs" onClick={saveCurrent}>
              <Bookmark size={12} /> Save inputs
            </button>
          </div>

          <div className="space-y-3">
            {active.fields.map((field) => (
              <div key={field.name}>
                <label className="field-label inline-flex items-center gap-1.5">
                  {field.label}
                  {field.help && <Tooltip text={field.help} />}
                </label>
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
                    <option value="">Select {field.label}...</option>
                    {optionsFor(field.name, field.options)?.map((o) => (
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

          <button className="btn-primary mt-4 w-full" onClick={run} disabled={busy}>
            <Sparkles size={15} />
            {busy ? "Generating…" : "Generate with Claude"}
          </button>
        </div>

        <div className="card p-5">
          <p className="field-label">Output</p>
          {output ? (
            <OutputViewer output={output} title={active.title} />
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-center text-faint">
              <FileText size={28} />
              <p className="text-sm">Fill in the fields and generate your {active.title.toLowerCase()}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
