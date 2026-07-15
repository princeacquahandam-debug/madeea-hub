import { useEffect, useMemo, useState } from "react";
import { CheckSquare, Calendar, Mail, Workflow, Sparkles, AlertTriangle, Timer, BellRing } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Badge, PageHeader } from "@/components/ui";
import { Avatar } from "@/components/Avatar";
import { MeetingPrepPacket } from "@/components/MeetingPrepPacket";
import { useAuth } from "@/hooks/useAuth";
import { useTasks, useMeetings, useClients, useMessages, useAutomations } from "@/data/hooks";
import { useSlaSettings } from "@/store/slaSettings";
import { clientSla, dayLength, formatDuration, waitingHours, thresholdsFor } from "@/lib/sla";
import { useFollowUps } from "@/hooks/useFollowUps";
import { FollowUpRow } from "@/components/FollowUpRow";
import { AssigneePicker } from "@/components/Assignee";
import type { Meeting } from "@/types/db";

const KPI_ICONS = [CheckSquare, Calendar, Mail, Timer, BellRing, Workflow];
const KPI_ICON_COLORS = ["text-accent", "text-sky-400", "text-amber-400", "text-red-400", "text-amber-400", "text-emerald-400"];
const priorityLabel: Record<string, string> = { urgent: "Urgent", high: "In Progress", normal: "Pending", low: "Done" };
const meetingLabel: Record<string, string> = { prepared: "Prepared", needs_prep: "Needs Prep", pending: "Pending" };

