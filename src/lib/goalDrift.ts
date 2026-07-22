/**
 * Goal drift — does the diary match what the boss said matters?
 *
 * The uncomfortable question an EA is well placed to ask and rarely does: the
 * stated priority was the fundraise, so why did this week go on internal
 * catch-ups? Nothing else in the app compares intention against where the time
 * actually went.
 *
 * TWO HONESTY CONSTRAINTS, both load-bearing, both surfaced in the UI:
 *
 *  1. This measures MEETINGS, not HOURS. No meeting in this schema carries an end
 *     time (see types/db.ts — `starts_at` only), so "80% of your week" is not
 *     computable and is not claimed. "9 of 12 meetings" is true and checkable;
 *     a percentage of time would be invented.
 *
 *  2. Connection is judged by shared keywords between the goal and the meeting
 *     title, not by meaning. A meeting that advances a goal under different
 *     wording will read as unconnected. That undercounts alignment, which is the
 *     safe direction to be wrong in — it prompts a human to look, rather than
 *     quietly reassuring them everything is fine.
 *
 * Pure and network-free, like the rest of lib/.
 */
import type { Meeting } from "@/types/db";
import { tokenise, type MemoryEntry } from "@/lib/memory";

const DAY = 86_400_000;

export interface GoalAlignment {
  id: string;
  goal: string;
  /** Meetings whose title/attendee shares a keyword with the goal. */
  matched: number;
  /** Share of the period's meetings, 0–100. Null when there are no meetings. */
  sharePct: number | null;
  /** A few matching meeting titles, so the number is checkable. */
  examples: string[];
}

export interface GoalDrift {
  periodDays: number;
  totalMeetings: number;
  goals: GoalAlignment[];
  /** Meetings that share no keyword with any stated goal. */
  unconnected: number;
  unconnectedPct: number | null;
  /** The plain sentence, or null when there is nothing honest to say. */
  headline: string | null;
  /** What this measure can and can't see. Always rendered. */
  caveats: string[];
  /** True when no goals are recorded — a prompt, not a finding. */
  noGoals: boolean;
}

export interface GoalDriftSources {
  memories: MemoryEntry[];
  meetings: Meeting[];
}

/** Goals are memory entries of kind 'goal' (migration 0018). */
export function statedGoals(memories: MemoryEntry[]): MemoryEntry[] {
  return memories.filter((m) => m.kind === "goal");
}

export function computeGoalDrift(
  { memories, meetings }: GoalDriftSources,
  periodDays = 7,
  now = new Date(),
): GoalDrift {
  const from = now.getTime() - periodDays * DAY;
  const inPeriod = meetings.filter((m) => {
    if (!m.starts_at) return false;
    const t = new Date(m.starts_at).getTime();
    return !Number.isNaN(t) && t > from && t <= now.getTime();
  });

  const goals = statedGoals(memories);
  const total = inPeriod.length;

  const caveats = [
    "Counted by meetings, not hours — no meeting on record carries an end time.",
    "A meeting counts towards a goal when they share a keyword, so work described in different words won't be matched.",
  ];

  if (!goals.length) {
    return {
      periodDays,
      totalMeetings: total,
      goals: [],
      unconnected: total,
      unconnectedPct: total ? 100 : null,
      headline: null,
      caveats,
      noGoals: true,
    };
  }

  // A meeting can serve more than one goal, so alignment is computed per goal and
  // "unconnected" is the set matching none — not total minus the sum.
  const connected = new Set<string>();

  const alignments: GoalAlignment[] = goals.map((g) => {
    const goalTokens = new Set(tokenise(g.body));
    const hits = inPeriod.filter((m) => {
      const meetingTokens = new Set(tokenise(`${m.title} ${m.with ?? ""}`));
      for (const t of goalTokens) if (meetingTokens.has(t)) return true;
      return false;
    });
    hits.forEach((m) => connected.add(m.id));
    return {
      id: g.id,
      goal: g.body,
      matched: hits.length,
      sharePct: total ? Math.round((hits.length / total) * 100) : null,
      examples: hits.slice(0, 3).map((m) => m.title),
    };
  });

  const unconnected = inPeriod.filter((m) => !connected.has(m.id)).length;
  const unconnectedPct = total ? Math.round((unconnected / total) * 100) : null;

  // Ranked so the goal getting the least attention is easiest to spot.
  alignments.sort((a, b) => a.matched - b.matched);

  let headline: string | null = null;
  if (!total) {
    headline = `No meetings in the last ${periodDays} days, so there's nothing to compare your goals against yet.`;
  } else {
    const starved = alignments.find((a) => a.matched === 0);
    if (starved) {
      headline = `Nothing in the last ${periodDays} days connects to “${starved.goal}”. ${unconnected} of ${total} meetings connect to no stated goal.`;
    } else if (unconnectedPct !== null && unconnectedPct >= 50) {
      headline = `${unconnected} of ${total} meetings — ${unconnectedPct}% — connect to none of your stated goals.`;
    } else {
      headline = `${total - unconnected} of ${total} meetings connect to a stated goal.`;
    }
  }

  return {
    periodDays,
    totalMeetings: total,
    goals: alignments,
    unconnected,
    unconnectedPct,
    headline,
    caveats,
    noGoals: false,
  };
}

/** Facts for the prose. The comparison is already done; the model only phrases it. */
export function goalDriftPromptInput(d: GoalDrift): string {
  if (d.noGoals) return "(no goals recorded)";
  const lines = [
    `Period: last ${d.periodDays} days. Meetings in period: ${d.totalMeetings}.`,
    ...d.goals.map((g) => `- “${g.goal}”: ${g.matched} meeting(s)${g.sharePct !== null ? `, ${g.sharePct}%` : ""}`),
    `- Connected to no stated goal: ${d.unconnected}${d.unconnectedPct !== null ? ` (${d.unconnectedPct}%)` : ""}`,
    `Caveats: ${d.caveats.join(" ")}`,
  ];
  return lines.join("\n");
}
