import { useState } from "react";
import { Sparkles, FileText } from "lucide-react";
import type { StudioFormat } from "@/lib/constants";
import { generate } from "@/lib/ai";

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
          <div className="mb-4 flex items-center gap-2">
            <Sparkles size={16} className="text-accent-soft" />
            <h2 className="font-semibold">{active.title}</h2>
            <span className="pill bg-emerald-500/15 text-emerald-400 ml-auto">{badge}</span>
          </div>

          <div className="space-y-3">
            {active.fields.map((field) => (
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
                    <option value="">Select {field.label}...</option>
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

          <button className="btn-primary mt-4 w-full" onClick={run} disabled={busy}>
            <Sparkles size={15} />
            {busy ? "Generating…" : "Generate with Claude"}
          </button>
        </div>

        <div className="card p-5">
          <p className="field-label">Output</p>
          {output ? (
            <pre className="whitespace-pre-wrap text-sm text-zinc-200">{output}</pre>
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
