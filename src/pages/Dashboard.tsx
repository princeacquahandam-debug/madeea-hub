import { useEffect, useMemo, useState } from "react";
import { CheckSquare, Calendar, Mail, Workflow, Sparkles, AlertTriangle, Timer, BellRing } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Badge } from "@/components/ui";
import { Avatar } from "@/components/Avatar";
import { MeetingPrepPacket } from "@/components/MeetingPrepPacket";
import { useAuth } from "@/hooks/useAuth";
import { useTasks, useMeetings, useClients, useMessages, useAutomations } from "@/data/hooks";
import { useSlaSettings } from "@/store/slaSettings";
import { emitOnce } from "@/lib/alerts";
import { EodCard } from "@/components/EodCard";
import { clientSla, dayLength, formatDuration, waitingHours, thresholdsFor } from "@/lib/sla";
import { useFollowUps } from "@/hooks/useFollowUps";
import { FollowUpRow } from "@/components/FollowUpRow";
import { AssigneePicker } from "@/components/Assignee";
import type { Meeting } from "@/types/db";

const KPI_ICONS = [CheckSquare, Calendar, Mail, Timer, BellRing, Workflow];
const KPI_ICON_COLORS = ["text-accent", "text-sky-400", "text-amber-400", "text-red-400", "text-amber-400", "text-emerald-400"];
const priorityLabel: Record<string, string> = { urgent: "Urgent", high: "In Progress", normal: "Pending", low: "Done" };
const meetingLabel: Record<string, string> = { prepared: "Prepared", needs_prep: "Needs Prep", pending: "Pending" };

/** How many rows a dashboard panel shows. It is a glance, and the header of
 *  each panel already carries the way to the full list. */
