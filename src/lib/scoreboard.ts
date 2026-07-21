/**
 * Scoreboard Helper — how the desk actually performed over a period.
 *
 * Pure and network-free (see lib/sla.ts, lib/followups.ts for the same shape).
 *
 * Two rules run through this file, and both exist to stop the scoreboard from
 * flattering itself:
 *
 *  1. Missing data is `null`, never 0. A period with no measurable threads has no
 *     average response time — reporting "0h" would read as instant replies, which
 *     is the exact opposite of the truth. Every metric carries `value: number|null`
 *     and the UI renders "—" for null.
 *
 *  2. Period metrics only compare like with like. A point-in-time number (how many
 *     items are open right now) has no honest previous-period counterpart, because
 *     we can't reconstruct what the backlog looked like last Tuesday. Those are
 *     marked `pointInTime` and simply don't show a delta.
 */
import type { Client, Meeting, Message, Task } from "@/types/db";
import type { SlaConfig } from "@/store/slaSettings";
import { messagesForClient, responseHours, thresholdsFor, waitingHours } from "@/lib/sla";

const DAY = 86_400_000;

export type MetricUnit = "count" | "hours";

export interface Metric {
  key: string;
  label: string;
  value: number | null;
  previous: number | null;
  /** Change vs the previous period, as a fraction. Null when either side is null. */
  deltaPct: number | null;
  direction: "up" | "down" | "flat" | "unknown";
  /** Lets the UI colour a rise green or red — fewer breaches is better, not worse. */
  higherIsBetter: boolean;
  unit: MetricUnit;
  /** True when there is no comparable previous value by definition. */
  pointInTime: boolean;
  /** What this number can't see. Rendered under the metric when present. */
  caveat?: string;
}

export interface EaRow {
  user_id: string;
  name: string;
  completed: number;
  open: number;
  overdue: number;
}

export interface ClientRow {
  id: string;
  name: string;
  company: string;
  open: number;
  unanswered: number;
  avgResponseHours: number | null;
  daysSinceContact: number | null;
}

export interface Scoreboard {
  periodDays: number;
  from: Date;
  to: Date;
  metrics: Metric[];
  eas: EaRow[];
  clients: ClientRow[];
  /** Non-fatal data-quality warnings, shown above the numbers. */
  warnings: string[];
}

/** Minimal shape of a workspace member — kept local so this file stays data-layer free. */
export interface ScoreMember {
  user_id: string;
  name: string;
}

export interface ScoreboardSources {
  tasks: Task[];
  messages: Message[];
  meetings: Meeting[];
  clients: Client[];
  members: ScoreMember[];
}

const inRange = (iso: string | null | undefined, from: number, to: number): boolean => {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return !Number.isNaN(t) && t > from && t <= to;
};

const mean = (xs: number[]): number | null =>
  xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;

function metric(
  key: string,
  label: string,
  value: number | null,
  previous: number | null,
  opts: { higherIsBetter: boolean; unit?: MetricUnit; pointInTime?: boolean; caveat?: string },
): Metric {
  const pointInTime = opts.pointInTime ?? false;
  let deltaPct: number | null = null;
  let direction: Metric["direction"] = "unknown";

  if (!pointInTime && value !== null && previous !== null) {
    if (previous === 0) {
      // Growth from zero has no meaningful percentage. Say the direction, not a
      // fake "+∞%".
      direction = value === 0 ? "flat" : "up";
    } else {
      deltaPct = (value - previous) / previous;
      direction = deltaPct > 0.02 ? "up" : deltaPct < -0.02 ? "down" : "flat";
    }
  }

  return {
    key,
    label,
    value,
    previous,
    deltaPct,
    direction,
    higherIsBetter: opts.higherIsBetter,
    unit: opts.unit ?? "count",
    pointInTime,
    caveat: opts.caveat,
  };
}

