/**
 * One source of truth for follow-up flags, shared by the bell, the Dashboard, the
 * inbox and the task board, so the count in the badge always matches the list you
 * land on.
 *
 * Recomputed on demand and memoised. The brief asked for a nightly job; at this
 * data scale that would buy nothing but staleness between runs (see lib/followups.ts).
 *
 * WHOSE TASKS. Team members can read the shared task board, but chasing a task
 * nobody has touched is the job of whoever owns it, or of a manager. So a team
 * member's follow-ups cover only their own tasks (the same "mine" rule as "Your
 * active tasks" on the Dashboard); managers and up keep the whole team's. Found
 * 19 Nov 2026: a brand-new EA with no tasks was shown five of other people's.
 */
import { useMemo } from "react";
import { atLeast, useClients, useMessages, useMyRole, useSnoozes, useTasks } from "@/data/hooks";
import { useAuth } from "@/hooks/useAuth";
import { isMine } from "@/lib/taskSort";
import { useFollowUpSettings } from "@/store/followupSettings";
import { findFollowUps, type Flag } from "@/lib/followups";

export function useFollowUps(): { flags: Flag[]; byId: (id: string) => Flag | undefined } {
  const { data: messages = [] } = useMessages();
  const { data: allTasks = [] } = useTasks();
  const { data: clients = [] } = useClients();
  const { data: snoozes = [] } = useSnoozes();
  const { data: role } = useMyRole();
  const { user } = useAuth();
  const cfg = useFollowUpSettings((s) => s.config);

  const tasks = useMemo(
    () => (atLeast(role, "manager") ? allTasks : allTasks.filter((t) => isMine(t, user?.id))),
    [allTasks, role, user?.id],
  );

  const flags = useMemo(
    () => findFollowUps({ messages, tasks, clients, snoozes }, cfg),
    [messages, tasks, clients, snoozes, cfg],
  );

  return useMemo(
    () => ({ flags, byId: (id: string) => flags.find((f) => f.itemId === id) }),
    [flags],
  );
}
