import { entrySeconds, workDate } from "@/data/hooks";
import { supabase } from "@/lib/supabase";
import { updateDemoTime } from "@/store/demoTime";
import { dayTotal, type BreakRule } from "@/lib/breakDeduction";
import { lines, obj, runQuickAction, str } from "@/lib/quickAi";
import type { Task, TimeEntry } from "@/types/db";

/**
 * The Time tracker's ✦ quick actions (Abder's "AI quick actions and cost"
 * deck, 6 Nov 2026): "hours without surprises". Every total is worked out
 * here, in code, with the same per-day break rule as the timesheet, so the
 * card and the page can never disagree. The AI only puts them into words.
 *
 * Expected hours come from the workspace's time policy (Settings, daily_hours,
 * read by useTimeSettings), over Monday to Friday. The app keeps no holiday or
 * leave calendar, so only weekends are skipped; 8 hours a day is the default
 * when nothing is set, the same fallback the page itself uses.
 */

/** 30720 -> "8:32", as on the timesheet. */
export function hm(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`;
}

const p2 = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const parse = (day: string) => new Date(`${day}T00:00:00`);
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-11-03" -> "Tue 3 Nov". */
export const dayLabel = (day: string) => { const d = parse(day); return `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`; };
export const isWorkingDay = (day: string) => { const w = parse(day).getDay(); return w !== 0 && w !== 6; };

/** Every day from lo to hi, inclusive. */
function daysBetween(lo: string, hi: string): string[] {
  const out: string[] = [];
  for (const d = parse(lo); iso(d) <= hi; d.setDate(d.getDate() + 1)) out.push(iso(d));
  return out;
}

/** Net seconds per work_date, after the automatic break (lib/breakDeduction). */
export function netByDay(entries: TimeEntry[], now: number, rule: BreakRule | null): Map<string, number> {
  const days = new Map<string, TimeEntry[]>();
  for (const e of entries) days.set(e.work_date, [...(days.get(e.work_date) ?? []), e]);
  const out = new Map<string, number>();
  for (const [day, rows] of days) out.set(day, dayTotal(rows, rows.reduce((a, e) => a + entrySeconds(e, now), 0), rule).net);
  return out;
}

/** Monday of the week that holds `day`. */
export function mondayOf(day: string): string {
  const d = parse(day);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return iso(d);
}

/* ─────────────────────────── 1. Summarize my week ─────────────────────────── */

export interface WeekFacts {
  logged: number;
  expected: number;
  shifts: number;
  clients: { name: string; seconds: number }[];
  /** Working days before today that fell short of the day's hours. */
  below: { day: string; seconds: number }[];
  overtime: number;
}

export function weekFacts(opts: {
  entries: TimeEntry[]; today: string; now: number; dailySeconds: number; rule: BreakRule | null;
  clientName: (id: string | null | undefined, fallback?: string | null) => string;
}): WeekFacts {
  const lo = mondayOf(opts.today);
  const end = parse(lo); end.setDate(end.getDate() + 6);
  const hi = iso(end);
  const week = opts.entries.filter((e) => e.work_date >= lo && e.work_date <= hi);
  const byDay = netByDay(week, opts.now, opts.rule);
  const logged = [...byDay.values()].reduce((a, s) => a + s, 0);

  /* By client, shared out in proportion to each session's share of its day,
     so the client figures add up to the net total (break included). */
  const perClient = new Map<string, number>();
  for (const [day, net] of byDay) {
    const rows = week.filter((e) => e.work_date === day);
    const raw = rows.reduce((a, e) => a + entrySeconds(e, opts.now), 0);
    for (const e of rows) {
      const name = opts.clientName(e.client_id, e.client_name);
      perClient.set(name, (perClient.get(name) ?? 0) + (raw ? (entrySeconds(e, opts.now) / raw) * net : 0));
    }
  }
  const clients = [...perClient].map(([name, seconds]) => ({ name, seconds })).sort((a, b) => b.seconds - a.seconds);

  const all = daysBetween(lo, hi);
  // Today is still in progress, so it can't be "below target" yet.
  const below = all
    .filter((d) => isWorkingDay(d) && d < opts.today && (byDay.get(d) ?? 0) < opts.dailySeconds)
    .map((d) => ({ day: d, seconds: byDay.get(d) ?? 0 }));
  // Anything past a day's hours; a weekend expects none, so all of it counts.
  const overtime = all.reduce((a, d) => a + Math.max(0, (byDay.get(d) ?? 0) - (isWorkingDay(d) ? opts.dailySeconds : 0)), 0);
  return { logged, expected: all.filter(isWorkingDay).length * opts.dailySeconds, shifts: week.length, clients, below, overtime };
}

export interface WeekRow { label: string; value: string; note: string }
export interface WeekAnswer { summary: string; rows: WeekRow[] }

/** The rows, worked out in code: the AI may only reword the notes. */
function weekRows(f: WeekFacts): WeekRow[] {
  const rows: WeekRow[] = f.clients.slice(0, 3).map((c) => ({
    label: c.name,
    value: hm(c.seconds),
    note: f.logged ? `${Math.round((c.seconds / f.logged) * 100)}% of this week's hours` : "",
  }));
  if (f.below.length) rows.push({
    label: "Days below target",
    value: `${f.below.length} ${f.below.length === 1 ? "day" : "days"}`,
    note: f.below.slice(0, 3).map((b) => `${dayLabel(b.day)} ${hm(b.seconds)}`).join(", "),
  });
  if (f.overtime >= 60) rows.push({ label: "Overtime", value: hm(f.overtime), note: "" });
  return rows.slice(0, 5);
}

