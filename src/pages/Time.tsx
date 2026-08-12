import { useMemo, useState } from "react";
import { Clock, Play, Square, Trash2, CalendarDays, Users } from "lucide-react";
import { PageHeader, Badge } from "@/components/ui";
import {
  entrySeconds, useMyRole, useTasks, useTimeEntries, useTimeMutations, useWorkspaceMembers, workDate,
} from "@/data/hooks";
import type { TimeEntry } from "@/types/db";
import { useNow } from "@/hooks/useNow";

/** 3725 -> "1h 02m". Minutes are what a timesheet is read in; seconds are noise. */
function hm(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

/** The running clock, where seconds DO matter — it is the proof it is running. */
function hms(seconds: number): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(seconds / 3600))}:${p(Math.floor((seconds % 3600) / 60))}:${p(seconds % 60)}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDay(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${MONTHS[Number(m) - 1]} ${Number(d)}`;
}

/**
 * Cutoff periods, 1st-15th and 16th-end. This is how MadeEA already pays, so
 * the totals HR needs (R-4.5.5) line up with the payslip without arithmetic.
 */
function cutoffOf(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return Number(d) <= 15 ? `${y}-${String(m).padStart(2, "0")}-A` : `${y}-${String(m).padStart(2, "0")}-B`;
}
function cutoffLabel(key: string): string {
  const [y, m, half] = key.split("-");
  return `${MONTHS[Number(m) - 1]} ${half === "A" ? "1–15" : "16–end"} ${y}`;
}

export default function Time() {
  const { data: entries = [] } = useTimeEntries();
  const { data: tasks = [] } = useTasks();
  const { data: members = [] } = useWorkspaceMembers();
  const { data: role } = useMyRole();
  const { start, stop, remove } = useTimeMutations();
  const isAdmin = role === "admin";

  // Ticks once a second, but only while a timer is actually running.
  const running = entries.find((e) => !e.ended_at);
  const now = useNow(running ? 1000 : null);

  const [taskId, setTaskId] = useState("");
  const [note, setNote] = useState("");

  const today = workDate();
  /* No client-side ownership filter. The RLS policy in 0027 already returns
     your rows, or everyone's if you are an admin, so filtering again here would
     either duplicate the rule or quietly disagree with it. */
  const mine = entries;

  const todaySeconds = useMemo(
    () => entries.filter((e) => e.work_date === today).reduce((a, e) => a + entrySeconds(e, now), 0),
    [entries, today, now],
  );

  /** Days worked, newest first — the EA's own timesheet. */
  const byDay = useMemo(() => {
    const map = new Map<string, TimeEntry[]>();
    for (const e of mine) {
      const list = map.get(e.work_date) ?? [];
      list.push(e);
      map.set(e.work_date, list);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [mine]);

  /** Totals per cutoff period — what a payslip is calculated from. */
  const byCutoff = useMemo(() => {
    const map = new Map<string, { seconds: number; days: Set<string> }>();
    for (const e of mine) {
      const k = cutoffOf(e.work_date);
      const cur = map.get(k) ?? { seconds: 0, days: new Set<string>() };
      cur.seconds += entrySeconds(e, now);
      cur.days.add(e.work_date);
      map.set(k, cur);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [mine, now]);

  const openTasks = tasks.filter((t) => t.status !== "done");

  return (
    <div>
      <PageHeader
        title="Time"
        subtitle="Clock in to start your day. Attendance is recorded from this — no tracker, no attendance."
      />

      {/* ---- the clock ---- */}
      <section className="card mb-5 p-5">
        {running ? (
          <div className="flex flex-wrap items-center gap-4">
            <div>
              <p className="eyebrow mb-1">Running since {new Date(running.started_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
              <p className="text-3xl font-bold tabular-nums text-accent">{hms(entrySeconds(running, now))}</p>
              <p className="mt-1 text-sm text-muted">
                {running.task_title ? running.task_title : running.note?.trim() ? running.note : "No task selected"}
              </p>
            </div>
            <button className="btn-primary ml-auto" onClick={() => stop.mutate(running.id)} disabled={stop.isPending}>
              <Square size={15} /> Clock out
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[200px] flex-1">
              <label className="field-label" htmlFor="time-task">What are you working on? (optional)</label>
              <select id="time-task" className="input" value={taskId} onChange={(e) => setTaskId(e.target.value)}>
                <option value="">— No specific task —</option>
                {openTasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
              </select>
            </div>
            <div className="min-w-[200px] flex-1">
              <label className="field-label" htmlFor="time-note">Note (optional)</label>
              <input id="time-note" className="input" placeholder="e.g. inbox triage" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <button
              className="btn-primary shrink-0"
              onClick={() => { start.mutate({ task_id: taskId || null, note: note.trim() || null }); setNote(""); }}
              disabled={start.isPending}
            >
              <Play size={15} /> Clock in
            </button>
          </div>
        )}
        <p className="mt-3 flex items-center gap-1.5 text-xs text-faint">
          <Clock size={12} /> Today: <strong className="text-zinc-200">{hm(todaySeconds)}</strong>
          {todaySeconds === 0 && " — nothing logged yet, so today counts as absent."}
        </p>
      </section>

      {/* ---- cutoff totals (R-4.5.5) ---- */}
      {byCutoff.length > 0 && (
        <section className="card mb-5 p-5">
          <h2 className="mb-3 flex items-center gap-2 font-semibold"><CalendarDays size={15} className="text-accent" /> Payroll cutoffs</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {byCutoff.slice(0, 6).map(([k, v]) => (
              <div key={k} className="rounded-lg bg-surface-2 p-3">
                <p className="eyebrow mb-1">{cutoffLabel(k)}</p>
                <p className="text-xl font-bold tabular-nums">{hm(v.seconds)}</p>
                <p className="text-xs text-faint">{v.days.size} day{v.days.size === 1 ? "" : "s"} attended</p>
              </div>
            ))}
          </div>
          {isAdmin && (
            <p className="mt-3 flex items-center gap-1.5 text-xs text-faint">
              <Users size={12} /> You are an admin, so these totals cover everyone who has logged time.
            </p>
          )}
        </section>
      )}

      {/* ---- the timesheet ---- */}
      <section className="card p-5">
        <h2 className="mb-3 font-semibold">Timesheet</h2>
        {byDay.length === 0 && (
          <p className="text-sm text-faint">
            Nothing logged yet. Clock in above and the day appears here — and in your attendance.
          </p>
        )}
        <div className="space-y-4">
          {byDay.slice(0, 30).map(([day, rows]) => {
            const total = rows.reduce((a, e) => a + entrySeconds(e, now), 0);
            return (
              <div key={day}>
                <div className="mb-1.5 flex items-center gap-2">
                  <p className="eyebrow">{fmtDay(day)}</p>
                  {day === today && <Badge tone="normal">Today</Badge>}
                  <span className="ml-auto text-sm font-semibold tabular-nums">{hm(total)}</span>
                </div>
                <div className="space-y-1">
                  {rows.map((e) => (
                    <div key={e.id} className="group flex items-center gap-3 rounded-lg bg-surface-2 px-3 py-2">
                      <span className="w-[104px] shrink-0 text-xs tabular-nums text-faint">
                        {new Date(e.started_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        {" – "}
                        {e.ended_at ? new Date(e.ended_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "now"}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {e.task_title ?? e.note ?? <span className="text-faint">Untitled</span>}
                      </span>
                      {!e.ended_at && <Badge tone="urgent">Running</Badge>}
                      <span className="shrink-0 text-sm tabular-nums">{hm(entrySeconds(e, now))}</span>
                      <button
                        className="shrink-0 text-faint opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
                        onClick={() => remove.mutate(e.id)}
                        aria-label="Delete entry"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        {members.length > 0 && isAdmin && (
          <p className="mt-4 border-t border-border pt-3 text-xs text-faint">
            Screenshots and activity monitoring are deliberately not built. Whether the tracker
            should watch behaviour as well as hours is still an open decision (OQ-5).
          </p>
        )}
      </section>
    </div>
  );
}
