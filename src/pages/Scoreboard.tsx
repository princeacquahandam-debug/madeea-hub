import { useMemo, useState } from "react";
import { Sparkles, TrendingUp, TrendingDown, Minus, AlertTriangle } from "lucide-react";
import { Badge, PageHeader } from "@/components/ui";
import { OutputViewer } from "@/components/OutputViewer";
import { useClients, useMeetings, useMessages, useTasks, useWorkspaceMembers } from "@/data/hooks";
import { useSlaSettings } from "@/store/slaSettings";
import { generate } from "@/lib/ai";
import {
  buildScoreboard,
  formatDelta,
  formatMetric,
  isGood,
  scoreboardFacts,
  type Metric,
} from "@/lib/scoreboard";

const PERIODS = [7, 30, 90];

export default function Scoreboard() {
  const { data: tasks = [] } = useTasks();
  const { data: messages = [] } = useMessages();
  const { data: meetings = [] } = useMeetings();
  const { data: clients = [] } = useClients();
  const { data: members = [] } = useWorkspaceMembers();
  const cfg = useSlaSettings((s) => s.config);

  const [periodDays, setPeriodDays] = useState(7);
  const [narrative, setNarrative] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const board = useMemo(
    () =>
      buildScoreboard(
        { tasks, messages, meetings, clients, members: members.map((m) => ({ user_id: m.user_id, name: m.name })) },
        periodDays,
        cfg,
      ),
    [tasks, messages, meetings, clients, members, periodDays, cfg],
  );

  async function writeNarrative() {
    setBusy(true);
    setError("");
    setNarrative("");
    try {
      const out = await generate({
        tool: "scoreboard",
        format: `Performance narrative — last ${periodDays} days`,
        inputs: { facts: scoreboardFacts(board) },
      });
      setNarrative(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't generate the narrative.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Scoreboard Helper"
        subtitle="How the desk actually performed — measured, not estimated."
        action={
          <button className="btn-primary" onClick={writeNarrative} disabled={busy}>
            <Sparkles size={15} />
            {busy ? "Writing…" : "Write the narrative"}
          </button>
        }
      />

      <div className="mb-5 flex rounded-lg border border-border bg-surface-2 p-0.5 text-xs w-fit">
        {PERIODS.map((d) => (
          <button
            key={d}
            onClick={() => setPeriodDays(d)}
            className={`rounded-md px-3 py-1 transition-colors ${
              d === periodDays ? "bg-accent text-white" : "text-muted hover:text-zinc-100"
            }`}
          >
            Last {d} days
          </button>
        ))}
      </div>

      {board.warnings.length > 0 && (
        <div className="card mb-5 border-amber-500/40 bg-amber-500/5 p-4">
          <div className="mb-2 flex items-center gap-2">
            <AlertTriangle size={15} className="text-amber-400" />
            <p className="text-sm font-medium text-amber-200">What these numbers can't see</p>
          </div>
          <ul className="space-y-1 text-xs text-amber-100/80">
            {board.warnings.map((w, i) => (
              <li key={i}>• {w}</li>
            ))}
          </ul>
        </div>
      )}

      {error && <div className="card mb-5 border-red-500/40 bg-red-500/5 p-4 text-sm text-red-300">{error}</div>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {board.metrics.map((m) => (
          <MetricCard key={m.key} metric={m} periodDays={periodDays} />
        ))}
      </div>

      {narrative && (
        <section className="card mt-5 p-5">
          <div className="mb-3 flex items-center gap-2">
            <Sparkles size={15} className="text-accent-soft" />
            <h2 className="font-semibold">Narrative</h2>
            <button className="ml-auto text-xs text-faint hover:text-zinc-100" onClick={() => setNarrative("")}>
              Dismiss
            </button>
          </div>
          <OutputViewer output={narrative} title={`Scoreboard — last ${periodDays} days`} />
        </section>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="mb-3 font-semibold">By EA</h2>
          {board.eas.length ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-faint">
                  <th className="pb-2 font-medium">Name</th>
                  <th className="pb-2 text-right font-medium">Completed</th>
                  <th className="pb-2 text-right font-medium">Open</th>
                  <th className="pb-2 text-right font-medium">Overdue</th>
                </tr>
              </thead>
              <tbody>
                {board.eas.map((e) => (
                  <tr key={e.user_id} className="border-t border-border">
                    <td className="py-2 pr-2 truncate">{e.name}</td>
                    <td className="py-2 text-right tabular-nums">{e.completed}</td>
                    <td className="py-2 text-right tabular-nums">{e.open}</td>
                    <td className={`py-2 text-right tabular-nums ${e.overdue ? "text-red-400" : ""}`}>{e.overdue}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="py-4 text-center text-xs text-faint">No workspace members loaded</p>
          )}
        </section>

        <section className="card p-5">
          <h2 className="mb-3 font-semibold">By client</h2>
          {board.clients.length ? (
            <div className="space-y-2">
              {board.clients.map((c) => (
                <div key={c.id} className="flex items-center gap-3 rounded-lg bg-surface-2 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{c.name}</p>
                    <p className="truncate text-xs text-faint">
                      {c.open} open ·{" "}
                      {c.avgResponseHours === null
                        ? "no measured replies"
                        : `avg reply ${c.avgResponseHours.toFixed(1)}h`}{" "}
                      ·{" "}
                      {c.daysSinceContact === null
                        ? "no contact on record"
                        : `last contact ${c.daysSinceContact}d ago`}
                    </p>
                  </div>
                  {c.unanswered > 0 && <Badge tone="urgent">{c.unanswered} waiting</Badge>}
                </div>
              ))}
            </div>
          ) : (
            <p className="py-4 text-center text-xs text-faint">No clients yet</p>
          )}
        </section>
      </div>
    </div>
  );
}

function MetricCard({ metric, periodDays }: { metric: Metric; periodDays: number }) {
  const good = isGood(metric);
  const delta = formatDelta(metric);
  const Icon = metric.direction === "up" ? TrendingUp : metric.direction === "down" ? TrendingDown : Minus;
  const tone = good === null ? "text-faint" : good ? "text-emerald-400" : "text-red-400";

  return (
    <div className="card p-4">
      <span className="eyebrow">{metric.label}</span>
      <p className="display mt-2 text-3xl">{formatMetric(metric)}</p>
      <div className="mt-1 flex items-center gap-1.5 text-xs">
        {metric.pointInTime ? (
          <span className="text-faint">right now</span>
        ) : delta ? (
          <>
            <Icon size={13} className={tone} />
            <span className={tone}>{delta}</span>
            <span className="text-faint">vs prev {periodDays}d</span>
          </>
        ) : (
          <span className="text-faint">no comparison available</span>
        )}
      </div>
      {metric.caveat && <p className="mt-2 text-[11px] leading-snug text-faint">{metric.caveat}</p>}
    </div>
  );
}
