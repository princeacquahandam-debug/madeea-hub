/**
 * Daily Briefing Helper — the day, assembled.
 *
 * This file adds almost no new logic on purpose. Everything it reports is already
 * computed somewhere: lib/focus.ts ranks the work, lib/homework.ts finds what's
 * owed, lib/sla.ts knows who's waiting, lib/memory.ts holds the commitments. A
 * second, subtly different implementation of "what's urgent" would drift from the
 * first and the two would quietly disagree — which is how an EA ends up trusting
 * neither.
 *
 * So the briefing composes. Its own contribution is narrow and specific:
 *
 *   - the day's boundary (what counts as "today")
 *   - what's actually NEW since the last briefing, which is the only reason to read
 *     one twice
 *   - a coverage note when a section is empty because there's no data rather than
 *     because there's nothing to do — those two look identical and mean opposite
 *     things
 */
import type { Client, Meeting, Message, Task } from "@/types/db";
import type { SlaConfig } from "@/store/slaSettings";
import { rankFocus, type FocusItem } from "@/lib/focus";
import { findHomework, DEFAULT_HOMEWORK_CONFIG, type HomeworkItem } from "@/lib/homework";
import { dayLength, formatDuration, thresholdsFor, waitingHours } from "@/lib/sla";
import { recall, type MemoryEntry, type Recalled } from "@/lib/memory";

export interface BriefingMeeting {
  id: string;
  time: string;
  title: string;
  with: string;
  minutesAway: number;
}

export interface WaitingMail {
  id: string;
  subject: string;
  who: string;
  waited: string;
  breached: boolean;
}

export interface Briefing {
  date: Date;
  greeting: string;
  meetingsToday: BriefingMeeting[];
  focus: FocusItem[];
  waiting: WaitingMail[];
  dueToday: HomeworkItem[];
  commitments: Recalled[];
  /** Items that first appeared since the timestamp passed in. */
  newSinceLast: string[];
  /** Empty-section explanations — "no data" vs "nothing to do". */
  coverage: string[];
}

const MINUTE = 60_000;

const startOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

