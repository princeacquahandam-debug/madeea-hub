/**
 * Team workload — who has what on their plate.
 *
 * Pure and derived from the real task list. The Member type already carried an
 * `open_tasks` number, but it counted tasks by owner_id — i.e. tasks a person
 * CREATED, not tasks assigned to them — which is a different (and for workload
 * balancing, useless) question. Everything here counts by assignee.
 */
import type { Member } from "@/data/hooks";
import type { Task } from "@/types/db";

export interface Workload {
  member: Member;
  open: number;
  overdue: number;
  dueToday: number;
  urgent: number;
  completedThisWeek: number;
}

const DAY = 86_400_000;

const dayKey = (iso: string): string => iso.slice(0, 10);

export function workloadFor(member: Member, tasks: Task[], now = new Date()): Workload {
  const mine = tasks.filter((t) => t.assignee_id === member.user_id);
  const open = mine.filter((t) => t.status !== "done");
  const today = dayKey(now.toISOString());
  const weekAgo = now.getTime() - 7 * DAY;

  return {
    member,
    open: open.length,
    overdue: open.filter((t) => t.due_at && dayKey(t.due_at) < today).length,
    dueToday: open.filter((t) => t.due_at && dayKey(t.due_at) === today).length,
    urgent: open.filter((t) => t.priority === "urgent").length,
    completedThisWeek: mine.filter(
      (t) => t.status === "done" && t.completed_at && new Date(t.completed_at).getTime() >= weekAgo,
    ).length,
  };
}

/** Busiest first, so an unbalanced plate is the first thing you see. */
export function teamWorkload(members: Member[], tasks: Task[], now = new Date()): Workload[] {
  return members
    .map((m) => workloadFor(m, tasks, now))
    .sort((a, b) => b.overdue - a.overdue || b.open - a.open);
}

/** Tasks nobody has picked up. Not an error state — just work with no owner yet. */
export const unassignedCount = (tasks: Task[]): number =>
  tasks.filter((t) => !t.assignee_id && t.status !== "done").length;

/**
 * Deterministic colour per member, so the same person is the same colour on every
 * screen. Avatars are initials — there's no photo upload for team members.
 */
const AVATAR_TONES = [
  "bg-accent/20 text-accent-soft",
  "bg-sky-500/20 text-sky-300",
  "bg-emerald-500/20 text-emerald-300",
  "bg-violet-500/20 text-violet-300",
  "bg-amber-500/20 text-amber-300",
  "bg-rose-500/20 text-rose-300",
];

export function toneFor(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}
