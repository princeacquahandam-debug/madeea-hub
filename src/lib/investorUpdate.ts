/**
 * Investor-Update Helper — assembles the period's real activity into the skeleton
 * of an update, then hands that skeleton to the writing engine.
 *
 * The point of this file is the separation it enforces. Everything the model is
 * allowed to state as fact is computed HERE, from rows in the database, and shown
 * to the EA before a single token is generated. The model's job is prose, not
 * arithmetic — it is explicitly told to reuse the supplied figures verbatim and to
 * mark anything else [TBC].
 *
 * That matters more for this document than any other in the app. An investor
 * update is read by people making money decisions on it; a hallucinated metric
 * here is not a typo, it's a misrepresentation. So: no number reaches the prompt
 * that wasn't either computed from data or typed in by the EA.
 */
import type { Client, Meeting, Message, Task } from "@/types/db";
import type { SlaConfig } from "@/store/slaSettings";
import {
  buildScoreboard,
  formatMetric,
  type Metric,
  type ScoreMember,
  type Scoreboard,
} from "@/lib/scoreboard";

const DAY = 86_400_000;

/** Free-text the EA supplies. Nothing here is derivable from the app's data. */
export interface UpdateInputs {
  company: string;
  recipients: string;
  periodLabel: string;
  /** Headline business figures — ARR, runway, headcount. The EA's numbers, not ours. */
  headlineMetrics: string;
  asks: string;
  lowlights: string;
  tone: string;
}

export const EMPTY_UPDATE_INPUTS: UpdateInputs = {
  company: "",
  recipients: "",
  periodLabel: "",
  headlineMetrics: "",
  asks: "",
  lowlights: "",
  tone: "Direct",
};

export interface UpdateFacts {
  periodDays: number;
  from: Date;
  to: Date;
  /** The subset of scoreboard metrics worth putting in front of investors. */
  metrics: Metric[];
  /** Work actually finished in the window, highest priority first. */
  highlights: { title: string; client: string; when: string }[];
  meetingsHeld: { title: string; with: string; when: string }[];
  clientActivity: { name: string; company: string; open: number; unanswered: number }[];
  /** Things an honest update has to mention. */
  risks: string[];
  /** Data-quality notes carried up from the scoreboard. */
  warnings: string[];
  scoreboard: Scoreboard;
}

export interface UpdateSources {
  tasks: Task[];
  messages: Message[];
  meetings: Meeting[];
  clients: Client[];
  members: ScoreMember[];
}

const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/** Metrics an investor cares about. Internal hygiene numbers stay on the Scoreboard. */
const INVESTOR_METRIC_KEYS = ["completed", "meetings", "avg_response", "overdue"];

