/**
 * Follow-up nudges: things that were sent or started and then went quiet.
 *
 * Pure and network-free — computed on demand and memoised at the call site. At a
 * few hundred rows this costs microseconds; the "run it nightly" instinct is about
 * server cost, and there is no server doing this work.
 *
 * Two kinds, and the distinction matters:
 *
 *   dead thread — WE emailed THEM and no reply came back. This is the blind spot:
 *                 it never appears in an inbox, so it's the thing that actually
 *                 falls through the cracks.
 *   stale task  — a task nobody has touched (status unchanged) and isn't done.
 *
 * Deliberately NOT flagged here: inbound mail we haven't answered. That's already
 * surfaced as an SLA breach (lib/sla.ts). Flagging it again under a second name
 * would nag twice for one problem.
 */
import type { Client, Message, Snooze, Task } from "@/types/db";
import type { FollowUpConfig } from "@/store/followupSettings";

export type FlagKind = "dead_thread" | "stale_task";

export interface Flag {
  /** Stable across recomputes, so "read" and "snoozed" state sticks to the item. */
  id: string;
  kind: FlagKind;
  itemType: "message" | "task";
  itemId: string;
  title: string;
  subtitle: string;
  /** Human explanation of WHY this is flagged — shown verbatim in the UI. */
  reason: string;
  days: number;
  path: string;
}

const DAY = 86_400_000;

const daysSince = (iso: string | null | undefined, now: Date): number | null => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((now.getTime() - t) / DAY);
};

const plural = (n: number) => (n === 1 ? "day" : "days");

/** item_id → snooze_until, for snoozes that haven't expired. */
export function activeSnoozes(snoozes: Snooze[], now = new Date()): Set<string> {
  return new Set(
    snoozes
      .filter((s) => new Date(s.snooze_until).getTime() > now.getTime())
      .map((s) => `${s.item_type}:${s.item_id}`),
  );
}

export interface FollowUpSources {
  messages: Message[];
  tasks: Task[];
  clients: Client[];
  snoozes: Snooze[];
}

export function findFollowUps(
  { messages, tasks, clients, snoozes }: FollowUpSources,
  cfg: FollowUpConfig,
  now = new Date(),
): Flag[] {
  const muted = activeSnoozes(snoozes, now);
  const flags: Flag[] = [];

  // --- Dead threads: we wrote, nobody wrote back -----------------------------
  for (const m of messages) {
    if (m.direction !== "outbound") continue; // inbound is the SLA feature's job
    if (m.reply_received_at) continue; // they answered — not dead
    if (m.category === "archive") continue; // explicitly dealt with

    const days = daysSince(m.received_at, now);
    if (days === null) continue;

    const client = clients.find((c) => c.id === m.client_id || c.name === m.client_name) ?? null;
    const threshold = client ? cfg.clientEmailDays : cfg.internalEmailDays;
    if (days < threshold) continue;
    if (muted.has(`message:${m.id}`)) continue;

    flags.push({
      id: `dead_thread:${m.id}`,
      kind: "dead_thread",
      itemType: "message",
      itemId: m.id,
      title: m.subject || "(no subject)",
      subtitle: client ? client.name : m.sender_name,
      reason: `No reply in ${days} ${plural(days)}`,
      days,
      path: "/communication",
    });
  }

  // --- Stale tasks: started, never touched again -----------------------------
  for (const t of tasks) {
    if (t.status === "done") continue;

    // updated_at is bumped by a DB trigger on any change. Before migration 0013 it
    // won't exist, so fall back to the due date's absence of movement — but never
    // invent a timestamp: no signal means no flag.
    const touched = t.updated_at ?? null;
    const days = daysSince(touched, now);
    if (days === null) continue;
    if (days < cfg.taskDays) continue;
    if (muted.has(`task:${t.id}`)) continue;

    const unassigned = !t.client_name || t.client_name === "Unassigned";
    flags.push({
      id: `stale_task:${t.id}`,
      kind: "stale_task",
      itemType: "task",
      itemId: t.id,
      title: t.title,
      subtitle: unassigned ? "Unassigned" : t.client_name,
      reason: `No update in ${days} ${plural(days)}`,
      days,
      path: "/tasks",
    });
  }

  // Oldest first — the thing rotting longest is the thing to deal with.
  return flags.sort((a, b) => b.days - a.days);
}

export const KIND_LABEL: Record<FlagKind, string> = {
  dead_thread: "No reply",
  stale_task: "Stale task",
};
