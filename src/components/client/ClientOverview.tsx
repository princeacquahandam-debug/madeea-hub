import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Clock, CheckCircle2, Circle, Loader2, Plus, AlertTriangle, ArrowRight, CalendarDays, Video,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { dayLabel, hm, localDayKey } from "./format";

/**
 * The front page of the client portal: where the account stands, right now.
 *
 * Every read here goes through a VIEW, never a table. `client_tasks` and
 * `client_days` list their columns by name, so a column added to `tasks` or
 * `time_entries` later is not published to clients by accident — see 0072.
 *
 * SCOPE. This pane answers "what is open, what needs me, and what can I ask
 * for?". The day by day record of what was finished moved to ClientActivity
 * when 0073 added the digest, because the two answer different questions and
 * one long scroll answered neither well. The full set of tasks lives on the
 * board (ClientBoard); this list is the open ones only.
 *
 * The shape echoes the agency Dashboard on purpose: one sentence that says how
 * things are, the KPI tiles, then the panels that want attention first. A
 * client who has used the agency side, or watched their assistant use it,
 * should not have to learn a second layout.
 *
 * Still deliberately absent, and 0073 says why at length: the EOD report itself
 * (one report covers every client that assistant touched) and the screenshot
 * images (a photograph of a monitor shows whoever else was on it). Activity
 * carries the accountability both were asked for.
 */

interface Overview {
  client_name: string;
  company: string | null;
  assistant_name: string | null;
  assistant_initials: string | null;
}

interface DayRow {
  work_date: string;
  minutes: number;
}

interface TaskRow {
  id: string;
  title: string;
  status: "todo" | "in_progress" | "follow_up" | "review" | "done";
  priority: string;
  due_label: string | null;
  due_at: string | null;
  blocked: boolean;
  client_visible_blocker: string | null;
  completed_at: string | null;
  created_at: string;
  requested_by_client: boolean;
}

interface EventRow {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  location: string | null;
  event_timezone: string | null;
  hangout_link: string | null;
}

// The agency board's labels and dots (Tasks.tsx COLUMNS), so a status reads
// the same here as on the client's own board.
const STATUS: Record<TaskRow["status"], { label: string; dot: string }> = {
  todo:        { label: "To Do",       dot: "bg-sky-400" },
  in_progress: { label: "In Progress", dot: "bg-amber-400" },
  follow_up:   { label: "Follow-up",   dot: "bg-rose-400" },
  review:      { label: "Review",      dot: "bg-violet-400" },
  done:        { label: "Done",        dot: "bg-emerald-400" },
};

const OPEN_LIMIT = 6;
const MEETINGS_LIMIT = 3;

const waitingOnClient = (t: TaskRow) => t.blocked && !!t.client_visible_blocker;