const PANEL_LIMIT = 4;

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

  // Unanswered mail that has already blown the threshold, the thing you most need
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

  /* The one place a Hub tab reaches outside itself today.
     Every unanswered email past its threshold is announced once, ever. The
     trigger is a render because there is no job runner in this stack, which is
     fine here: an EA opens the dashboard every working morning, so "when
     somebody looks" and "daily" are the same event. Five people opening it at
     9am still produce one alert, because the dedupe is a unique index on the
     server and not a flag in this browser. */
  useEffect(() => {
    for (const b of breachedMail) {
      emitOnce("sla_breach", b.m.id, {
        client: b.client?.name ?? b.m.client_name ?? null,
        subject: b.m.subject,
        sender: b.m.sender_name,
        waiting_hours: Math.round(b.hours * 10) / 10,
        waiting_label: b.label,
        threshold_hours: thresholdsFor(b.client, cfg).risk,
      });
    }
  }, [breachedMail, cfg]);

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

  /* Both panels are a preview with a way out of them: "View all" and "Open
     Calendar" were already in their headers, and neither list was honouring
     them. The queue ran to every breached message the mailbox had (eleven,
     each one an identical SLA-breached Gmail onboarding notice) and the
     meetings list to every event of the day, so the dashboard was two long
     scrolling columns rather than the glance it is for.

     The queue counts BOTH kinds together, because four items is four items:
     breached mail first, since that is the most time-sensitive thing on the
     page, then the task queue with whatever room is left. */
  const shownBreached = breachedMail.slice(0, PANEL_LIMIT);
  const shownQueue = queue.slice(0, Math.max(0, PANEL_LIMIT - shownBreached.length));
  const queueHidden = breachedMail.length + queue.length - shownBreached.length - shownQueue.length;

  const shownMeetings = meetings.slice(0, PANEL_LIMIT);
  const meetingsHidden = meetings.length - shownMeetings.length;

  const firstName = user?.name?.split(" ")[0] ?? "there";
  const hour = new Date().getHours();
  const timeOfDay = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div>
      <div className="mb-7">
        <h1 className="greeting-title">{timeOfDay}, {firstName}.</h1>
        <p className="mt-1.5 text-[15px] text-muted">Here's your command center.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        {kpis.map((kpi, i) => {
          const Icon = KPI_ICONS[i];
          const alert = (kpi.label === "Clients At Risk" || kpi.label === "Needs Follow-up") && kpi.value > 0;
          return (
            <div
              key={kpi.label}
              className={`card p-5 transition-transform hover:-translate-y-0.5 ${kpi.onClick ? "cursor-pointer hover:border-accent/60" : ""} ${alert ? "border-red-500/40" : ""}`}
              onClick={kpi.onClick}
            >
              <div className="mb-3 flex items-center justify-between">
                <span className="text-[11.5px] font-bold uppercase tracking-[0.09em] text-faint">{kpi.label}</span>
                <Icon size={18} className={alert ? "text-red-400" : "text-accent"} />
              </div>
              <p className={`text-[34px] font-extrabold leading-none tracking-[-0.02em] ${alert ? "text-red-400" : ""}`}>{kpi.value}</p>
            </div>
          );
        })}
      </div>

      {flags.length > 0 && (
        <section className="card mt-5 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[17px] font-bold">Needs Follow-up</h2>
            <span className="text-xs text-faint">Nothing has come back on these</span>
          </div>
          <div className="space-y-2">
            {flags.slice(0, 4).map((f) => <FollowUpRow key={f.id} flag={f} />)}
          </div>
        </section>
      )}

      {/* EOD -> Dashboard -> Task Manager. The report is built from the board,
          so this shows what it would say right now and links to both ends. */}
      <div className="mt-5">
        <EodCard />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <section className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[17px] font-bold">Today's Priority Queue</h2>
            <button className="text-xs text-accent-soft hover:underline" onClick={() => nav("/tasks")}>View all</button>
          </div>
          <div className="space-y-2">
            {/* Breached SLAs jump the queue, they're the most time-sensitive thing here. */}
            {shownBreached.map(({ m, client, label }) => (
              <button
                key={m.id}
                className="flex w-full items-center gap-3 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-left transition-colors hover:bg-red-500/15"
                onClick={() => nav("/inbox")}
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
            {shownQueue.map((t) => (
              <div key={t.id} className="flex items-center gap-3 rounded-lg bg-surface-2 p-3">
                <CheckSquare size={16} className="text-faint" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{t.title}</p>
                  <p className="truncate text-xs text-faint">{t.client_name} · {t.due_label}</p>
                </div>
                {/* Who's carrying this. Reassignable without leaving the dashboard. */}
                <AssigneePicker task={t} />
                <Badge tone={t.priority}>{priorityLabel[t.priority]}</Badge>
              </div>
            ))}
            {queue.length === 0 && breachedMail.length === 0 && (
              <p className="py-4 text-center text-xs text-faint">No tasks yet</p>
            )}
            {/* Says the list is cut, and goes where the rest is. Without this
                the panel silently claims to be the whole queue, which is worse
                than a long list: four items that look like everything is a
                wrong answer, not a short one. */}
            {queueHidden > 0 && (
              <button
                className="w-full rounded-lg py-1.5 text-xs text-faint transition-colors hover:bg-surface-2 hover:text-accent-soft"
                onClick={() => nav("/tasks")}
              >
                +{queueHidden} more · View all
              </button>
            )}
          </div>
        </section>

        <section className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[17px] font-bold">Upcoming Meetings</h2>
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
            {shownMeetings.map((m) => (
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
            {meetingsHidden > 0 && (
              <p className="py-1.5 text-center text-xs text-faint">
                +{meetingsHidden} more today · open the calendar to see them all
              </p>
            )}
          </div>
        </section>
      </div>

      <section className="card mt-5 p-5">
        <h2 className="mb-3 text-[17px] font-bold">Client Snapshot</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {clients.map((c) => (
            <button key={c.id} className="flex min-w-0 items-center gap-3 rounded-lg bg-surface-2 p-4 text-left hover:bg-surface-2/70" onClick={() => nav("/clients")}>
              <Avatar name={c.name} url={c.avatar_url} className="h-9 w-9 shrink-0 text-xs" />
              <div className="min-w-0 flex-1">
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
