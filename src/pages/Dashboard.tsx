import { CheckSquare, Calendar, Mail, Workflow } from "lucide-react";
import { KPIS, TASKS, MEETINGS, CLIENTS } from "@/data/seed";
import { Badge, PageHeader } from "@/components/ui";
import { useAuth } from "@/hooks/useAuth";

const KPI_ICONS = [CheckSquare, Calendar, Mail, Workflow];
const KPI_ICON_COLORS = ["text-accent", "text-sky-400", "text-amber-400", "text-emerald-400"];

const priorityLabel: Record<string, string> = { urgent: "Urgent", high: "In Progress", normal: "Pending", low: "Done" };

export default function Dashboard() {
  const { user } = useAuth();
  const queue = TASKS.slice(0, 5);

  return (
    <div>
      <PageHeader
        title={`Good afternoon, ${user?.name?.split(" ")[0] ?? "Sarah"}.`}
        subtitle="Here's your command center."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {KPIS.map((kpi, i) => {
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
            <button className="text-xs text-accent-soft hover:underline">View all</button>
          </div>
          <div className="space-y-2">
            {queue.map((t) => (
              <div key={t.id} className="flex items-center gap-3 rounded-lg bg-surface-2 p-3">
                <CheckSquare size={16} className="text-faint" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{t.title}</p>
                  <p className="truncate text-xs text-faint">
                    {t.client_name} · {t.due_label}
                  </p>
                </div>
                <Badge tone={t.priority}>{priorityLabel[t.priority]}</Badge>
              </div>
            ))}
          </div>
        </section>

        <section className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Upcoming Meetings</h2>
            <button className="text-xs text-accent-soft hover:underline">Calendar</button>
          </div>
          <div className="space-y-2">
            {MEETINGS.map((m) => (
              <div key={m.id} className="flex items-center gap-3 rounded-lg bg-surface-2 p-3">
                <span className="w-16 shrink-0 text-xs font-medium text-muted">{m.time}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{m.title}</p>
                  <p className="truncate text-xs text-faint">{m.with}</p>
                </div>
                <Badge tone={m.status}>
                  {m.status === "needs_prep" ? "Needs Prep" : m.status === "prepared" ? "Prepared" : "Pending"}
                </Badge>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="card mt-5 p-5">
        <h2 className="mb-3 font-semibold">Client Snapshot</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {CLIENTS.map((c) => (
            <div key={c.id} className="rounded-lg bg-surface-2 p-4">
              <p className="text-sm font-medium">{c.name}</p>
              <p className="text-xs text-faint">{c.title}, {c.company}</p>
              <p className="mt-2 text-xs text-muted">{c.active_tasks[0]?.title}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