export function buildScoreboard(
  { tasks, messages, meetings, clients, members }: ScoreboardSources,
  periodDays: number,
  cfg: SlaConfig,
  now = new Date(),
): Scoreboard {
  const to = now.getTime();
  const from = to - periodDays * DAY;
  const prevFrom = from - periodDays * DAY;

  const warnings: string[] = [];

  // ---- completions -----------------------------------------------------------
  // `completed_at` is stamped by a trigger (migration 0014). Rows finished before
  // that migration ran have none, and there is no way to date them after the fact.
  const done = tasks.filter((t) => t.status === "done");
  const stamped = done.filter((t) => t.completed_at);
  if (done.length && !stamped.length) {
    warnings.push(
      "No completed task carries a completion timestamp yet, so “Tasks completed” reads 0. New completions will be counted from now on.",
    );
  }

  const completedNow = stamped.filter((t) => inRange(t.completed_at, from, to)).length;
  const completedPrev = stamped.filter((t) => inRange(t.completed_at, prevFrom, from)).length;

  const createdNow = tasks.filter((t) => inRange(t.created_at, from, to)).length;
  const createdPrev = tasks.filter((t) => inRange(t.created_at, prevFrom, from)).length;

  const openNow = tasks.filter((t) => t.status !== "done").length;
  const overdueNow = tasks.filter(
    (t) => t.status !== "done" && t.due_at && new Date(t.due_at).getTime() < to,
  ).length;

  // ---- response times --------------------------------------------------------
  // Measured on inbound threads by the date they ARRIVED, so a thread belongs to
  // one period only and can't be double-counted when it's finally answered.
  const answeredIn = (a: number, b: number) =>
    messages
      .filter((m) => m.direction !== "outbound" && m.first_reply_at && inRange(m.received_at, a, b))
      .map((m) => responseHours(m, cfg))
      .filter((h): h is number => h !== null);

  const respNow = answeredIn(from, to);
  const respPrev = answeredIn(prevFrom, from);
  const avgNow = mean(respNow);
  const avgPrev = mean(respPrev);

  const breachesIn = (a: number, b: number) =>
    messages.filter((m) => {
      if (m.direction === "outbound" || !m.first_reply_at) return false;
      if (!inRange(m.received_at, a, b)) return false;
      const client = clients.find((c) => c.id === m.client_id || c.name === m.client_name) ?? null;
      const h = responseHours(m, cfg);
      return h !== null && h > thresholdsFor(client, cfg).risk;
    }).length;

  // Point-in-time: mail sitting unanswered past the threshold right now.
  const waitingBreaches = messages.filter((m) => {
    if (m.direction === "outbound" || m.first_reply_at) return false;
    const client = clients.find((c) => c.id === m.client_id || c.name === m.client_name) ?? null;
    const h = waitingHours(m, cfg, now);
    return h !== null && h > thresholdsFor(client, cfg).risk;
  }).length;

  const meetingsNow = meetings.filter((m) => inRange(m.starts_at, from, to)).length;
  const meetingsPrev = meetings.filter((m) => inRange(m.starts_at, prevFrom, from)).length;

  const metrics: Metric[] = [
    metric("completed", "Tasks completed", completedNow, completedPrev, { higherIsBetter: true }),
    metric("created", "Tasks created", createdNow, createdPrev, {
      higherIsBetter: true,
      caveat: "Volume in, not performance — read it next to completions.",
    }),
    metric("open", "Open right now", openNow, null, { higherIsBetter: false, pointInTime: true }),
    metric("overdue", "Overdue right now", overdueNow, null, {
      higherIsBetter: false,
      pointInTime: true,
      caveat: "Only counts tasks that have a real due date.",
    }),
    metric("avg_response", "Avg first reply", avgNow, avgPrev, {
      higherIsBetter: false,
      unit: "hours",
      caveat: cfg.businessHoursOnly ? "Business hours only." : "Calendar hours.",
    }),
    metric("breaches", "SLA breaches", breachesIn(from, to), breachesIn(prevFrom, from), {
      higherIsBetter: false,
      caveat: "Threads answered late. Mail still waiting is counted separately.",
    }),
    metric("waiting_breaches", "Waiting past SLA", waitingBreaches, null, {
      higherIsBetter: false,
      pointInTime: true,
    }),
    metric("meetings", "Meetings held", meetingsNow, meetingsPrev, { higherIsBetter: true }),
  ];

  // ---- per EA ----------------------------------------------------------------
  const eas: EaRow[] = members
    .map((m) => {
      const mine = tasks.filter((t) => t.assignee_id === m.user_id);
      return {
        user_id: m.user_id,
        name: m.name,
        completed: mine.filter((t) => t.completed_at && inRange(t.completed_at, from, to)).length,
        open: mine.filter((t) => t.status !== "done").length,
        overdue: mine.filter(
          (t) => t.status !== "done" && t.due_at && new Date(t.due_at).getTime() < to,
        ).length,
      };
    })
    .sort((a, b) => b.completed - a.completed || b.open - a.open);

  const unassigned = tasks.filter((t) => !t.assignee_id && t.status !== "done").length;
  if (unassigned) {
    warnings.push(
      `${unassigned} open task${unassigned === 1 ? " has" : "s have"} no assignee, so ${unassigned === 1 ? "it does" : "they do"} not appear in the per-EA breakdown.`,
    );
  }

  // ---- per client ------------------------------------------------------------
  const clientRows: ClientRow[] = clients
    .map((c) => {
      const theirs = messagesForClient(c, messages);
      const answered = theirs
        .filter((m) => m.first_reply_at && inRange(m.received_at, from, to))
        .map((m) => responseHours(m, cfg))
        .filter((h): h is number => h !== null);

      let latest: number | null = null;
      for (const m of messages) {
        if (m.client_id !== c.id && m.client_name !== c.name) continue;
        if (!m.received_at) continue;
        const t = new Date(m.received_at).getTime();
        if (!Number.isNaN(t) && (latest === null || t > latest)) latest = t;
      }

      return {
        id: c.id,
        name: c.name,
        company: c.company,
        open: tasks.filter(
          (t) => t.status !== "done" && (t.client_id === c.id || t.client_name === c.name),
        ).length,
        unanswered: theirs.filter((m) => !m.first_reply_at).length,
        avgResponseHours: mean(answered),
        daysSinceContact: latest === null ? null : Math.floor((to - latest) / DAY),
      };
    })
    .sort((a, b) => b.unanswered - a.unanswered || b.open - a.open);

  return {
    periodDays,
    from: new Date(from),
    to: new Date(to),
    metrics,
    eas,
    clients: clientRows,
    warnings,
  };
}

