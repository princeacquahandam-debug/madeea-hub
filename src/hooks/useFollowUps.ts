/**
 * One source of truth for follow-up flags, shared by the bell, the Dashboard, the
 * inbox and the task board — so the count in the badge always matches the list you
 * land on.
 *
 * Recomputed on demand and memoised. The brief asked for a nightly job; at this
 * data scale that would buy nothing but staleness between runs (see lib/followups.ts).
 */
import { useMemo } from "react";
import { useClients, useMessages, useSnoozes, useTasks } from "@/data/hooks";
import { useFollowUpSettings } from "@/store/followupSettings";
import { findFollowUps, type Flag } from "@/lib/followups";

export function useFollowUps(): { flags: Flag[]; byId: (id: string) => Flag | undefined } {
  const { data: messages = [] } = useMessages();
  const { data: tasks = [] } = useTasks();
  const { data: clients = [] } = useClients();
  const { data: snoozes = [] } = useSnoozes();
  const cfg = useFollowUpSettings((s) => s.config);

  const flags = useMemo(
    () => findFollowUps({ messages, tasks, clients, snoozes }, cfg),
    [messages, tasks, clients, snoozes, cfg],
  );

  return useMemo(
    () => ({ flags, byId: (id: string) => flags.find((f) => f.itemId === id) }),
    [flags],
  );
}