export const WEEK_EMPTY = "No shifts logged this week.";

export async function runWeekSummary(f: WeekFacts) {
  const rows = weekRows(f);
  const lead = `${hm(f.logged)} of ${hm(f.expected)} this week.`;
  return runQuickAction<WeekAnswer>({
    tool: "time_week",
    format: "Summarize my week",
    page: "/time",
    inputs: {
      Logged: hm(f.logged),
      Expected: `${hm(f.expected)} (Monday to Friday)`,
      Shifts: String(f.shifts),
      "Hours by client": lines(f.clients.slice(0, 3).map((c) => `${c.name}: ${hm(c.seconds)}`)),
      "Days below target": f.below.length ? lines(f.below.map((b) => `${dayLabel(b.day)}: ${hm(b.seconds)}`)) : "none",
      Overtime: hm(f.overtime),
      Rows: lines(rows.map((r) => `${r.label} | value: ${r.value} | ${r.note}`)),
    },
    /* The figures are ours: whatever comes back, the values stay as computed
       and only the summary's tail and the notes are taken from the model. */
    check: (v) => {
      const o = obj(v);
      const said = Array.isArray(o.rows) ? (o.rows as unknown[]).map((r) => obj(r)) : [];
      const note = (label: string, fallback: string) => {
        const hit = said.find((r) => str(r.label).toLowerCase() === label.toLowerCase());
        return hit ? str(hit.note, 80) : fallback;
      };
      const summary = str(o.summary, 160);
      return {
        summary: summary.startsWith(lead) ? summary : lead,
        rows: rows.map((r) => ({ ...r, note: note(r.label, r.note) })),
      };
    },
    demo: () => {
      const gap = f.expected - f.logged;
      const tail = gap > 0 ? ` ${hm(gap)} to go.` : gap < 0 ? ` ${hm(-gap)} over.` : " On target.";
      return { summary: lead + tail, rows };
    },
  });
}

/* ─────────────────────────── 2. Check missing hours ─────────────────────────── */

export interface MissingRow { day: string; seconds: number; expected: number }

/**
 * Working days in [lo, hi] with no shift or a short one. Today is left out
 * while it is still going (a short day isn't missing until it's over), and
 * so is anything in the future. Weekends are skipped; there is no holiday or
 * leave data in the app to skip as well.
 */
