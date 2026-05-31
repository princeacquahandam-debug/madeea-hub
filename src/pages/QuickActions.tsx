import { useState } from "react";
import { Sparkles, PenLine, Calendar, Search, BarChart3, Workflow } from "lucide-react";
import { QUICK_ACTION_GROUPS } from "@/lib/constants";
import { PageHeader, Modal } from "@/components/ui";
import { generate } from "@/lib/ai";
import { OutputViewer } from "@/components/OutputViewer";

const GROUP_ICONS = [PenLine, Calendar, Search, BarChart3, Workflow];

export default function QuickActions() {
  const [active, setActive] = useState<string | null>(null);
  const [output, setOutput] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(action: string) {
    setActive(action);
    setOutput("");
    setBusy(true);
    try {
      const out = await generate({ tool: "quick_action", format: action, inputs: {} });
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
                    onClick={() => run(a)}
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

      <Modal open={active !== null} onClose={() => setActive(null)}>
        <div className="flex items-center gap-2 mb-3">
          <Sparkles size={16} className="text-accent-soft" />
          <h2 className="font-semibold">{active}</h2>
        </div>
        {busy ? (
          <p className="py-8 text-center text-sm text-faint">Generating with Claude…</p>
        ) : output ? (
          <OutputViewer output={output} title={active ?? "AI Output"} />
        ) : null}
      </Modal>
    </div>
  );
}