export function assembleUpdate(
  sources: UpdateSources,
  periodDays: number,
  cfg: SlaConfig,
  now = new Date(),
): UpdateFacts {
  const scoreboard = buildScoreboard(sources, periodDays, cfg, now);
  const to = now.getTime();
  const from = to - periodDays * DAY;

  const inWindow = (iso: string | null | undefined) => {
    if (!iso) return false;
    const t = new Date(iso).getTime();
    return !Number.isNaN(t) && t > from && t <= to;
  };

  const highlights = sources.tasks
    .filter((t) => t.status === "done" && inWindow(t.completed_at))
    .sort(
      (a, b) =>
        (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9) ||
        new Date(b.completed_at!).getTime() - new Date(a.completed_at!).getTime(),
    )
    .slice(0, 12)
    .map((t) => ({
      title: t.title,
      client: !t.client_name || t.client_name === "Unassigned" ? "Internal" : t.client_name,
      when: shortDate(t.completed_at!),
    }));

  const meetingsHeld = sources.meetings
    .filter((m) => inWindow(m.starts_at))
    .sort((a, b) => new Date(b.starts_at!).getTime() - new Date(a.starts_at!).getTime())
    .slice(0, 12)
    .map((m) => ({ title: m.title, with: m.with || "Internal", when: shortDate(m.starts_at!) }));

  const clientActivity = scoreboard.clients
    .map((c) => ({ name: c.name, company: c.company, open: c.open, unanswered: c.unanswered }))
    .slice(0, 10);

  // Risks are pulled, not written. An update that only lists wins is the one
  // nobody trusts the second time.
  const risks: string[] = [];
  const overdue = sources.tasks.filter(
    (t) => t.status !== "done" && t.due_at && new Date(t.due_at).getTime() < to,
  );
  if (overdue.length) {
    risks.push(
      `${overdue.length} task${overdue.length === 1 ? "" : "s"} past due, oldest: "${
        [...overdue].sort(
          (a, b) => new Date(a.due_at!).getTime() - new Date(b.due_at!).getTime(),
        )[0].title
      }"`,
    );
  }
  const blocked = sources.tasks.filter((t) => {
    if (t.status === "done" || !t.depends_on) return false;
    const dep = sources.tasks.find((x) => x.id === t.depends_on);
    return dep && dep.status !== "done";
  });
  if (blocked.length) {
    risks.push(`${blocked.length} task${blocked.length === 1 ? " is" : "s are"} blocked on an unfinished dependency`);
  }
  const waiting = scoreboard.metrics.find((m) => m.key === "waiting_breaches")?.value ?? 0;
  if (waiting) {
    risks.push(`${waiting} client email${waiting === 1 ? "" : "s"} currently past the agreed response time`);
  }
  const silent = scoreboard.clients.filter((c) => c.daysSinceContact !== null && c.daysSinceContact > 30);
  if (silent.length) {
    risks.push(`No contact in over 30 days with: ${silent.map((c) => c.name).join(", ")}`);
  }

  return {
    periodDays,
    from: new Date(from),
    to: new Date(to),
    metrics: scoreboard.metrics.filter((m) => INVESTOR_METRIC_KEYS.includes(m.key)),
    highlights,
    meetingsHeld,
    clientActivity,
    risks,
    warnings: scoreboard.warnings,
    scoreboard,
  };
}

/** True when there's so little in the window that generating would be theatre. */
export function isThinUpdate(f: UpdateFacts): boolean {
  return f.highlights.length === 0 && f.meetingsHeld.length === 0;
}

/**
 * Flattens the facts into the `inputs` map the generate function already accepts.
 * Kept separate from `assembleUpdate` so the UI can show exactly this, unmodified,
 * before anyone presses Generate.
 */
export function updatePromptInputs(f: UpdateFacts, i: UpdateInputs): Record<string, string> {
  const measured = [
    `Window: ${f.from.toDateString()} → ${f.to.toDateString()} (${f.periodDays} days)`,
    ...f.metrics.map((m) => `${m.label}: ${formatMetric(m)}`),
  ].join("\n");

  const delivered = f.highlights.length
    ? f.highlights.map((h) => `- ${h.title} (${h.client}, ${h.when})`).join("\n")
    : "(nothing completed in this window carries a completion timestamp)";

  const meetings = f.meetingsHeld.length
    ? f.meetingsHeld.map((m) => `- ${m.title} with ${m.with} (${m.when})`).join("\n")
    : "(none recorded)";

  const clients = f.clientActivity.length
    ? f.clientActivity
        .map((c) => `- ${c.name}, ${c.company}: ${c.open} open item(s), ${c.unanswered} unanswered email(s)`)
        .join("\n")
    : "(no clients on file)";

  return {
    company: i.company,
    recipients: i.recipients,
    period: i.periodLabel || `${f.from.toDateString()} → ${f.to.toDateString()}`,
    tone: i.tone,
    headline_metrics_from_the_user: i.headlineMetrics || "(none supplied — omit a metrics section rather than inventing one)",
    measured_activity: measured,
    delivered_this_period: delivered,
    meetings_held: meetings,
    client_activity: clients,
    risks_and_blockers: f.risks.length ? f.risks.map((r) => `- ${r}`).join("\n") : "(none detected)",
    lowlights_from_the_user: i.lowlights || "(none supplied)",
    asks: i.asks || "(none supplied — omit the asks section)",
    data_caveats: f.warnings.length ? f.warnings.join(" ") : "(none)",
  };
}
