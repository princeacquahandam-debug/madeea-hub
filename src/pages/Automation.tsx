import { useState } from "react";
import { Play, Clock, Workflow, Save } from "lucide-react";
import { AUTOMATIONS } from "@/data/seed";
import { AUTOMATION_TRIGGERS as T, AUTOMATION_ACTIONS as A } from "@/lib/constants";
import type { Automation } from "@/types/db";
import { Badge, PageHeader } from "@/components/ui";

export default function AutomationPage() {
  const [autos, setAutos] = useState<Automation[]>(AUTOMATIONS);
  const [trigger, setTrigger] = useState(T[0]);
  const [action, setAction] = useState(A[0]);
  const [name, setName] = useState("");

  function toggle(id: string) {
    setAutos((as) =>
      as.map((a) => (a.id === id ? { ...a, status: a.status === "active" ? "paused" : "active" } : a)),
    );
  }

  function runNow(id: string) {
    setAutos((as) => as.map((a) => (a.id === id ? { ...a, last_run: "Just now", total_runs: a.total_runs + 1 } : a)));
  }

  function save() {
    if (!name.trim()) return;
    setAutos((as) => [
      ...as,
      { id: `a${Date.now()}`, name, description: `${trigger} → ${action}`, status: "active", last_run: "Never", total_runs: 0, is_custom: true, trigger, action },
    ]);
    setName("");
  }

  return (
    <div>
      <PageHeader title="Automation Dashboard" subtitle="MadeEA's core automation suite — built for elite executive operations" />

      <h2 className="mb-3 font-semibold">MadeEA Core Automations</h2>
      <div className="space-y-3">
        {autos.map((a) => (
          <div key={a.id} className="card p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex gap-3">
                <Workflow size={18} className="mt-0.5 shrink-0 text-accent-soft" />
                <div>
                  <h3 className="font-semibold">{a.name}</h3>
                  <p className="mt-1 text-sm text-muted">{a.description}</p>
                </div>
              </div>
              <button
                role="switch"
                aria-checked={a.status === "active"}
                onClick={() => toggle(a.id)}
                className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${a.status === "active" ? "bg-accent" : "bg-surface-2"}`}
              >
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${a.status === "active" ? "translate-x-5" : "translate-x-0.5"}`} />
              </button>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-faint">
              <Badge tone={a.status}>{a.status === "active" ? "Active" : "Paused"}</Badge>
              <span className="flex items-center gap-1"><Clock size={12} /> Last run: {a.last_run}</span>
              <span>{a.total_runs} total runs</span>
              <button className="btn-ghost ml-auto border border-border py-1.5" onClick={() => runNow(a.id)}>
                <Play size={13} /> Run Now
              </button>
            </div>
          </div>
        ))}
      </div>

      <h2 className="mb-3 mt-8 font-semibold">Custom Automation Builder</h2>
      <div className="card p-5">
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <label className="field-label">Trigger</label>
            <select className="input" value={trigger} onChange={(e) => setTrigger(e.target.value)}>
              {T.map((t) => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="field-label">Action</label>
            <select className="input" value={action} onChange={(e) => setAction(e.target.value)}>
              {A.map((a) => <option key={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <label className="field-label">Automation Name</label>
            <input className="input" placeholder="e.g. Daily Briefing Digest" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        </div>
        <button className="btn-primary mt-4" onClick={save} disabled={!name.trim()}>
          <Save size={15} /> Save Automation
        </button>
      </div>
    </div>
  );
}
