import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { CircleDot, Clock } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { dateOnly, hm, localDayKey } from "./format";

/**
 * Daily reports, in the shape of the agency's EOD: Done today, Blockers, Plan
 * for tomorrow.
 *
 * WHY THIS DOES NOT READ eod_reports. An EA's EOD covers every client they
 * worked on that day and carries no client_id (see ClientActivity). Showing it
 * here would show other accounts' work. So each report is rebuilt from this
 * account's own rows only: hours from client_days, completed tasks, and the
 * open tasks as they stand now.
 *
 * WHY BLOCKERS AND PLANS ONLY APPEAR ON THE LATEST DAY. Nothing records what was
 * blocked or planned on a past day, only what is blocked and open now. Putting
 * today's state on last Tuesday's card would be inventing history.
 */

interface DayRow {
  work_date: string;
  minutes: number;
  sessions: number;
  first_started_at: string | null;
  last_ended_at: string | null;
  running: boolean;
  captures: number;
}

interface TaskRow {
  id: string;
  title: string;
  status: "todo" | "in_progress" | "follow_up" | "review" | "done";
  due_at: string | null;
  due_label: string | null;
  blocked: boolean | null;
  client_visible_blocker: string | null;
  completed_at: string | null;
}

interface Report {
  key: string;
  date: Date;
  day: DayRow | null;
  done: TaskRow[];
}

const WINDOW_DAYS = 14;

/* "Tuesday, 6 October" whatever the browser locale's own order is. Built from
   parts because en-US would say "Tuesday, October 6" and the portal reads
   British everywhere else. */
function longDate(d: Date): string {
  const weekday = d.toLocaleDateString("en-GB", { weekday: "long" });
  const day = d.getDate();
  const month = d.toLocaleDateString("en-GB", { month: "long" });
  return `${weekday}, ${day} ${month}`;
}

function windowStartKey(): string {
  const d = new Date();
  d.setDate(d.getDate() - (WINDOW_DAYS - 1));
  return localDayKey(d.toISOString());
}

export function ClientReports() {
  /* Same keys and same queries as Activity and Overview, so switching tabs
     reads from the cache instead of asking again. */
  const { data: days = [], isLoading: loadingDays } = useQuery({
    queryKey: ["client-portal", "days"],
    queryFn: async () => {
      const { data, error } = await supabase!
        .from("client_days")
        .select("work_date, minutes, sessions, first_started_at, last_ended_at, running, captures")
        .order("work_date", { ascending: false })
        .limit(30);
      if (error) throw error;
      return (data ?? []) as DayRow[];
    },
  });

  const { data: tasks = [], isLoading: loadingTasks } = useQuery({
    queryKey: ["client-portal", "tasks"],
    queryFn: async () => {
      const { data, error } = await supabase!
        .from("client_tasks")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as TaskRow[];
    },
  });

  const reports = useMemo<Report[]>(() => {
    const from = windowStartKey();
    const byKey = new Map<string, Report>();

    for (const row of days) {
      if (row.work_date < from) continue;
      byKey.set(row.work_date, { key: row.work_date, date: dateOnly(row.work_date), day: row, done: [] });
    }

    /* Grouped by the reader's own day, same as Activity, so a task finished at
       11pm lands on the day the client lived through. */
    for (const t of tasks) {
      if (!t.completed_at) continue;
      const key = localDayKey(t.completed_at);
      if (key < from) continue;
      const r = byKey.get(key) ?? { key, date: dateOnly(key), day: null, done: [] };
      r.done.push(t);
      byKey.set(key, r);
    }

    // A clocked day with zero minutes and nothing done is not a report.
    return [...byKey.values()]
      .filter((r) => r.done.length > 0 || (r.day && (Number(r.day.minutes) > 0 || r.day.running)))
      .sort((a, b) => b.key.localeCompare(a.key));
  }, [days, tasks]);

  const { blockers, plan } = useMemo(() => {
    const open = tasks.filter((t) => t.status !== "done");
    const blockers = open.filter((t) => t.blocked && t.client_visible_blocker);
    const soon = Date.now() + 2 * 86_400_000;
    /* In progress, or due within two days. Overdue counts as due: it is still
       the next thing to do, and leaving it off would flatter the plan. */
    const plan = open.filter(
      (t) => t.status === "in_progress" || (t.due_at && new Date(t.due_at).getTime() <= soon),
    );
    return { blockers, plan };
  }, [tasks]);

  if (loadingDays || loadingTasks) {
    return <p className="text-sm text-faint">Loading…</p>;
  }

  if (reports.length === 0) {
    return (
      <div className="card p-5">
        <p className="text-sm text-muted">
          No reports yet. They appear here at the end of each day your assistant works on your account.
        </p>
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-4">
      {reports.map((r, i) => {
        const latest = i === 0;
        return (
          <article
            key={r.key}
            className={cn(
              "card min-w-0 overflow-hidden",
              latest && blockers.length > 0 && "border-amber-500/40",
            )}
          >
            <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border px-4 py-3">
              <h3 className="min-w-0 flex-1 text-sm font-semibold">{longDate(r.date)}</h3>
              <span className="flex items-center gap-1.5 text-xs text-muted">
                <Clock size={13} />
                {r.day && Number(r.day.minutes) > 0 ? hm(Number(r.day.minutes)) : "No hours logged"}
              </span>
              {r.day?.running ? (
                <span className="pill flex items-center gap-1 bg-accent/15 text-[11px] text-accent-soft">
                  <CircleDot size={11} /> Still working
                </span>
              ) : null}
            </header>

            <div className="space-y-4 px-4 py-3">
              <Section title="Done today" dot="bg-emerald-400" empty="Nothing completed this day.">
                {r.done.map((t) => <Line key={t.id}>{t.title}</Line>)}
              </Section>

              {latest && blockers.length > 0 ? (
                <Section title="Blockers" dot="bg-amber-400">
                  {blockers.map((t) => (
                    <Line key={t.id} className="text-amber-400">
                      Waiting on you: {t.title}
                      {t.client_visible_blocker && t.client_visible_blocker !== t.title ? (
                        <span className="block text-xs text-muted">{t.client_visible_blocker}</span>
                      ) : null}
                    </Line>
                  ))}
                </Section>
              ) : null}

              {latest && plan.length > 0 ? (
                <Section title="Plan for tomorrow" dot="bg-sky-400">
                  {plan.map((t) => (
                    <Line key={t.id}>
                      {t.title}
                      {t.due_label ? <span className="text-xs text-faint"> · {t.due_label}</span> : null}
                    </Line>
                  ))}
                </Section>
              ) : null}
            </div>
          </article>
        );
      })}

      <p className="text-xs text-faint">
        Built from the work on your account: tasks completed, hours and open items.
      </p>
    </div>
  );
}

function Section({
  title, dot, empty, children,
}: {
  title: string;
  dot: string;
  empty?: string;
  children: React.ReactNode[];
}) {
  return (
    <div>
      <p className="eyebrow mb-1.5">{title}</p>
      {children.length > 0 ? (
        <ul className="space-y-1">
          {children.map((c, i) => (
            <li key={i} className="flex min-w-0 gap-2 text-sm">
              <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-sm", dot)} />
              {c}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-faint">{empty}</p>
      )}
    </div>
  );
}

function Line({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("min-w-0 break-words", className)}>{children}</span>;
}
