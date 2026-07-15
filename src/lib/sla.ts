/**
 * Client SLA / response-time maths. Pure and network-free, so it can be tested
 * directly and reused from the Dashboard, the Vault and the inbox alike.
 *
 * Definitions that matter:
 *  - Response time is TIME TO FIRST REPLY: `first_reply_at - received_at` on a
 *    thread. Later back-and-forth on the same thread is ignored.
 *  - An unanswered email has NO response time. It is not a zero and it is not an
 *    average of zero — it's an open clock, reported separately as "oldest waiting".
 *  - Elapsed time is measured on the *business* clock by default, so an email
 *    arriving 6pm Friday and answered 9am Monday costs ~1 hour, not 63.
 */
import type { Client, Message } from "@/types/db";
import type { SlaConfig } from "@/store/slaSettings";

export type SlaStatus = "on_track" | "at_risk" | "breached" | "no_data";
export type SlaTrend = "improving" | "worsening" | "flat" | "unknown";

const HOUR = 3_600_000;
const PERIOD_DAYS = 30;
const DAY = 86_400_000;

/**
 * Hours between two instants, counting only the configured working window.
 * Walks day by day and sums the overlap of each working day with [from, to].
 */
export function elapsedHours(from: Date, to: Date, cfg: SlaConfig): number {
  const ms = to.getTime() - from.getTime();
  if (ms <= 0) return 0;
  if (!cfg.businessHoursOnly) return ms / HOUR;
  // A window that can never be open would make every gap zero and every client
  // look perfect — treat it as misconfiguration and fall back to calendar time.
  if (!cfg.days.length || cfg.endHour <= cfg.startHour) return ms / HOUR;

  let total = 0;
  const cursor = new Date(from);
  cursor.setHours(0, 0, 0, 0);

  while (cursor.getTime() <= to.getTime()) {
    if (cfg.days.includes(cursor.getDay())) {
      const open = new Date(cursor);
      open.setHours(cfg.startHour, 0, 0, 0);
      const close = new Date(cursor);
      close.setHours(cfg.endHour, 0, 0, 0);

      // Overlap of the working window with the measured interval.
      const start = Math.max(open.getTime(), from.getTime());
      const end = Math.min(close.getTime(), to.getTime());
      if (end > start) total += (end - start) / HOUR;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return total;
}

/**
 * Inverse of `elapsedHours`: advance a timestamp by N working hours, skipping
 * closed hours and non-working days.
 */
export function addBusinessHours(from: Date, hours: number, cfg: SlaConfig): Date {
  if (!cfg.businessHoursOnly || !cfg.days.length || cfg.endHour <= cfg.startHour) {
    return new Date(from.getTime() + hours * HOUR);
  }
  let remaining = hours;
  const cur = new Date(from);
  let guard = 0;
  while (remaining > 1e-9 && guard++ < 3650) {
    if (cfg.days.includes(cur.getDay())) {
      const open = new Date(cur);
      open.setHours(cfg.startHour, 0, 0, 0);
      const close = new Date(cur);
      close.setHours(cfg.endHour, 0, 0, 0);
      const start = cur.getTime() < open.getTime() ? open : cur;
      if (start.getTime() < close.getTime()) {
        const available = (close.getTime() - start.getTime()) / HOUR;
        if (available >= remaining) return new Date(start.getTime() + remaining * HOUR);
        remaining -= available;
      }
    }
    cur.setDate(cur.getDate() + 1);
    cur.setHours(cfg.startHour, 0, 0, 0);
  }
  return cur;
}

/** Hours to OUR first reply, or null while the thread is still unanswered. */
export function responseHours(m: Message, cfg: SlaConfig): number | null {
  if (m.direction === "outbound") return null;
  if (!m.received_at || !m.first_reply_at) return null;
  return elapsedHours(new Date(m.received_at), new Date(m.first_reply_at), cfg);
}

/** How long an unanswered INBOUND email has been waiting, on the same clock. */
export function waitingHours(m: Message, cfg: SlaConfig, now = new Date()): number | null {
  if (m.direction === "outbound") return null; // we sent it; we aren't the ones replying
  if (!m.received_at || m.first_reply_at) return null;
  return elapsedHours(new Date(m.received_at), now, cfg);
}

export function thresholdsFor(client: Client | null, cfg: SlaConfig) {
  return {
    ok: client?.sla_ok_hours ?? cfg.okHours,
    risk: client?.sla_risk_hours ?? cfg.riskHours,
  };
}

export function statusFor(hours: number, t: { ok: number; risk: number }): Exclude<SlaStatus, "no_data"> {
  if (hours <= t.ok) return "on_track";
  if (hours <= t.risk) return "at_risk";
  return "breached";
}

const RANK: Record<SlaStatus, number> = { no_data: -1, on_track: 0, at_risk: 1, breached: 2 };
const worse = (a: SlaStatus, b: SlaStatus) => (RANK[b] > RANK[a] ? b : a);

/**
 * Only INBOUND mail belonging to this client.
 *
 * The direction filter is load-bearing: once outbound mail exists in the table, a
 * message we SENT has no `first_reply_at` either — and without this it would be
 * counted as a client waiting on us, inflating "oldest waiting" and dragging
 * clients into At Risk for emails they owe US a reply to. Mail we sent that went
 * unanswered is a dead thread (lib/followups.ts), not an SLA breach.
 */
export function messagesForClient(client: Client, messages: Message[]): Message[] {
  return messages.filter(
    (m) => m.direction !== "outbound" && (m.client_id === client.id || m.client_name === client.name),
  );
}

export interface ThreadResponse {
  id: string;
  subject: string;
  received_at: string;
  hours: number;
  status: Exclude<SlaStatus, "no_data">;
}

export interface ClientSla {
  status: SlaStatus;
  /** Mean time-to-first-reply over the last 30 days, in hours. */
  avgHours: number | null;
  /** Longest currently-unanswered email, in hours on the configured clock (drives status). */
  oldestWaitingHours: number | null;
  /** The same wait in plain calendar hours — what the client actually experiences. */
  oldestWaitingCalendarHours: number | null;
  oldestWaitingSubject: string | null;
  breaches7d: number;
  breaches30d: number;
  trend: SlaTrend;
  /** Most recent answered threads, newest first — powers the trend view. */
  recent: ThreadResponse[];
  thresholds: { ok: number; risk: number };
}

export function clientSla(
  client: Client,
  messages: Message[],
  cfg: SlaConfig,
  now = new Date(),
): ClientSla {
  const thresholds = thresholdsFor(client, cfg);
  const mine = messagesForClient(client, messages).filter((m) => m.received_at);

  const answered = mine
    .filter((m) => m.first_reply_at)
    .map((m) => ({
      m,
      hours: responseHours(m, cfg)!,
      received: new Date(m.received_at!).getTime(),
    }))
    .sort((a, b) => b.received - a.received);

  const within = (from: number, to: number) =>
    answered.filter((a) => a.received > now.getTime() - from && a.received <= now.getTime() - to);

  const current = within(PERIOD_DAYS * DAY, 0);
  const previous = within(2 * PERIOD_DAYS * DAY, PERIOD_DAYS * DAY);
  const mean = (xs: { hours: number }[]) =>
    xs.length ? xs.reduce((s, x) => s + x.hours, 0) / xs.length : null;

  const avgHours = mean(current);
  const prevAvg = mean(previous);

  // Needs both periods to say anything honest about direction.
  let trend: SlaTrend = "unknown";
  if (avgHours !== null && prevAvg !== null && prevAvg > 0) {
    const delta = (avgHours - prevAvg) / prevAvg;
    trend = delta < -0.05 ? "improving" : delta > 0.05 ? "worsening" : "flat";
  }

  const waiting = mine
    .filter((m) => !m.first_reply_at)
    .map((m) => ({ m, hours: waitingHours(m, cfg, now)! }))
    .sort((a, b) => b.hours - a.hours);
  const oldest = waiting[0] ?? null;

  const breachedIn = (days: number) =>
    answered.filter(
      (a) => a.received > now.getTime() - days * DAY && a.hours > thresholds.risk,
    ).length;
  // An email still sitting unanswered past the threshold is a live breach — it
  // would be dishonest to only count breaches once they're finally replied to.
  const waitingBreaches = waiting.filter((w) => w.hours > thresholds.risk).length;

  // Overall flag is the worst of "how we've been answering" and "what's open now".
  let status: SlaStatus = "no_data";
  if (avgHours !== null) status = statusFor(avgHours, thresholds);
  if (oldest) status = worse(status, statusFor(oldest.hours, thresholds));

  return {
    status,
    avgHours,
    oldestWaitingHours: oldest?.hours ?? null,
    oldestWaitingCalendarHours: oldest
      ? (now.getTime() - new Date(oldest.m.received_at!).getTime()) / HOUR
      : null,
    oldestWaitingSubject: oldest?.m.subject ?? null,
    breaches7d: breachedIn(7) + waitingBreaches,
    breaches30d: breachedIn(30) + waitingBreaches,
    trend,
    recent: answered.slice(0, 8).map((a) => ({
      id: a.m.id,
      subject: a.m.subject,
      received_at: a.m.received_at!,
      hours: a.hours,
      status: statusFor(a.hours, thresholds),
    })),
    thresholds,
  };
}

/** Any message currently past the breach threshold — drives inbox/queue badges. */
export function isBreaching(m: Message, client: Client | null, cfg: SlaConfig, now = new Date()): boolean {
  const t = thresholdsFor(client, cfg);
  const answeredIn = responseHours(m, cfg);
  if (answeredIn !== null) return answeredIn > t.risk;
  const waiting = waitingHours(m, cfg, now);
  return waiting !== null && waiting > t.risk;
}

/**
 * Length of one "day" for display. On a business clock a day is the working
 * window, not 24h — otherwise 29 business hours renders as "1d 5h", which reads
 * like 29 calendar hours and overstates how long the client actually waited.
 */
export function dayLength(cfg: SlaConfig): number {
  return cfg.businessHoursOnly ? Math.max(1, cfg.endHour - cfg.startHour) : 24;
}

/** "2d 4h" / "3h" / "40m". `hoursPerDay` is 24 on a calendar clock. */
export function formatDuration(hours: number, hoursPerDay = 24): string {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  const d = Math.floor(hours / hoursPerDay);
  const h = Math.round(hours % hoursPerDay);
  if (d && h) return `${d}d ${h}h`;
  if (d) return `${d}d`;
  return `${Math.round(hours)}h`;
}

export const STATUS_LABEL: Record<SlaStatus, string> = {
  on_track: "On Track",
  at_risk: "At Risk",
  breached: "Breached",
  no_data: "No data",
};

/** Maps onto the existing Badge tones: emerald / amber / red / grey. */
export const STATUS_TONE: Record<SlaStatus, string> = {
  on_track: "done",
  at_risk: "high",
  breached: "urgent",
  no_data: "normal",
};
