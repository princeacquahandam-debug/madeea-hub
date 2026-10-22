import { useEffect, useMemo, useState } from "react";
import { track } from "@/lib/analytics";
import { CheckSquare, Calendar, Mail, Workflow, Sparkles, AlertTriangle, Timer, BellRing } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Badge } from "@/components/ui";
import { Avatar } from "@/components/Avatar";
import { MeetingPrepPacket } from "@/components/MeetingPrepPacket";
import { useMadeline } from "@/store/madeline";
import { meetingItem } from "@/lib/madelineItems";
import { PREP_MEETING } from "@/lib/madelineActions";
import { useAuth } from "@/hooks/useAuth";
import { useTasks, useMeetings, useClients, useMessages, useAutomations, useGoogleConnection, useMyRole, atLeast } from "@/data/hooks";
import { useSlaSettings } from "@/store/slaSettings";
import { emitOnce } from "@/lib/alerts";
import { EodCard } from "@/components/EodCard";
import { clientSla, dayLength, formatDuration, waitingHours, thresholdsFor } from "@/lib/sla";
import { useFollowUps } from "@/hooks/useFollowUps";
import { FollowUpRow } from "@/components/FollowUpRow";
import { AssigneePicker } from "@/components/Assignee";
import type { Meeting } from "@/types/db";
import { useFollowUpSettings } from "@/store/followupSettings";
import { useClientContext } from "@/store/clientContext";
import { isMine } from "@/lib/taskSort";

const KPI_ICON_COLORS = ["text-accent", "text-sky-400", "text-amber-400", "text-red-400", "text-amber-400", "text-emerald-400"];
const priorityLabel: Record<string, string> = { urgent: "Urgent", high: "High", normal: "Normal", low: "Low" };
const meetingLabel: Record<string, string> = { prepared: "Prepared", needs_prep: "Needs Prep", pending: "Pending" };

/** How many rows a dashboard panel shows. It is a glance, and the header of
 *  each panel already carries the way to the full list. */
const PANEL_LIMIT = 4;