function greetingFor(d: Date): string {
  const h = d.getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export interface BriefingSources {
  tasks: Task[];
  messages: Message[];
  meetings: Meeting[];
  clients: Client[];
  memories: MemoryEntry[];
  cfg: SlaConfig;
  /** ISO timestamp of the last briefing, for the "new since" section. */
  lastSeenAt?: string | null;
}

export function buildBriefing(
  { tasks, messages, meetings, clients, memories, cfg, lastSeenAt }: BriefingSources,
  now = new Date(),
): Briefing {
  const dayStart = startOfDay(now).getTime();
  const dayEnd = dayStart + 86_400_000;

  const meetingsToday: BriefingMeeting[] = meetings
    .filter((m) => {
      if (!m.starts_at) return false;
      const t = new Date(m.starts_at).getTime();
      return t >= dayStart && t < dayEnd;
    })
    .sort((a, b) => new Date(a.starts_at!).getTime() - new Date(b.starts_at!).getTime())
    .map((m) => ({
      id: m.id,
      time: new Date(m.starts_at!).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
      title: m.title,
      with: m.with || "Internal",
      minutesAway: Math.round((new Date(m.starts_at!).getTime() - now.getTime()) / MINUTE),
    }));

  const focus = rankFocus({ tasks, messages, clients, cfg }, now)
    .filter((i) => !i.blockedBy)
    .slice(0, 5);

  const dl = dayLength(cfg);
  const waiting: WaitingMail[] = messages
    .filter((m) => m.direction !== "outbound" && !m.first_reply_at && m.received_at)
    .map((m) => {
      const client = clients.find((c) => c.id === m.client_id || c.name === m.client_name) ?? null;
      const hours = waitingHours(m, cfg, now) ?? 0;
      return {
        id: m.id,
        subject: m.subject || "(no subject)",
        who: client?.name ?? m.sender_name,
        waited: formatDuration(hours, dl),
        breached: hours > thresholdsFor(client, cfg).risk,
        _hours: hours,
      };
    })
    .sort((a, b) => b._hours - a._hours)
    .slice(0, 6)
    .map(({ _hours, ...rest }) => rest);

  // Homework restricted to today — a briefing is about today, not the week.
  const dueToday = findHomework(
    { meetings, tasks, clients, messages, preppedMeetingIds: new Set() },
    { ...DEFAULT_HOMEWORK_CONFIG, horizonDays: 1 },
    now,
  );

  // Commitments are the memory kind that belongs in a briefing — a recorded promise
  // is exactly the thing that gets forgotten between the day it's made and the day
  // it's due.
  const commitments = recall(memories, { kinds: ["commitment"], limit: 5 });

  // ---- what's new since last time --------------------------------------------
  const newSince: string[] = [];
  if (lastSeenAt) {
    const since = new Date(lastSeenAt).getTime();
    if (!Number.isNaN(since)) {
      const newMail = messages.filter(
        (m) => m.direction !== "outbound" && m.received_at && new Date(m.received_at).getTime() > since,
      );
      if (newMail.length) {
        newSince.push(`${newMail.length} new message${newMail.length === 1 ? "" : "s"} arrived`);
      }
      const newTasks = tasks.filter((t) => t.created_at && new Date(t.created_at).getTime() > since);
      if (newTasks.length) {
        newSince.push(`${newTasks.length} task${newTasks.length === 1 ? "" : "s"} created`);
      }
      const doneTasks = tasks.filter(
        (t) => t.completed_at && new Date(t.completed_at).getTime() > since,
      );
      if (doneTasks.length) {
        newSince.push(`${doneTasks.length} task${doneTasks.length === 1 ? "" : "s"} completed`);
      }
      if (!newSince.length) newSince.push("Nothing has changed since your last briefing");
    }
  }

  // ---- honest empty states ----------------------------------------------------
  const coverage: string[] = [];
  if (!meetings.some((m) => m.starts_at)) {
    coverage.push("No meeting has a start time on record, so “today's meetings” can't be built. Connect Google Calendar in Integrations.");
  }
  if (!messages.length) {
    coverage.push("No mail is synced, so nothing can be reported as waiting on a reply.");
  }
  if (!memories.length) {
    coverage.push("No commitments recorded yet — add them in the Memory Helper and they'll appear here.");
  }

  return {
    date: now,
    greeting: greetingFor(now),
    meetingsToday,
    focus,
    waiting,
    dueToday,
    commitments,
    newSinceLast: newSince,
    coverage,
  };
}

/** True when the day genuinely has nothing in it, as opposed to no data. */
export function isQuietDay(b: Briefing): boolean {
  return (
    !b.meetingsToday.length && !b.focus.length && !b.waiting.length && !b.dueToday.length
  );
}

/** Facts for the briefing prose. Everything here was computed elsewhere. */
export function briefingPromptInputs(b: Briefing): Record<string, string> {
  return {
    date: b.date.toDateString(),
    meetings_today: b.meetingsToday.length
      ? b.meetingsToday.map((m) => `- ${m.time} ${m.title} with ${m.with}`).join("\n")
      : "(none)",
    top_priorities: b.focus.length
      ? b.focus.map((f, i) => `${i + 1}. ${f.title} (${f.subtitle}) — ${f.reasons.map((r) => r.label).join("; ")}`).join("\n")
      : "(nothing ranked)",
    waiting_on_a_reply: b.waiting.length
      ? b.waiting.map((w) => `- ${w.subject} from ${w.who}, waiting ${w.waited}${w.breached ? " (past the agreed time)" : ""}`).join("\n")
      : "(none)",
    due_today: b.dueToday.length
      ? b.dueToday.map((h) => `- ${h.title} (${h.subtitle}) — ${h.reason}`).join("\n")
      : "(none)",
    standing_commitments: b.commitments.length
      ? b.commitments.map((c) => `- ${c.body}`).join("\n")
      : "(none recorded)",
    changed_since_last_briefing: b.newSinceLast.length ? b.newSinceLast.join("; ") : "(not tracked yet)",
    data_gaps: b.coverage.length ? b.coverage.join(" ") : "(none)",
  };
}