export default function Dashboard() {
  const { user } = useAuth();
  const nav = useNavigate();
  const { data: tasks = [] } = useTasks();
  const { data: meetings = [] } = useMeetings();
  const { data: clients = [] } = useClients();
  const { data: messages = [] } = useMessages();
  const { data: automations = [] } = useAutomations();
  const [prepFor, setPrepFor] = useState<Meeting | null>(null);
  // Deep link from the client activity timeline: /?meeting=<id>. Meetings have no
  // page of their own, so the prep packet IS the detail view.
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    const id = params.get("meeting");
    if (!id) return;
    const m = meetings.find((x) => x.id === id);
    if (m) {
      setPrepFor(m);
      setParams({}, { replace: true });
    }
  }, [params, meetings, setParams]);
  const cfg = useSlaSettings((s) => s.config);
  const { flags } = useFollowUps();

  const slas = useMemo(
    () => clients.map((c) => ({ client: c, sla: clientSla(c, messages, cfg) })),
    [clients, messages, cfg],
  );
  const atRisk = slas.filter((s) => s.sla.status === "at_risk" || s.sla.status === "breached");

  // Unanswered mail that has already blown the threshold — the thing you most need
  // to see without navigating anywhere.
  const breachedMail = useMemo(() => {
    const dl = dayLength(cfg);
    return messages
      .filter((m) => m.direction !== "outbound" && !m.first_reply_at && m.received_at)
      .map((m) => {
        const client = clients.find((c) => c.id === m.client_id || c.name === m.client_name) ?? null;
        const hours = waitingHours(m, cfg) ?? 0;
        return { m, client, hours, label: formatDuration(hours, dl) };
      })
      .filter((x) => x.hours > thresholdsFor(x.client, cfg).risk)
      .sort((a, b) => b.hours - a.hours);
  }, [messages, clients, cfg]);

  const kpis = [
    { label: "Tasks Active", value: tasks.filter((t) => t.status !== "done").length },
    { label: "Meetings Today", value: meetings.length },
    { label: "Emails Pending", value: messages.filter((m) => m.direction !== "outbound" && !m.first_reply_at).length },
    { label: "Clients At Risk", value: atRisk.length, onClick: () => nav("/clients") },
    { label: "Needs Follow-up", value: flags.length },
    { label: "Automations Running", value: automations.filter((a) => a.status === "active").length },
  ];

  const order: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
  const queue = [...tasks].sort((a, b) => order[a.priority] - order[b.priority]).slice(0, 5);

  return (
    <div>
      <PageHeader title={`Good afternoon, ${user?.name?.split(" ")[0] ?? "there"}.`} subtitle="Here's your command center." />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {kpis.map((kpi, i) => {
          const Icon = KPI_ICONS[i];
          const alert = (kpi.label === "Clients At Risk" || kpi.label === "Needs Follow-up") && kpi.value > 0;
          return (
            <div
              key={kpi.label}
              className={`card p-4 ${kpi.onClick ? "cursor-pointer hover:border-accent/60" : ""} ${alert ? "border-red-500/40" : ""}`}
              onClick={kpi.onClick}
            >
              <div className="flex items-center justify-between">
                <span className="eyebrow">{kpi.label}</span>
                <Icon size={16} className={KPI_ICON_COLORS[i]} />
              </div>
              <p className={`display mt-2 text-4xl ${alert ? "text-red-400" : ""}`}>{kpi.value}</p>
            </div>
          );
        })}
      </div>

      {flags.length > 0 && (
        <section className="card mt-5 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Needs Follow-up</h2>
            <span className="text-xs text-faint">Nothing has come back on these</span>
          </div>
          <div className="space-y-2">
            {flags.slice(0, 4).map((f) => <FollowUpRow key={f.id} flag={f} />)}
          </div>
        </section>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <section className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Today's Priority Queue</h2>
            <button className="text-xs text-accent-soft hover:underline" onClick={() => nav("/tasks")}>View all</button>
          </div>
          <div className="space-y-2">
            {/* Breached SLAs jump the queue — they're the most time-sensitive thing here. */}
            {breachedMail.map(({ m, client, label }) => (
              <button
                key={m.id}
                className="flex w-full items-center gap-3 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-left transition-colors hover:bg-red-500/15"
                onClick={() => nav("/communication")}
              >
                <AlertTriangle size={16} className="shrink-0 text-red-400" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{m.subject}</p>
                  <p className="truncate text-xs text-red-300/80">
                    {client?.name ?? m.sender_name} · waiting {label}
                  </p>
                </div>
                <Badge tone="urgent">SLA Breached</Badge>
              </button>
            ))}
            {queue.map((t) => (
              <div key={t.id} className="flex items-center gap-3 rounded-lg bg-surface-2 p-3">
                <CheckSquare size={16} className="text-faint" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{t.title}</p>
                  <p className="truncate text-xs text-faint">{t.client_name} · {t.due_label}</p>
                </div>
                {/* Who's carrying this — reassignable without leaving the dashboard. */}
                <AssigneePicker task={t} />
                <Badge tone={t.priority}>{priorityLabel[t.priority]}</Badge>
              </div>
            ))}
            {queue.length === 0 && breachedMail.length === 0 && (
              <p className="py-4 text-center text-xs text-faint">No tasks yet</p>
            )}
          </div>
        </section>

        <section className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Upcoming Meetings</h2>
            <a
              href="https://calendar.google.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-accent-soft hover:underline"
            >
              Open Calendar ↗
            </a>
          </div>
          <div className="space-y-2">
            {meetings.map((m) => (
              <div key={m.id} className="group flex items-center gap-3 rounded-lg bg-surface-2 p-3">
                <span className="w-16 shrink-0 text-xs font-medium text-muted">{m.time}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{m.title}</p>
                  <p className="truncate text-xs text-faint">{m.with}</p>
                </div>
                <Badge tone={m.status}>{meetingLabel[m.status]}</Badge>
                <button
                  className="shrink-0 rounded-md p-1.5 text-faint transition-colors hover:bg-accent/10 hover:text-accent"
                  onClick={() => setPrepFor(m)}
                  title="Prep packet"
                  aria-label={`Open prep packet for ${m.title}`}
                >
                  <Sparkles size={15} />
                </button>
              </div>
            ))}
            {meetings.length === 0 && <p className="py-4 text-center text-xs text-faint">No meetings</p>}
          </div>
        </section>
      </div>

      <section className="card mt-5 p-5">
        <h2 className="mb-3 font-semibold">Client Snapshot</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {clients.map((c) => (
            <button key={c.id} className="flex items-center gap-3 rounded-lg bg-surface-2 p-4 text-left hover:bg-surface-2/70" onClick={() => nav("/clients")}>
              <Avatar name={c.name} url={c.avatar_url} className="h-9 w-9 shrink-0 text-xs" />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{c.name}</p>
                <p className="truncate text-xs text-faint">{c.title}, {c.company}</p>
              </div>
            </button>
          ))}
          {clients.length === 0 && <p className="py-4 text-center text-xs text-faint">No clients</p>}
        </div>
      </section>

      <MeetingPrepPacket meeting={prepFor} open={Boolean(prepFor)} onClose={() => setPrepFor(null)} />
    </div>
  );
}
