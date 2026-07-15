import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CheckSquare, CheckCircle2, Mail, Send, Calendar, ChevronRight, History, UserCog,
} from "lucide-react";
import { Badge } from "@/components/ui";
import { useMeetings, useMessages, useTasks, useTaskEvents, useWorkspaceMembers } from "@/data/hooks";
import {
  buildActivity, groupByDate, formatTime, ALL_TYPES, DATE_RANGES,
  type ActivityEntry, type ActivityType,
} from "@/lib/activity";
import type { Client } from "@/types/db";

const ICONS = {
  task_created: CheckSquare,
  task_completed: CheckCircle2,
  task_reassigned: UserCog,
  email_in: Mail,
  email_out: Send,
  meeting: Calendar,
} as const;

const ICON_TONE: Record<ActivityEntry["kind"], string> = {
  task_created: "text-faint",
  task_completed: "text-emerald-400",
  task_reassigned: "text-amber-400",
  email_in: "text-sky-400",
  email_out: "text-accent",
  meeting: "text-violet-400",
};

const TYPE_LABEL: Record<ActivityType, string> = {
  task: "Tasks",
  email: "Emails",
  meeting: "Meetings",
};

export function ClientActivity({ client }: { client: Client }) {
  const nav = useNavigate();
  const { data: tasks = [] } = useTasks();
  const { data: messages = [] } = useMessages();
  const { data: meetings = [] } = useMeetings();
  const { data: taskEvents = [] } = useTaskEvents();
  const { data: members = [] } = useWorkspaceMembers();
  const names = useMemo(
    () => Object.fromEntries(members.map((m) => [m.user_id, m.name])),
    [members],
  );

  const [types, setTypes] = useState<Set<ActivityType>>(new Set(ALL_TYPES));
  const [days, setDays] = useState<number | null>(90);

  const entries = useMemo(
    () => buildActivity(client, { tasks, messages, meetings, taskEvents, names }, { types, days }),
    [client, tasks, messages, meetings, taskEvents, names, types, days],
  );
  const groups = useMemo(() => groupByDate(entries), [entries]);

  // Counts ignore the type filter, so the chips can show what you'd get by toggling.
  const totals = useMemo(() => {
    const all = buildActivity(client, { tasks, messages, meetings, taskEvents, names }, { types: new Set(ALL_TYPES), days });
    return {
      task: all.filter((e) => e.type === "task").length,
      email: all.filter((e) => e.type === "email").length,
      meeting: all.filter((e) => e.type === "meeting").length,
      all: all.length,
    };
  }, [client, tasks, messages, meetings, taskEvents, names, days]);

  const toggle = (t: ActivityType) =>
    setTypes((prev) => {
      const next = new Set(prev);
      // Never let the user filter everything away into a blank panel.
      if (next.has(t) && next.size > 1) next.delete(t);
      else next.add(t);
      return next;
    });

  return (
    <div>
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        {ALL_TYPES.map((t) => (
          <button
            key={t}
            onClick={() => toggle(t)}
            aria-pressed={types.has(t)}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
              types.has(t) ? "bg-accent text-white" : "bg-surface-2 text-muted hover:text-zinc-100"
            }`}
          >
            {TYPE_LABEL[t]}
            <span className={types.has(t) ? "ml-1.5 opacity-70" : "ml-1.5 text-faint"}>{totals[t]}</span>
          </button>
        ))}
        <select
          className="input ml-auto w-auto py-1 text-xs"
          aria-label="Date range"
          value={days === null ? "all" : String(days)}
          onChange={(e) => setDays(e.target.value === "all" ? null : Number(e.target.value))}
        >
          {DATE_RANGES.map((r) => (
            <option key={r.label} value={r.days === null ? "all" : String(r.days)}>
              {r.days === null ? r.label : `Last ${r.label}`}
            </option>
          ))}
        </select>
      </div>

      {entries.length === 0 ? (
        <div className="mt-4 rounded-lg bg-surface-2 p-8 text-center">
          <History size={22} className="mx-auto mb-2 text-faint" />
          <p className="text-sm text-muted">
            {totals.all === 0
              ? `Nothing recorded for ${client.name} yet.`
              : "Nothing in this range."}
          </p>
          <p className="mt-1 text-xs text-faint">
            {totals.all === 0
              ? "Tasks, emails and meetings will appear here as they happen."
              : "Try widening the date range or turning a filter back on."}
          </p>
        </div>
      ) : (
        <div className="mt-4 space-y-5">
          {groups.map((g) => (
            <div key={g.label}>
              <p className="eyebrow mb-2">{g.label}</p>
              {/* The rail: one continuous line down the group, dots on it per entry. */}
              <div className="relative space-y-1 border-l border-border pl-4">
                {g.entries.map((e) => {
                  const Icon = ICONS[e.kind];
                  return (
                    <button
                      key={e.id}
                      onClick={() => nav(e.href)}
                      className="group -ml-[1.4rem] flex w-[calc(100%+1.4rem)] items-center gap-3 rounded-lg py-2 pl-[1.4rem] pr-2 text-left transition-colors hover:bg-surface-2"
                    >
                      <span className="relative z-10 -ml-[1.85rem] flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface ring-4 ring-surface">
                        <Icon size={14} className={ICON_TONE[e.kind]} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{e.title}</span>
                        <span className="block truncate text-xs text-faint">
                          {e.action} · {formatTime(e.at)}
                          {e.approximate && (
                            <span title="Completed before the app recorded completion times — date approximate">
                              {" "}· approx
                            </span>
                          )}
                        </span>
                      </span>
                      {e.status && <Badge tone={e.status}>{e.status.replace("_", " ")}</Badge>}
                      <ChevronRight
                        size={14}
                        className="shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100"
                      />
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
