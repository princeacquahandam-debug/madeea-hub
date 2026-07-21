/**
 * Focus Helper — what to do right now, and why.
 *
 * The app already tells you what's wrong in several places: SLA breaches, stale
 * follow-ups, homework due. What it never does is put them in one order. An EA
 * looking at four red badges across three pages still has to decide what to touch
 * first, which is the actual hard part.
 *
 * The design constraint that matters: **the ranking must be explainable**. Every
 * item carries the list of reasons that produced its score, and the UI shows them.
 * A black-box "priority score" is worse than no ranking — the EA can't tell whether
 * to trust it, so they fall back to guessing and the feature is dead weight.
 *
 * Weights are declared in SCORING below rather than scattered through the code, so
 * the whole model is legible in one place and tunable without hunting.
 *
 * Blocked work is scored DOWN but still shown, with the blocker named. Hiding it
 * would be tidier and wrong: "why isn't this in my list?" is a worse failure than a
 * low-ranked row, and the blocker is often the thing to go and clear.
 */
import type { Client, Message, Task } from "@/types/db";
import type { SlaConfig } from "@/store/slaSettings";
import { dayLength, formatDuration, thresholdsFor, waitingHours } from "@/lib/sla";

export const SCORING = {
  overdueBase: 30,
  overduePerDay: 2,
  overduePerDayCap: 20,
  dueToday: 22,
  dueWithin2Days: 12,
  dueWithin7Days: 4,
  priority: { urgent: 18, high: 9, normal: 0, low: -6 } as Record<string, number>,
  inProgress: 6,
  stale: 4,
  staleAfterDays: 7,
  blocked: -45,
  mailBreached: 34,
  mailBreachedPerDay: 2,
  mailBreachedPerDayCap: 16,
  mailOverdueSoft: 14,
  mailWaiting: 4,
} as const;

const DAY = 86_400_000;
export const MINUTE_MS = 60_000;

export interface ScoreReason {
  label: string;
  points: number;
}

export interface FocusItem {
  id: string;
  kind: "task" | "email";
  title: string;
  subtitle: string;
  score: number;
  reasons: ScoreReason[];
  path: string;
  /** Named blocker when the item can't actually be started yet. */
  blockedBy: string | null;
}

export interface FocusSources {
  tasks: Task[];
  messages: Message[];
  clients: Client[];
  cfg: SlaConfig;
}

const daysUntil = (iso: string, now: Date) =>
  Math.floor((new Date(iso).getTime() - now.getTime()) / DAY);

