import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Camera, CheckCircle2, Clock, CircleDot } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { clockTime, dateOnly, dayLabel, hm, localDayKey } from "./format";

/**
 * "What has my assistant actually done?" — answered per day.
 *
 * ═══ THIS IS NOT THE EOD REPORT, AND THE DIFFERENCE MATTERS ══════════════
 *
 * The 14 Sep call asked for the client to track their assistant's progress,
 * and the word used was the EOD. This pane deliberately does not read
 * eod_reports, because that table cannot answer the question safely: one
 * report per person per day covers every client that assistant touched
 * (0012), and there is no client_id on it to slice by. Publishing one to a
 * client publishes the others' work.
 *
 * So the day is rebuilt from the two things that ARE tagged by client:
 * completed tasks and time entries. Nothing untagged is ever read, which is
 * why no line here can belong to another account. The eventual answer is
 * per-line client tagging on the EOD form itself; when that lands, this pane
 * gains the assistant's own words and loses nothing else.
 *
 * ═══ WHY THE CAPTURES ARE A NUMBER AND NOT A GALLERY ═════════════════════
 *
 * The call said the client sees the screenshots. What they need from them is
 * proof the assistant was at the desk, and the count delivers that. The images
 * cannot: a capture taken on this client's time still shows whatever else was
 * on the monitor, and no row-level rule reaches inside a picture (0065).
 * client_days has no storage_path column, so there is nothing here to leak.
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

interface DoneTask {
  id: string;
  title: string;
  completed_at: string | null;
  requested_by_client: boolean;
}

interface Day {
  key: string;
  date: Date;
  row: DayRow | null;
  done: DoneTask[];
}

export function ClientActivity() {
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

  const { data: done = [], isLoading: loadingTasks } = useQuery({
    queryKey: ["client-portal", "completed"],
    queryFn: async () => {
      const { data, error } = await supabase!
        .from("client_tasks")
        .select("id, title, completed_at, requested_by_client")
        .not("completed_at", "is", null)
        .order("completed_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as DoneTask[];
    },
  });

  /* Grouped in the browser rather than in SQL on purpose. work_date is a date
     the assistant's machine decided; completed_at is an instant. Matching them
     in Postgres means picking a timezone to do it in, and the server's is the
     one frame of reference that belongs to nobody in this conversation. Here,
     both land in the reader's own day. */
  const grouped = useMemo<Day[]>(() => {
    const byKey = new Map<string, Day>();

    for (const row of days) {
      byKey.set(row.work_date, {
        key: row.work_date,
        date: dateOnly(row.work_date),
        row,
        done: [],
      });
    }

    for (const t of done) {
      if (!t.completed_at) continue;
      const key = localDayKey(t.completed_at);
      const day = byKey.get(key);
      if (day) {
        day.done.push(t);
      } else {
        /* A task finished on a day with no clocked time. It still happened,
           and dropping it would make the record quieter than the truth. */
        byKey.set(key, { key, date: dateOnly(key), row: null, done: [t] });
      }
    }

    return [...byKey.values()].sort((a, b) => b.key.localeCompare(a.key));
  }, [days, done]);

  if (loadingDays || loadingTasks) {
    return <p className="text-faint text-sm">Loading…</p>;
  }

  if (grouped.length === 0) {
    return (
      <div className="">
        <p className="text-faint text-sm">
          Nothing has been logged against your account yet. Once your assistant starts
          work, each day appears here with what moved and how long it took.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-faint text-sm">
        Each working day on your account: what your assistant completed, how long they
        were clocked in, and the monitoring captures held on file for that session.
      </p>

      {grouped.map((day) => (
        <section
          key={day.key}
          className="rounded-lg bg-surface-2 p-3"
        >
          <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h3 className="text-sm font-semibold">{dayLabel(day.date)}</h3>
            {day.row ? (
              <div className="text-faint flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <span className="flex items-center gap-1.5">
                  <Clock size={13} />
                  {hm(Number(day.row.minutes))}
                </span>
                {day.row.first_started_at ? (
                  <span>
                    {clockTime(day.row.first_started_at)}
                    {" – "}
                    {day.row.running
                      ? "now"
                      : day.row.last_ended_at
                        ? clockTime(day.row.last_ended_at)
                        : "—"}
                  </span>
                ) : null}
                <span>
                  {day.row.sessions} session{day.row.sessions === 1 ? "" : "s"}
                </span>
                {day.row.captures > 0 ? (
                  <span className="flex items-center gap-1.5">
                    <Camera size={13} />
                    {day.row.captures} capture{day.row.captures === 1 ? "" : "s"}
                  </span>
                ) : null}
                {day.row.running ? (
                  <span className="flex items-center gap-1.5" style={{ color: "var(--c-accent)" }}>
                    <CircleDot size={13} /> Working now
                  </span>
                ) : null}
              </div>
            ) : (
              <span className="text-faint text-xs">No time clocked</span>
            )}
          </header>

          {day.done.length > 0 ? (
            <ul className="mt-3 space-y-1.5">
              {day.done.map((t) => (
                <li key={t.id} className="flex items-start gap-2.5 text-sm">
                  <CheckCircle2
                    size={15}
                    className="mt-0.5 shrink-0"
                    style={{ color: "var(--c-accent)" }}
                  />
                  <span className="min-w-0">
                    {t.title}
                    {t.requested_by_client ? (
                      <span className="text-faint text-xs"> · you asked for this</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            /* Time logged and nothing closed is a real day, not a gap. Saying so
               is better than an empty card that reads like a loading failure. */
            <p className="text-faint mt-2 text-sm">
              Time logged on your account, with nothing closed out on the day.
            </p>
          )}
        </section>
      ))}

      <p className="text-faint text-xs">
        Monitoring captures are taken automatically during clocked sessions and held on
        file by the agency. Ask your assistant if you need to review any of them.
      </p>
    </div>
  );
}
