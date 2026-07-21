import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles, ArrowRight, CheckCircle2 } from "lucide-react";
import { Badge, PageHeader } from "@/components/ui";
import { OutputViewer } from "@/components/OutputViewer";
import { useClients, useMeetings, useMessages, useTasks } from "@/data/hooks";
import { useMeetingPreps } from "@/store/meetingPreps";
import { generate } from "@/lib/ai";
import {
  DEFAULT_HOMEWORK_CONFIG,
  findHomework,
  homeworkBriefInput,
  HOMEWORK_KIND_LABEL,
  SEVERITY_LABEL,
  SEVERITY_TONE,
  summarise,
  type HomeworkItem,
  type Severity,
} from "@/lib/homework";

const HORIZONS = [3, 7, 14];
const ORDER: Severity[] = ["critical", "soon", "later"];

export default function Homework() {
  const nav = useNavigate();
  const { data: meetings = [] } = useMeetings();
  const { data: tasks = [] } = useTasks();
  const { data: clients = [] } = useClients();
  const { data: messages = [] } = useMessages();
  const preps = useMeetingPreps((s) => s.preps);

  const [horizonDays, setHorizonDays] = useState(DEFAULT_HOMEWORK_CONFIG.horizonDays);
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const items = useMemo(
    () =>
      findHomework(
        { meetings, tasks, clients, messages, preppedMeetingIds: new Set(Object.keys(preps)) },
        { ...DEFAULT_HOMEWORK_CONFIG, horizonDays },
      ),
    [meetings, tasks, clients, messages, preps, horizonDays],
  );

  const counts = useMemo(() => summarise(items), [items]);
  const grouped = useMemo(
    () => ORDER.map((sev) => ({ sev, rows: items.filter((i) => i.severity === sev) })).filter((g) => g.rows.length),
    [items],
  );

  async function writeBrief() {
    setBusy(true);
    setError("");
    setBrief("");
    try {
      const out = await generate({
        tool: "homework",
        format: `Homework brief — next ${horizonDays} days`,
        inputs: { outstanding: homeworkBriefInput(items), horizon: `${horizonDays} days` },
      });
      setBrief(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't generate the brief.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Homework Helper"
        subtitle="What you owe before the deadline arrives — built from your real meetings and tasks."
        action={
          <button className="btn-primary" onClick={writeBrief} disabled={busy || !items.length}>
            <Sparkles size={15} />
            {busy ? "Writing…" : "Brief me"}
          </button>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-border bg-surface-2 p-0.5 text-xs">
          {HORIZONS.map((d) => (
            <button
              key={d}
              onClick={() => setHorizonDays(d)}
              className={`rounded-md px-3 py-1 transition-colors ${
                d === horizonDays ? "bg-accent text-white" : "text-muted hover:text-zinc-100"
              }`}
            >
              Next {d} days
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          {ORDER.map((sev) => (
            <span key={sev} className="text-xs text-faint">
              <Badge tone={SEVERITY_TONE[sev]}>{counts[sev]}</Badge>{" "}
              <span className="align-middle">{SEVERITY_LABEL[sev]}</span>
            </span>
          ))}
        </div>
      </div>

      {error && (
        <div className="card mb-5 border-red-500/40 bg-red-500/5 p-4 text-sm text-red-300">{error}</div>
      )}

      {brief && (
        <section className="card mb-5 p-5">
          <div className="mb-3 flex items-center gap-2">
            <Sparkles size={15} className="text-accent-soft" />
            <h2 className="font-semibold">Where to start</h2>
            <button className="ml-auto text-xs text-faint hover:text-zinc-100" onClick={() => setBrief("")}>
              Dismiss
            </button>
          </div>
          <OutputViewer output={brief} title="Homework brief" />
        </section>
      )}

      {grouped.length === 0 ? (
        <div className="card flex flex-col items-center gap-2 py-14 text-center">
          <CheckCircle2 size={30} className="text-emerald-400" />
          <p className="font-medium">Nothing outstanding in the next {horizonDays} days</p>
          <p className="max-w-md text-sm text-faint">
            Homework is built from meetings with a start time and tasks with a due date. If that looks
            wrong, the underlying rows may be missing those dates.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {grouped.map(({ sev, rows }) => (
            <section key={sev} className="card p-5">
              <div className="mb-3 flex items-center gap-2">
                <h2 className="font-semibold">{SEVERITY_LABEL[sev]}</h2>
                <span className="text-xs text-faint">
                  {rows.length} item{rows.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="space-y-2">
                {rows.map((item) => (
                  <Row key={item.id} item={item} onOpen={() => nav(item.path)} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function Row({ item, onOpen }: { item: HomeworkItem; onOpen: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded-lg bg-surface-2 p-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={SEVERITY_TONE[item.severity]}>{HOMEWORK_KIND_LABEL[item.kind]}</Badge>
          <p className="truncate text-sm font-medium">{item.title}</p>
          <span className="text-xs text-faint">· {item.subtitle}</span>
        </div>
        <p className="mt-1 text-xs text-muted">{item.reason}</p>
        <p className="mt-0.5 text-xs text-faint">→ {item.action}</p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="text-xs font-medium text-muted">{item.dueLabel}</span>
        <button
          className="inline-flex items-center gap-1 text-xs text-accent-soft hover:underline"
          onClick={onOpen}
        >
          Open <ArrowRight size={12} />
        </button>
      </div>
    </div>
  );
}
