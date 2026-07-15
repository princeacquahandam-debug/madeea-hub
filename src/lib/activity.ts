/**
 * Per-client activity log — a read-only aggregation over data that already exists.
 *
 * No new store, no new table: it queries tasks, messages and meetings, filters them
 * to one client, and merges them into a single descending timeline. Pure and
 * network-free.
 *
 * Five event kinds, because a "touchpoint" isn't one shape:
 *   task_created / task_completed — a task is two events, not one. When it was
 *       started and when it was delivered answer different questions, and "what did
 *       we do for this client last month" is mostly about the second.
 *   email_in / email_out — both directions, so the log shows the back-and-forth
 *       rather than a client emailing into a void.
 *   meeting — one event, at starts_at.
 */
import type { Client, Meeting, Message, Task, TaskEvent } from "@/types/db";

export type ActivityKind =
  | "task_created"
  | "task_completed"
  | "task_reassigned"
  | "email_in"
  | "email_out"
  | "meeting";

export type ActivityType = "task" | "email" | "meeting";

export interface ActivityEntry {
  id: string;
  kind: ActivityKind;
  type: ActivityType;
  title: string;
  /** What happened, in plain words: "Task completed", "Email received". */
  action: string;
  at: string;
  /** Status of the underlying item at this point — priority, category, etc. */
  status: string | null;
  /** Where clicking goes. Deep links into the real item, never a copy of it. */
  href: string;
  /**
   * True when the timestamp is inferred rather than recorded — completed tasks
   * that predate the completed_at column fall back to created_at. Better to admit
   * the estimate than to present a guess as a fact.
   */
  approximate?: boolean;
}

export interface ActivityFilters {
  types: Set<ActivityType>;
  /** Days back from now; null = everything. */
  days: number | null;
}

export const ALL_TYPES: ActivityType[] = ["task", "email", "meeting"];

export const DATE_RANGES: { label: string; days: number | null }[] = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "All time", days: null },
];

/** Belongs to this client? Prefer the FK; fall back to the name for legacy rows. */
const isFor = (client: Client, clientId?: string | null, clientName?: string | null): boolean =>
  (clientId != null && clientId === client.id) || (!!clientName && clientName === client.name);

export interface ActivitySources {
  tasks: Task[];
  messages: Message[];
  meetings: Meeting[];
  /** Reassignments (migration 0015). Optional so callers that don't care can omit them. */
  taskEvents?: TaskEvent[];
  /** user_id -> display name, for rendering "Reassigned from X to Y". */
  names?: Record<string, string>;
}

export function buildActivity(
  client: Client,
  sources: ActivitySources,
  filters: ActivityFilters,
  now = new Date(),
): ActivityEntry[] {
  const entries: ActivityEntry[] = [];

  for (const t of sources.tasks) {
    if (!isFor(client, t.client_id, t.client_name)) continue;

    if (t.created_at) {
      entries.push({
        id: `task_created:${t.id}`,
        kind: "task_created",
        type: "task",
        title: t.title,
        action: "Task created",
        at: t.created_at,
        status: t.priority,
        href: `/tasks?task=${t.id}`,
      });
    }

    if (t.status === "done") {
      // Tasks completed before migration 0014 have no completed_at; created_at is
      // the only timestamp they carry, so it's the floor — flagged as approximate.
      const at = t.completed_at ?? t.created_at;
      if (at) {
        entries.push({
          id: `task_completed:${t.id}`,
          kind: "task_completed",
          type: "task",
          title: t.title,
          action: "Task completed",
          at,
          status: "done",
          href: `/tasks?task=${t.id}`,
          approximate: !t.completed_at,
        });
      }
    }
  }

  // Reassignments — who moved this client's work onto whose plate, and when.
  const clientTaskIds = new Map(
    sources.tasks.filter((t) => isFor(client, t.client_id, t.client_name)).map((t) => [t.id, t]),
  );
  for (const ev of sources.taskEvents ?? []) {
    const task = clientTaskIds.get(ev.task_id);
    if (!task) continue;
    const nameOf = (id: string | null) => (id ? (sources.names?.[id] ?? "someone") : null);
    const from = nameOf(ev.from_user_id);
    const to = nameOf(ev.to_user_id);
    entries.push({
      id: `task_reassigned:${ev.id}`,
      kind: "task_reassigned",
      type: "task",
      title: task.title,
      action: !to
        ? `Unassigned${from ? ` from ${from}` : ""}`
        : from
          ? `Reassigned from ${from} to ${to}`
          : `Assigned to ${to}`,
      at: ev.created_at,
      status: null,
      href: `/tasks?task=${task.id}`,
    });
  }

  for (const m of sources.messages) {
    if (!isFor(client, m.client_id, m.client_name)) continue;
    if (!m.received_at) continue;
    const outbound = m.direction === "outbound";
    entries.push({
      id: `email:${m.id}`,
      kind: outbound ? "email_out" : "email_in",
      type: "email",
      title: m.subject || "(no subject)",
      action: outbound ? "Email sent" : "Email received",
      at: m.received_at,
      status: m.category,
      href: `/communication?message=${m.id}`,
    });
  }

  for (const mt of sources.meetings) {
    if (!isFor(client, mt.client_id, mt.with)) continue;
    if (!mt.starts_at) continue;
    entries.push({
      id: `meeting:${mt.id}`,
      kind: "meeting",
      type: "meeting",
      title: mt.title,
      action: new Date(mt.starts_at) > now ? "Meeting scheduled" : "Meeting",
      at: mt.starts_at,
      status: mt.status,
      // Meetings have no page of their own — the prep packet IS the detail view.
      href: `/?meeting=${mt.id}`,
    });
  }

  const cutoff = filters.days === null ? null : now.getTime() - filters.days * 86_400_000;

  return entries
    .filter((e) => filters.types.has(e.type))
    .filter((e) => cutoff === null || new Date(e.at).getTime() >= cutoff)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

export interface ActivityGroup {
  label: string;
  entries: ActivityEntry[];
}

const startOfDay = (d: Date): number => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
};

/**
 * Bucket by recency so the eye can scan it: Today / Yesterday / This week /
 * Last week, then by month. Future-dated items (an upcoming meeting) get their own
 * bucket rather than being mislabelled "Today".
 */
export function groupByDate(entries: ActivityEntry[], now = new Date()): ActivityGroup[] {
  const today = startOfDay(now);
  const groups: ActivityGroup[] = [];
  const push = (label: string, e: ActivityEntry) => {
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.entries.push(e);
    else groups.push({ label, entries: [e] });
  };

  for (const e of entries) {
    const t = new Date(e.at);
    const day = startOfDay(t);
    const daysAgo = Math.round((today - day) / 86_400_000);

    let label: string;
    if (daysAgo < 0) label = "Upcoming";
    else if (daysAgo === 0) label = "Today";
    else if (daysAgo === 1) label = "Yesterday";
    else if (daysAgo <= 7) label = "This week";
    else if (daysAgo <= 14) label = "Last week";
    else if (t.getFullYear() === now.getFullYear())
      label = t.toLocaleDateString("en-GB", { month: "long" });
    else label = t.toLocaleDateString("en-GB", { month: "long", year: "numeric" });

    push(label, e);
  }
  return groups;
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}
