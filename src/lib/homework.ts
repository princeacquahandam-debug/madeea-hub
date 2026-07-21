/**
 * Homework Helper — the prep you owe before a commitment lands.
 *
 * Pure and network-free, same shape as lib/followups.ts and lib/sla.ts, so it can
 * be tested directly and called from a page without a round trip.
 *
 * The distinction from Follow-ups is deliberate and load-bearing:
 *
 *   follow-up — something you already DID went quiet. Backward-looking.
 *   homework  — something you have NOT done yet, and a fixed deadline is coming
 *               to meet it. Forward-looking.
 *
 * Everything here is anchored to a real timestamp already in the database — a
 * meeting's `starts_at` or a task's `due_at`. A row with no timestamp produces no
 * homework rather than a guess: an invented deadline would sort above real ones
 * and push genuine work down the list.
 */
import type { Client, Meeting, Message, Task } from "@/types/db";
import { messagesForClient } from "@/lib/sla";

export type HomeworkKind =
  | "prep_missing"
  | "unanswered_before_meeting"
  | "open_items_before_meeting"
  | "cold_before_meeting"
  | "due_not_started"
  | "blocked"
  | "checklist_incomplete";

export type Severity = "critical" | "soon" | "later";

export interface HomeworkItem {
  /** Stable across recomputes so UI state sticks to the item. */
  id: string;
  kind: HomeworkKind;
  /** What the homework is about — a meeting title or a task title. */
  title: string;
  /** Who it concerns. */
  subtitle: string;
  /** Why this is on the list, in plain words. Shown verbatim. */
  reason: string;
  /** What to actually do about it. */
  action: string;
  /** Hours until the commitment. Negative = the deadline has already passed. */
  hoursUntil: number;
  dueLabel: string;
  severity: Severity;
  path: string;
}

const HOUR = 3_600_000;

export interface HomeworkConfig {
  /** How far ahead to look. Beyond this it isn't homework yet, it's a calendar. */
  horizonDays: number;
  /** No contact in this many days = you're walking in cold. */
  coldContactDays: number;
}

export const DEFAULT_HOMEWORK_CONFIG: HomeworkConfig = {
  horizonDays: 7,
  coldContactDays: 14,
};

/**
 * Rounded to whole days rather than claiming "tomorrow" — 30 hours out can be
 * two calendar days away depending on the hour, and the precise wording isn't
 * worth being wrong about.
 */
function relativeLabel(hours: number): string {
  if (hours < 0) {
    const over = -hours;
    if (over < 24) return `overdue by ${Math.max(1, Math.round(over))}h`;
    const d = Math.round(over / 24);
    return `overdue by ${d} day${d === 1 ? "" : "s"}`;
  }
  if (hours < 1) return "in under an hour";
  if (hours < 24) return `in ${Math.round(hours)}h`;
  const d = Math.round(hours / 24);
  return `in ${d} day${d === 1 ? "" : "s"}`;
}

function severityFor(hoursUntil: number): Severity {
  if (hoursUntil <= 24) return "critical"; // includes anything already overdue
  if (hoursUntil <= 72) return "soon";
  return "later";
}

/**
 * When two items share a deadline, this decides which is more embarrassing to get
 * wrong. Walking into a meeting owing the client an unanswered email outranks not
 * having built the prep packet for it.
 */
const KIND_WEIGHT: Record<HomeworkKind, number> = {
  unanswered_before_meeting: 0,
  blocked: 1,
  prep_missing: 2,
  open_items_before_meeting: 3,
  cold_before_meeting: 4,
  due_not_started: 5,
  checklist_incomplete: 6,
};

export const HOMEWORK_KIND_LABEL: Record<HomeworkKind, string> = {
  prep_missing: "No prep",
  unanswered_before_meeting: "Owe a reply",
  open_items_before_meeting: "Open items",
  cold_before_meeting: "Gone cold",
  due_not_started: "Not started",
  blocked: "Blocked",
  checklist_incomplete: "Checklist open",
};

/** Maps onto the existing Badge tones. */
export const SEVERITY_TONE: Record<Severity, string> = {
  critical: "urgent",
  soon: "high",
  later: "normal",
};

export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "Next 24h",
  soon: "Next 3 days",
  later: "This week",
};

export interface HomeworkSources {
  meetings: Meeting[];
  tasks: Task[];
  clients: Client[];
  messages: Message[];
  /** Meeting ids that already have a generated prep packet (store/meetingPreps). */
  preppedMeetingIds: Set<string>;
}

/** Most recent contact in EITHER direction — an email we sent counts as contact. */
function lastContactAt(client: Client, messages: Message[]): number | null {
  let latest: number | null = null;
  for (const m of messages) {
    if (m.client_id !== client.id && m.client_name !== client.name) continue;
    if (!m.received_at) continue;
    const t = new Date(m.received_at).getTime();
    if (Number.isNaN(t)) continue;
    if (latest === null || t > latest) latest = t;
  }
  return latest;
}