export default function Dashboard() {
  const { user } = useAuth();
  const nav = useNavigate();
  /* Client Vault is managers and up (constants.ts NAV, 8 Oct 2026), so an EA
     doesn't get the two Dashboard pieces that only lead there. */
  const { data: role } = useMyRole();
  const canVault = atLeast(role, "manager");
  const { data: tasks = [] } = useTasks();
  const { clientId: scopeId } = useClientContext();
  const { data: meetings = [] } = useMeetings({ mine: true });
  const { data: google } = useGoogleConnection();
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

  /* Today only. It counted every meeting on file, so a synced calendar read
     "Meetings today: 40" and disagreed with Madeline, who counts today. */
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = dayStart.getTime() + 86_400_000;
  const meetingsToday = meetings.filter((m) => {
    const t = m.starts_at ? new Date(m.starts_at).getTime() : NaN;
    return t >= dayStart.getTime() && t < dayEnd;
  }).length;

  /* One strip of plain-word stats (12 Oct 2026, UI review deck slides 2-3). */
  /* YOUR active tasks: the same rule as "My tasks" on the board, and the same
     client scope, so the two numbers agree (Reich's testing, 20 Oct 2026: the
     Dashboard said 7 while her board showed 5, because this counted the whole
     team's unfinished tasks). Deleted tasks are in Recently deleted, not here. */
  const activeCount = tasks.filter((t) => t.status !== "done" && isMine(t, user?.id) && (!scopeId || t.client_id === scopeId)).length;
  const kpis: { label: string; value: number; onClick?: () => void; alert?: boolean }[] = [
    { label: "Your active tasks", value: activeCount, onClick: () => nav("/tasks?who=mine") },
    { label: "Meetings today", value: meetingsToday, onClick: () => nav("/calendar") },
    { label: "Emails to answer", value: messages.filter((m) => m.direction !== "outbound" && !m.first_reply_at).length, onClick: () => nav("/inbox") },
    ...(canVault ? [{ label: "Clients at risk", value: atRisk.length, onClick: () => nav("/clients"), alert: atRisk.length > 0 }] : []),
    { label: "Needs follow-up", value: flags.length, alert: flags.length > 0 },
    { label: "Automations running", value: automations.filter((a) => a.status === "active").length },
  ];
  const followDays = useFollowUpSettings((s) => s.config.taskDays);
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

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

  /* Upcoming means from now on. It listed the first four meetings on file,
     past ones included, under a "+N more today" that wasn't about today. */
  const upcoming = meetings.filter((m) => m.starts_at && new Date(m.starts_at).getTime() >= Date.now() - 30 * 60_000);
  const shownMeetings = upcoming.slice(0, PANEL_LIMIT);
  const meetingsHidden = upcoming.length - shownMeetings.length;

  const firstName = user?.name?.split(" ")[0] ?? "there";
  const hour = new Date().getHours();
  const timeOfDay = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div>
      <div className="mb-7">
        <h1 className="greeting-title">{timeOfDay}, {firstName}.</h1>
        <p className="mt-1 text-sm text-muted">
          You have {plural(activeCount, "active task", "active tasks")} and {plural(flags.length, "item that needs", "items that need")} a follow-up.
        </p>
      </div>

      {/* One strip with dividers, not six floating cards. */}
      <div className={`card grid grid-cols-2 overflow-hidden sm:grid-cols-3 ${kpis.length === 6 ? "xl:grid-cols-6" : "xl:grid-cols-5"}`}>
        {kpis.map((kpi) => {
          const Cell = kpi.onClick ? "button" : "div";
          return (
            <Cell
              key={kpi.label}
              onClick={kpi.onClick ? () => { track("home_card_action_clicked", { card: "stats", action: kpi.label.toLowerCase().replace(/\s+/g, "_") }); kpi.onClick!(); } : undefined}
              className={`-mb-px -mr-px border-b border-r border-border px-4 py-3.5 text-left ${kpi.onClick ? "transition-colors hover:bg-[var(--chip-bg)]" : ""}`}
            >
              <span className="block text-xs text-muted">{kpi.label}</span>
              <span className={`mt-1 block text-[22px] font-semibold leading-tight tabular-nums ${kpi.alert ? "text-accent" : ""}`}>{kpi.value}</span>
            </Cell>
          );
        })}
      </div>

      {flags.length > 0 && (
        <section className="card mt-5 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[15px] font-semibold">Needs follow-up</h2>
            <span className="text-xs text-faint">No update in {followDays}+ days</span>
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
            <h2 className="text-[15px] font-semibold">Priorities</h2>
            <button className="text-xs text-accent-soft hover:underline" onClick={() => nav("/tasks")}>View all</button>
          </div>
          <div className="space-y-2">
            {/* Overdue replies jump the queue, they're the most time-sensitive thing here. */}
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
                <Badge tone="urgent">Reply overdue</Badge>
              </button>
            ))}
            {shownQueue.map((t) => (
              <div key={t.id} className="flex items-center gap-3 rounded-lg bg-surface-2 p-3">
                <CheckSquare size={16} className="text-faint" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{t.title}</p>
                  <p className="truncate text-xs text-faint">{[t.client_name, t.due_label].filter(Boolean).join(" · ")}</p>
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
            <h2 className="text-[15px] font-semibold">Upcoming meetings</h2>
            <a
              href="https://calendar.google.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-accent-soft hover:underline"
            >
              Open calendar ↗
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
                {/* Was an unlabelled ✨ that opened a packet. Now it says what it
                    does, and does it where every other AI request goes. */}
                <button
                  className="flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-semibold text-muted transition-colors hover:border-accent hover:text-accent"
                  onClick={() => { track("home_card_action_clicked", { card: "meetings", action: "prep_with_ai" }); useMadeline.getState().ask(PREP_MEETING.prompt, { item: meetingItem(m), display: "modal", title: PREP_MEETING.title }); }}
                  aria-label={`Ask Madeline to prep you for ${m.title}`}
                >
                  <Sparkles size={13} /> Prep me
                </button>
                <button
                  className="shrink-0 rounded-md px-2 py-1 text-xs text-faint transition-colors hover:bg-[var(--chip-bg)] hover:text-text"
                  onClick={() => { track("home_card_action_clicked", { card: "meetings", action: "open_prep" }); setPrepFor(m); }}
                  aria-label={`Open details for ${m.title}`}
                >
                  Details
                </button>
              </div>
            ))}
            {upcoming.length === 0 && (
              google && !google.connected ? (
                <div className="py-4 text-center">
                  <p className="text-xs text-faint">Connect Google Calendar to see your meetings here.</p>
                  <Link to="/integrations" className="mt-2 inline-flex h-8 items-center rounded-lg border border-border px-3 text-xs font-semibold transition-colors hover:bg-[var(--chip-bg)]">Connect calendar</Link>
                </div>
              ) : <p className="py-4 text-center text-xs text-faint">No upcoming meetings</p>
            )}
            {meetingsHidden > 0 && (
              <p className="py-1.5 text-center text-xs text-faint">
                +{meetingsHidden} more coming up · open the calendar to see them all
              </p>
            )}
          </div>
        </section>
      </div>

      {canVault && <section className="card mt-5 p-5">
        <h2 className="mb-3 text-[15px] font-semibold">Client snapshot</h2>
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
      </section>}

      <MeetingPrepPacket meeting={prepFor} open={Boolean(prepFor)} onClose={() => setPrepFor(null)} />
    </div>
  );
}