/** "12" / "3.4h" / "—" — one place, so every surface formats a metric the same way. */
export function formatMetric(m: Pick<Metric, "value" | "unit">): string {
  if (m.value === null) return "—";
  if (m.unit === "hours") return `${m.value < 10 ? m.value.toFixed(1) : Math.round(m.value)}h`;
  return String(m.value);
}

/** Did this metric move in the direction we want? Null when we can't say. */
export function isGood(m: Metric): boolean | null {
  if (m.direction === "unknown" || m.direction === "flat") return null;
  return m.direction === "up" ? m.higherIsBetter : !m.higherIsBetter;
}

export function formatDelta(m: Metric): string | null {
  if (m.pointInTime || m.direction === "unknown") return null;
  if (m.deltaPct === null) return m.direction === "flat" ? "no change" : "up from 0";
  const pct = Math.round(Math.abs(m.deltaPct) * 100);
  if (m.direction === "flat") return "no change";
  return `${m.direction === "up" ? "+" : "−"}${pct}%`;
}

/** The whole scoreboard as plain text, for the narrative prompt. Facts only. */
export function scoreboardFacts(s: Scoreboard): string {
  const lines: string[] = [];
  lines.push(`Period: last ${s.periodDays} days (${s.from.toDateString()} → ${s.to.toDateString()})`);
  lines.push("");
  lines.push("Metrics (value | previous period):");
  for (const m of s.metrics) {
    const prev = m.pointInTime ? "point-in-time, no comparison" : m.previous === null ? "no data" : formatMetric({ value: m.previous, unit: m.unit });
    lines.push(`- ${m.label}: ${formatMetric(m)} | ${prev}`);
  }
  if (s.eas.length) {
    lines.push("");
    lines.push("Per EA (completed / open / overdue):");
    for (const e of s.eas) lines.push(`- ${e.name}: ${e.completed} / ${e.open} / ${e.overdue}`);
  }
  if (s.clients.length) {
    lines.push("");
    lines.push("Per client (open items / unanswered mail / avg first reply / days since contact):");
    for (const c of s.clients) {
      lines.push(
        `- ${c.name} (${c.company}): ${c.open} / ${c.unanswered} / ${c.avgResponseHours === null ? "no data" : `${c.avgResponseHours.toFixed(1)}h`} / ${c.daysSinceContact ?? "no contact on record"}`,
      );
    }
  }
  if (s.warnings.length) {
    lines.push("");
    lines.push("Data caveats (state these plainly, do not paper over them):");
    for (const w of s.warnings) lines.push(`- ${w}`);
  }
  return lines.join("\n");
}