export function findMissingHours(opts: {
  entries: TimeEntry[]; lo: string; hi: string; today: string; now: number; dailySeconds: number; rule: BreakRule | null;
}): MissingRow[] {
  const byDay = netByDay(opts.entries.filter((e) => e.work_date >= opts.lo && e.work_date <= opts.hi), opts.now, opts.rule);
  return daysBetween(opts.lo, opts.hi)
    .filter((d) => d < opts.today && isWorkingDay(d))
    .map((d) => ({ day: d, seconds: byDay.get(d) ?? 0, expected: opts.dailySeconds }))
    // Five minutes' grace, so a day clocked out at 7:56 isn't flagged.
    .filter((r) => r.seconds < r.expected - 300)
    .sort((a, b) => b.day.localeCompare(a.day));
}

export const MISSING_EMPTY = "No missing hours this period.";

/** The pre-filled correction request for an admin. */
export function correctionMessage(r: MissingRow, name?: string): string {
  return `Hi, could you check my timesheet for ${dayLabel(r.day)}? It shows ${hm(r.seconds)} of ${hm(r.expected)}. ` +
    `I worked [start time] to [end time] that day; [reason the clock-in was missed]. Please add the missing time if that's OK.` +
    (name ? ` Thanks, ${name.split(" ")[0]}` : " Thanks");
}

/* ─────────────────────────── 3. Write shift note ─────────────────────────── */

const sameDay = (ts: string | null | undefined, day: string) => {
  if (!ts) return false;
  const d = new Date(ts);
  return !Number.isNaN(d.getTime()) && iso(d) === day;
};

export interface WorkedTask { task: Task; done: boolean }

/** Your tasks for this client that moved today: completed, updated or given a progress note. */
export function tasksWorkedToday(tasks: Task[], myId: string | undefined, clientId: string, day: string = workDate()): WorkedTask[] {
  if (!myId || !clientId) return [];
  return tasks
    .filter((t) => (t.assignee_id ?? t.owner_id) === myId && t.client_id === clientId)
    .filter((t) => sameDay(t.completed_at, day) || sameDay(t.updated_at, day) || (t.progress ?? []).some((p) => sameDay(p.at, day)))
    .map((t) => ({ task: t, done: t.status === "done" && sameDay(t.completed_at, day) }))
    .slice(0, 12);
}

export const NOTE_EMPTY = "No task activity today to summarize.";
const words = (s: string, n: number) => s.split(/\s+/).filter(Boolean).slice(0, n).join(" ");

export async function runShiftNote(clientName: string, worked: WorkedTask[], day: string) {
  return runQuickAction<{ note: string }>({
    tool: "time_shift_note",
    format: "Write shift note",
    page: "/time",
    inputs: {
      Client: clientName,
      Today: dayLabel(day),
      "Tasks worked on today": lines(worked.map((w, i) => {
        const today = (w.task.progress ?? []).filter((p) => sameDay(p.at, day)).map((p) => p.body).join("; ");
        return `T${i + 1} | ${w.task.title} | ${w.done ? "completed today" : `status: ${w.task.status.replace("_", " ")}`}${today ? ` | progress: ${today.slice(0, 160)}` : ""}`;
      })),
    },
    check: (v) => {
      const note = words(str(obj(v).note, 300), 30);
      if (!note) throw new Error("Madeline couldn't write a note. Try again.");
      return { note };
    },
    demo: () => {
      const done = worked.filter((w) => w.done).map((w) => w.task.title);
      const other = worked.filter((w) => !w.done).map((w) => w.task.title);
      const parts = [done.length ? `Completed ${done.slice(0, 2).join(" and ")}` : "", other.length ? `worked on ${other.slice(0, 2).join(" and ")}` : ""].filter(Boolean);
      const s = parts.join("; ");
      return { note: words(s.charAt(0).toUpperCase() + s.slice(1), 29).replace(/[.;,]$/, "") + "." };
    },
  });
}

/**
 * Save the running shift's note. The database guard (0041) lets an EA change
 * only an open session, and only its non-time columns, which is exactly this.
 */
export async function saveShiftNote(id: string, note: string): Promise<void> {
  const value = note.trim() || null;
  if (!supabase) { updateDemoTime(id, { note: value }); return; }
  const { error } = await supabase.from("time_entries").update({ note: value }).eq("id", id);
  if (error) throw error;
}