/** "3:00 PM", in the reader's own zone. A client reads a 12-hour clock. */
function time12(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12: true });
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function ClientOverview({
  onSeeActivity,
  readOnly = false,
}: {
  onSeeActivity: () => void;
  /* A viewer reads the account and cannot ask for work (0074). The RPC refuses
     them anyway; this is so they are not offered a box that only ever errors. */
  readOnly?: boolean;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [error, setError] = useState("");

  const { data: overview } = useQuery({
    queryKey: ["client-portal", "overview"],
    queryFn: async () => {
      const { data, error } = await supabase!.from("client_overview").select("*").maybeSingle();
      if (error) throw error;
      return data as Overview | null;
    },
  });

  /* Seven days, because the only thing read off this is the seven-day total.
     Activity is where the per-day record lives, and it asks for its own. */
  const { data: days = [] } = useQuery({
    queryKey: ["client-portal", "week"],
    queryFn: async () => {
      const { data, error } = await supabase!
        .from("client_days")
        .select("work_date, minutes")
        .order("work_date", { ascending: false })
        .limit(7);
      if (error) throw error;
      return (data ?? []) as DayRow[];
    },
  });

  // Same key and query as ClientBoard, so the board opens already filled.
  const { data: tasks = [] } = useQuery({
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

  /* Same key and query as ClientCalendar, so the two share one cache entry. A
     different select under the same key would hand that pane rows of the wrong
     shape, which is why this is a copy and not a narrower read. */
  const { data: events = [] } = useQuery({
    queryKey: ["client-portal", "calendar"],
    queryFn: async () => {
      const from = new Date();
      from.setHours(0, 0, 0, 0);
      const { data, error } = await supabase!
        .from("client_calendar")
        .select("id, title, starts_at, ends_at, all_day, location, event_timezone, hangout_link")
        .gte("starts_at", from.toISOString())
        .order("starts_at", { ascending: true })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as EventRow[];
    },
  });

  const totals = useMemo(() => {
    const last7 = days.reduce((n, r) => n + Number(r.minutes ?? 0), 0);
    const open = tasks.filter((t) => t.status !== "done").length;
    const done = tasks.filter((t) => t.status === "done").length;
    return { last7, open, done };
  }, [days, tasks]);

  const waiting = useMemo(
    () => tasks.filter((t) => t.status !== "done" && waitingOnClient(t)),
    [tasks],
  );

  /* Still on, or still to come. A call that started ten minutes ago is the
     one the client most likely opened this page to join. */
  const upcoming = useMemo(() => {
    const now = Date.now();
    const todayKey = localDayKey(new Date().toISOString());
    return events.filter((e) =>
      e.all_day
        ? localDayKey(e.starts_at) >= todayKey
        : new Date(e.ends_at ?? e.starts_at).getTime() >= now);
  }, [events]);

  // The reader's local day, not the database's: "today" is theirs.
  const doneToday = useMemo(() => {
    const todayKey = localDayKey(new Date().toISOString());
    return tasks
      .filter((t) => t.status === "done" && t.completed_at && localDayKey(t.completed_at) === todayKey)
      .sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""));
  }, [tasks]);

  const openTasks = useMemo(() => tasks.filter((t) => t.status !== "done"), [tasks]);
  const inProgress = tasks.filter((t) => t.status === "in_progress").length;

  const summary = useMemo(() => {
    const work = `${inProgress ? plural(inProgress, "task") : "nothing"} in progress and ${
      waiting.length ? `${waiting.length} waiting on you` : "nothing waiting on you"}`;
    const first = overview?.assistant_name
      ? `Your assistant, ${overview.assistant_name}, has ${work}.`
      : `No assistant is assigned to your account yet. You have ${work}.`;
    const meetings = upcoming.length
      ? `${plural(upcoming.length, "meeting")} coming up.`
      : "No meetings coming up.";
    return `${first} ${meetings}`;
  }, [overview, inProgress, waiting.length, upcoming.length]);

  const request = useMutation({
    mutationFn: async () => {
      const { error } = await supabase!.rpc("client_create_task", {
        p_title: title.trim(),
        p_due_label: due.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setTitle("");
      setDue("");
      qc.invalidateQueries({ queryKey: ["client-portal", "tasks"] });
    },
  });

  async function submit() {
    if (!title.trim() || request.isPending) return;
    setError("");
    try {
      await request.mutateAsync();
    } catch (e) {
      // The typed request survives a failure; the ceiling in 0072 explains
      // itself, so whatever the database said is what gets shown.
      setError(e instanceof Error ? e.message : "Could not send that request.");
    }
  }

  return (
    <div className="space-y-6">
      {/* The shell already prints "Overview"; this is the Dashboard's
          "your day at a glance" line, with the numbers in it. */}
      <p className="text-[15px] text-muted">{summary}</p>

      <section className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <Stat label="Hours, last 7 days" value={hm(totals.last7)} icon={Clock} />
        <Stat label="Open tasks" value={String(totals.open)} icon={Circle} />
        <Stat label="Completed" value={String(totals.done)} icon={CheckCircle2} />
      </section>

      {/* First and loud, because it is the only panel the client can clear. */}
      {waiting.length > 0 ? (
        <section className="card border-amber-500/50 p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-[17px] font-bold">
              <AlertTriangle size={17} className="shrink-0 text-amber-400" /> Waiting on you
            </h2>
            <span className="pill bg-amber-500/15 text-amber-400">{waiting.length}</span>
          </div>
          <ul className="space-y-2">
            {waiting.map((t) => (
              <li key={t.id} className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
                <p className="break-words text-sm font-medium">{t.title}</p>
                {/* Written for the client specifically (0075). blocker_note,
                    the private one, is not published at all. */}
                <p className="mt-1 break-words text-sm text-amber-400">{t.client_visible_blocker}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="mb-3 text-[17px] font-bold">Coming up</h2>
          {upcoming.length === 0 ? (
            <p className="text-sm text-faint">No meetings coming up.</p>
          ) : (
            <ul className="space-y-2">
              {upcoming.slice(0, MEETINGS_LIMIT).map((e) => (
                <li key={e.id} className="flex items-start gap-3 rounded-lg bg-surface-2 p-3">
                  <CalendarDays size={16} className="mt-0.5 shrink-0 text-faint" />
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-medium">{e.title}</p>
                    <p className="mt-0.5 text-xs text-faint">
                      {dayLabel(new Date(e.starts_at))}
                      {", "}
                      {e.all_day
                        ? "all day"
                        : `${time12(e.starts_at)}${e.ends_at ? ` to ${time12(e.ends_at)}` : ""}`}
                    </p>
                    {e.hangout_link ? (
                      <a
                        href={e.hangout_link}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-accent-soft hover:underline"
                      >
                        <Video size={12} /> Join
                      </a>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {upcoming.length > MEETINGS_LIMIT ? (
            <p className="mt-2 text-xs text-faint">
              {plural(upcoming.length - MEETINGS_LIMIT, "more meeting")} on your calendar.
            </p>
          ) : null}
        </section>

        <section className="card p-5">
          <h2 className="mb-3 text-[17px] font-bold">Done today</h2>
          {doneToday.length === 0 ? (
            <p className="text-sm text-faint">Nothing completed yet today.</p>
          ) : (
            <ul className="space-y-1.5">
              {doneToday.map((t) => (
                <li key={t.id} className="flex items-start gap-2 text-sm">
                  <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-400" />
                  <span className="min-w-0 flex-1 break-words">{t.title}</span>
                  {t.completed_at ? (
                    <span className="shrink-0 text-xs text-faint">{time12(t.completed_at)}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {readOnly ? null : (
      <section className="card p-5">
        <h2 className="mb-3 text-[17px] font-bold">Ask for something</h2>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder="What do you need done?"
            className="input flex-1"
          />
          <input
            value={due}
            onChange={(e) => setDue(e.target.value)}
            placeholder="When? (optional)"
            className="input sm:w-48"
          />
          <button
            onClick={() => void submit()}
            disabled={!title.trim() || request.isPending}
            className="btn-primary whitespace-nowrap"
          >
            {request.isPending ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Request
          </button>
        </div>
        {error ? (
          <p className="mt-2 flex items-start gap-2 text-sm text-red-400">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {error}
          </p>
        ) : null}
      </section>
      )}

      <section className="card p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-[17px] font-bold">Your open tasks</h2>
          {openTasks.length > OPEN_LIMIT ? (
            <span className="text-xs text-faint">
              Showing {OPEN_LIMIT} of {openTasks.length}. See all on Tasks.
            </span>
          ) : null}
        </div>
        {openTasks.length === 0 ? (
          <p className="text-sm text-faint">
            {tasks.length === 0 ? "Nothing on your account yet." : "Nothing open right now."}
          </p>
        ) : (
          <ul className="space-y-2">
            {openTasks.slice(0, OPEN_LIMIT).map((t) => (
              <li
                key={t.id}
                className="flex items-start gap-3 rounded-lg bg-surface-2 p-3"
              >
                <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", STATUS[t.status]?.dot ?? "bg-sky-400")} />
                <div className="min-w-0 flex-1">
                  <div className="break-words text-sm">{t.title}</div>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-faint">
                    <span>{STATUS[t.status]?.label ?? t.status}</span>
                    {t.due_label ? <span>Due {t.due_label}</span> : null}
                    {t.blocked && !t.client_visible_blocker ? <span className="text-red-400">Blocked</span> : null}
                    {t.requested_by_client ? <span>Requested by you</span> : null}
                  </div>
                  {waitingOnClient(t) ? (
                    <p className="mt-1.5 flex items-start gap-1.5 text-xs text-amber-400">
                      <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                      <span className="min-w-0 break-words">Waiting on you: {t.client_visible_blocker}</span>
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {days.length > 0 ? (
        <button
          onClick={onSeeActivity}
          className="card flex w-full items-center justify-between p-4 text-sm transition-colors hover:border-accent/60"
        >
          <span>See what was done, day by day</span>
          <ArrowRight size={15} className="text-faint shrink-0" />
        </button>
      ) : null}
    </div>
  );
}

/* The agency KPI tile, class for class: .card, the label small-caps and faint
   on the left with an accent icon opposite, the number 34px and extra-bold
   beneath. It was a bordered box with a 20px number, which is the difference
   between "a figure" and "the headline". */
function Stat({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Clock }) {
  return (
    <div className="card p-5 transition-transform hover:-translate-y-0.5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-[11.5px] font-bold uppercase tracking-[0.09em] text-faint">{label}</span>
        <Icon size={18} className="shrink-0 text-accent" />
      </div>
      <p className="text-[34px] font-extrabold leading-none tracking-[-0.02em]">{value}</p>
    </div>
  );
}