export function rankFocus({ tasks, messages, clients, cfg }: FocusSources, now = new Date()): FocusItem[] {
  const items: FocusItem[] = [];

  // ---- tasks -----------------------------------------------------------------
  for (const t of tasks) {
    if (t.status === "done") continue;
    const reasons: ScoreReason[] = [];

    if (t.due_at) {
      const due = new Date(t.due_at).getTime();
      if (!Number.isNaN(due)) {
        const days = daysUntil(t.due_at, now);
        if (due < now.getTime()) {
          const over = Math.abs(days);
          const extra = Math.min(over * SCORING.overduePerDay, SCORING.overduePerDayCap);
          reasons.push({
            label: over === 0 ? "Past its due time today" : `Overdue by ${over} day${over === 1 ? "" : "s"}`,
            points: SCORING.overdueBase + extra,
          });
        } else if (days === 0) {
          reasons.push({ label: "Due today", points: SCORING.dueToday });
        } else if (days <= 2) {
          reasons.push({ label: `Due in ${days} day${days === 1 ? "" : "s"}`, points: SCORING.dueWithin2Days });
        } else if (days <= 7) {
          reasons.push({ label: "Due this week", points: SCORING.dueWithin7Days });
        }
      }
    }

    const pts = SCORING.priority[t.priority] ?? 0;
    if (pts !== 0) {
      reasons.push({ label: `${t.priority.charAt(0).toUpperCase()}${t.priority.slice(1)} priority`, points: pts });
    }

    if (t.status === "in_progress") {
      reasons.push({ label: "Already started — finish it", points: SCORING.inProgress });
    }

    if (t.updated_at) {
      const idle = Math.floor((now.getTime() - new Date(t.updated_at).getTime()) / DAY);
      if (idle >= SCORING.staleAfterDays) {
        reasons.push({ label: `Untouched for ${idle} days`, points: SCORING.stale });
      }
    }

    let blockedBy: string | null = null;
    if (t.depends_on) {
      const dep = tasks.find((x) => x.id === t.depends_on);
      if (dep && dep.status !== "done") {
        blockedBy = dep.title;
        reasons.push({ label: `Blocked by "${dep.title}"`, points: SCORING.blocked });
      }
    }

    // No signal at all means no opinion — don't manufacture a ranking for it.
    if (!reasons.length) continue;

    items.push({
      id: `task:${t.id}`,
      kind: "task",
      title: t.title,
      subtitle: !t.client_name || t.client_name === "Unassigned" ? "Unassigned" : t.client_name,
      score: reasons.reduce((s, r) => s + r.points, 0),
      reasons,
      path: "/tasks",
      blockedBy,
    });
  }

  // ---- unanswered inbound mail ------------------------------------------------
  const dl = dayLength(cfg);
  for (const m of messages) {
    if (m.direction === "outbound" || m.first_reply_at) continue;
    const hours = waitingHours(m, cfg, now);
    if (hours === null) continue;

    const client = clients.find((c) => c.id === m.client_id || c.name === m.client_name) ?? null;
    const t = thresholdsFor(client, cfg);
    const reasons: ScoreReason[] = [];
    const waited = formatDuration(hours, dl);

    if (hours > t.risk) {
      const overDays = Math.floor((hours - t.risk) / 24);
      const extra = Math.min(overDays * SCORING.mailBreachedPerDay, SCORING.mailBreachedPerDayCap);
      reasons.push({ label: `Past the agreed response time — waiting ${waited}`, points: SCORING.mailBreached + extra });
    } else if (hours > t.ok) {
      reasons.push({ label: `Waiting ${waited}, past the target reply time`, points: SCORING.mailOverdueSoft });
    } else if (hours > 0) {
      reasons.push({ label: `Waiting ${waited}`, points: SCORING.mailWaiting });
    }
    if (!reasons.length) continue;

    items.push({
      id: `email:${m.id}`,
      kind: "email",
      title: m.subject || "(no subject)",
      subtitle: client?.name ?? m.sender_name,
      score: reasons.reduce((s, r) => s + r.points, 0),
      reasons,
      path: "/communication",
      blockedBy: null,
    });
  }

  // Highest score first. Ties broken so an actionable item beats a blocked one of
  // equal score — the whole point is to hand back something you can start.
  return items.sort(
    (a, b) => b.score - a.score || Number(Boolean(a.blockedBy)) - Number(Boolean(b.blockedBy)),
  );
}

/** The shortlist. Blocked items are excluded here — you can't start them. */
export function nextUp(items: FocusItem[], count = 3): FocusItem[] {
  return items.filter((i) => !i.blockedBy).slice(0, count);
}

export const FOCUS_DURATIONS = [15, 25, 50] as const;

export function formatClock(msRemaining: number): string {
  const total = Math.max(0, Math.round(msRemaining / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Facts for the "plan my next hour" prose. Ranking stays in code. */
export function focusPromptInputs(items: FocusItem[]): Record<string, string> {
  const top = items.slice(0, 8);
  return {
    ranked_work: top.length
      ? top
          .map(
            (i, n) =>
              `${n + 1}. [${i.kind}] ${i.title} (${i.subtitle}) — score ${i.score}; ${i.reasons
                .map((r) => `${r.label} ${r.points > 0 ? "+" : ""}${r.points}`)
                .join("; ")}${i.blockedBy ? ` — BLOCKED by "${i.blockedBy}"` : ""}`,
          )
          .join("\n")
      : "(nothing ranked — no overdue, due or waiting work)",
    blocked_count: String(items.filter((i) => i.blockedBy).length),
  };
}
