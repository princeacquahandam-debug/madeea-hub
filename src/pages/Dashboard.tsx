import { CheckSquare, Calendar, Mail, Workflow } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Badge, PageHeader } from "@/components/ui";
import { useAuth } from "@/hooks/useAuth";
import { useTasks, useMeetings, useClients, useMessages, useAutomations } from "@/data/hooks";

const KPI_ICONS = [CheckSquare, Calendar, Mail, Workflow];
const KPI_ICON_COLORS = ["text-accent", "text-sky-400", "text-amber-400", "text-emerald-400"];
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

  const kpis = [
    { label: "Tasks Active", value: tasks.filter((t) => t.status !== "done").length },
    { label: "Meetings Today", value: meetings.length },
    { label: "Emails Pending", value: messages.length },
    { label: "Automations Running", value: automations.filter((a) => a.status === "active").length },
  ];

  const order: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
  const queue = [...tasks].sort((a, b) => order[a.priority] - order[b.priority]).slice(0, 5);

  return (
    <div>
      <PageHeader title={`Good afternoon, ${user?.name?.split(" ")[0] ?? "Sarah"}.`} subtitle="Here's your command center." />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((kpi, i) => {
          const Icon = KPI_ICONS[i];
          return (
            <div key={kpi.label} className="card p-4">
              <div className="flex items-center justify-between">
                <span className="eyebrow">{kpi.label}</span>
                <Icon size={16} className={KPI_ICON_COLORS[i]} />
              </div>
              <p className="display mt-2 text-4xl">{kpi.value}</p>
            </div>
          );
        })}
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <section className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Today's Priority Queue</h2>
            <button className="text-xs text-accent-soft hover:underline" onClick={() => nav("/tasks")}>View all</button>
          </div>
          <div className="space-y-2">
            {queue.map((t) => (
              <div key={t.id} className="flex items-center gap-3 rounded-lg bg-surface-2 p-3">
                <CheckSquare size={16} className="text-faint" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{t.title}</p>
                  <p className="truncate text-xs text-faint">{t.client_name} · {t.due_label}</p>
                </div>
                <Badge tone={t.priority}>{priorityLabel[t.priority]}</Badge>
              </div>
            ))}
            {queue.length === 0 && <p className="py-4 text-center text-xs text-faint">No tasks yet</p>}
          </div>
        </section>

        <section className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Upcoming Meetings</h2>
            <button className="text-xs text-accent-soft hover:underline">Calendar</button>
          </div>
          <div className="space-y-2">
            {meetings.map((m) => (
              <div key={m.id} className="flex items-center gap-3 rounded-lg bg-surface-2 p-3">
                <span className="w-16 shrink-0 text-xs font-medium text-muted">{m.time}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{m.title}</p>
                  <p className="truncate text-xs text-faint">{m.with}</p>
                </div>
                <Badge tone={m.status}>{meetingLabel[m.status]}</Badge>
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
            <button key={c.id} className="rounded-lg bg-surface-2 p-4 text-left hover:bg-surface-2/70" onClick={() => nav("/clients")}>
              <p className="text-sm font-medium">{c.name}</p>
              <p className="text-xs text-faint">{c.title}, {c.company}</p>
            </button>
          ))}
          {clients.length === 0 && <p className="py-4 text-center text-xs text-faint">No clients</p>}
        </div>
      </section>
    </div>
  );
}