export function findHomework(
  { meetings, tasks, clients, messages, preppedMeetingIds }: HomeworkSources,
  cfg: HomeworkConfig = DEFAULT_HOMEWORK_CONFIG,
  now = new Date(),
): HomeworkItem[] {
  const items: HomeworkItem[] = [];
  const horizonMs = cfg.horizonDays * 24 * HOUR;

  // ---- Meetings coming up: what you owe before you walk in --------------------
  for (const m of meetings) {
    if (!m.starts_at) continue; // no real time on the row — nothing honest to say
    const starts = new Date(m.starts_at).getTime();
    if (Number.isNaN(starts)) continue;

    const hoursUntil = (starts - now.getTime()) / HOUR;
    // A meeting that already happened isn't homework — it's history. Tasks are
    // treated differently below, because an overdue task is still owed.
    if (hoursUntil < 0) continue;
    if (starts - now.getTime() > horizonMs) continue;

    const client = clients.find((c) => c.id === m.client_id) ?? null;
    const who = client?.name ?? m.with ?? "Internal";
    const dueLabel = relativeLabel(hoursUntil);
    const severity = severityFor(hoursUntil);
    const base = { hoursUntil, dueLabel, severity, path: "/" as const };

    if (!preppedMeetingIds.has(m.id)) {
      items.push({
        ...base,
        id: `prep_missing:${m.id}`,
        kind: "prep_missing",
        title: m.title,
        subtitle: who,
        reason: "No prep packet has been built for this meeting",
        action: "Open the meeting on the Dashboard and generate the prep packet",
      });
    }

    if (client) {
      const waiting = messagesForClient(client, messages).filter((x) => !x.first_reply_at);
      if (waiting.length) {
        items.push({
          ...base,
          id: `unanswered_before_meeting:${m.id}`,
          kind: "unanswered_before_meeting",
          title: m.title,
          subtitle: who,
          reason:
            waiting.length === 1
              ? `You're meeting them with 1 of their emails still unanswered — "${waiting[0].subject || "(no subject)"}"`
              : `You're meeting them with ${waiting.length} of their emails still unanswered`,
          action: "Reply before the meeting, or lead with it as the first agenda item",
          path: "/communication",
        });
      }

      const open = tasks.filter(
        (t) => t.status !== "done" && (t.client_id === client.id || t.client_name === client.name),
      );
      if (open.length) {
        items.push({
          ...base,
          id: `open_items_before_meeting:${m.id}`,
          kind: "open_items_before_meeting",
          title: m.title,
          subtitle: who,
          reason: `${open.length} open item${open.length === 1 ? "" : "s"} for this client — they may ask`,
          action: `Have a status ready for each, starting with "${open[0].title}"`,
          path: "/tasks",
        });
      }

      const last = lastContactAt(client, messages);
      const daysSinceContact = last === null ? null : Math.floor((now.getTime() - last) / (24 * HOUR));
      if (daysSinceContact !== null && daysSinceContact >= cfg.coldContactDays) {
        items.push({
          ...base,
          id: `cold_before_meeting:${m.id}`,
          kind: "cold_before_meeting",
          title: m.title,
          subtitle: who,
          reason: `No contact either way in ${daysSinceContact} days — you'd be walking in cold`,
          action: "Skim their Client Vault notes and last thread before the call",
          path: "/clients",
        });
      }
    }
  }

  // ---- Tasks with a real due date --------------------------------------------
  for (const t of tasks) {
    if (t.status === "done") continue;
    if (!t.due_at) continue; // no deadline = no homework, by design
    const due = new Date(t.due_at).getTime();
    if (Number.isNaN(due)) continue;

    const hoursUntil = (due - now.getTime()) / HOUR;
    // Overdue tasks stay on the list — unlike meetings, the obligation survives
    // the deadline. Future ones are cut off at the horizon.
    if (due - now.getTime() > horizonMs) continue;

    const dueLabel = relativeLabel(hoursUntil);
    const severity = severityFor(hoursUntil);
    const who = !t.client_name || t.client_name === "Unassigned" ? "Unassigned" : t.client_name;
    const base = { hoursUntil, dueLabel, severity, path: "/tasks" };

    const blocker = t.depends_on ? tasks.find((x) => x.id === t.depends_on) : undefined;
    if (blocker && blocker.status !== "done") {
      items.push({
        ...base,
        id: `blocked:${t.id}`,
        kind: "blocked",
        title: t.title,
        subtitle: who,
        reason: `Can't start — waiting on "${blocker.title}"`,
        action: "Clear the blocker first, or drop the dependency if it's stale",
      });
      // A blocked task can't also be "not started" in any useful sense — the
      // reason it hasn't started is already stated above.
      continue;
    }

    if (t.status === "todo") {
      items.push({
        ...base,
        id: `due_not_started:${t.id}`,
        kind: "due_not_started",
        title: t.title,
        subtitle: who,
        reason: hoursUntil < 0 ? "Past its due date and still not started" : "Due soon and still in To Do",
        action: "Start it, move the date, or hand it to someone with room",
      });
      continue;
    }

    const open = t.subtasks.filter((s) => !s.done);
    if (open.length) {
      items.push({
        ...base,
        id: `checklist_incomplete:${t.id}`,
        kind: "checklist_incomplete",
        title: t.title,
        subtitle: who,
        reason: `${open.length} of ${t.subtasks.length} checklist steps still open`,
        action: `Next step: "${open[0].label}"`,
      });
    }
  }

  // Soonest first; ties broken by how costly the kind is to get wrong.
  return items.sort(
    (a, b) => a.hoursUntil - b.hoursUntil || KIND_WEIGHT[a.kind] - KIND_WEIGHT[b.kind],
  );
}

/** Counts per severity, for the summary strip. */
export function summarise(items: HomeworkItem[]): Record<Severity, number> {
  return {
    critical: items.filter((i) => i.severity === "critical").length,
    soon: items.filter((i) => i.severity === "soon").length,
    later: items.filter((i) => i.severity === "later").length,
  };
}

/**
 * Flattened for the model. Only facts that came out of the database — the prompt
 * carries no numbers this file didn't compute.
 */
export function homeworkBriefInput(items: HomeworkItem[]): string {
  if (!items.length) return "(nothing outstanding)";
  return items
    .slice(0, 25)
    .map((i) => `- [${HOMEWORK_KIND_LABEL[i.kind]}] ${i.title} (${i.subtitle}) — ${i.reason}. Due ${i.dueLabel}.`)
    .join("\n");
}
