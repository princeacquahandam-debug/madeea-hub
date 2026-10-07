import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, CheckCircle2, Search, UserRound } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Badge } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * The client's task board: every task on the account, by status.
 *
 * READ ONLY. The agency board is where work is moved; a client dragging a task
 * to Done would be closing work nobody has signed off. What a client can DO
 * about a task is answer what it is waiting on, so that is what each task
 * shouts about, not a handle to drag.
 *
 * Same five columns, labels and colours as the agency Task Manager, so a client
 * and their assistant looking at the same task call its state by the same name.
 *
 * Reads client_tasks under the Overview's query key, so the two panes share one
 * fetch and a task requested on the Overview is already here.
 */

type Status = "todo" | "in_progress" | "follow_up" | "review" | "done";

interface TaskRow {
  id: string;
  title: string;
  status: Status;
  priority: string;
  due_label: string | null;
  due_at: string | null;
  blocked: boolean;
  client_visible_blocker: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string | null;
  requested_by_client: boolean;
}

// Mirrors COLUMNS in pages/Tasks.tsx. Copied, not imported, because that file
// is the agency page and pulls the whole drag-and-drop board in with it.
const COLUMNS: { key: Status; label: string; dot: string; wash: string; edge: string }[] = [
  { key: "todo",        label: "To Do",       dot: "bg-sky-400",     wash: "bg-sky-500/[0.06]",     edge: "border-sky-500/25" },
  { key: "in_progress", label: "In Progress", dot: "bg-amber-400",   wash: "bg-amber-500/[0.06]",   edge: "border-amber-500/25" },
  { key: "follow_up",   label: "Follow-up",   dot: "bg-rose-400",    wash: "bg-rose-500/[0.06]",    edge: "border-rose-500/25" },
  { key: "review",      label: "Review",      dot: "bg-violet-400",  wash: "bg-violet-500/[0.06]",  edge: "border-violet-500/25" },
  { key: "done",        label: "Done",        dot: "bg-emerald-400", wash: "bg-emerald-500/[0.06]", edge: "border-emerald-500/25" },
];

const PRIORITY_LABEL: Record<string, string> = { urgent: "Urgent", high: "High", normal: "Normal", low: "Low" };
const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

/* Done is history, and history only grows. Two weeks is "what got finished
   lately"; the rest is counted so nobody thinks it was lost. */
const DONE_WINDOW_DAYS = 14;

const waitingOnClient = (t: TaskRow) => t.blocked && !!t.client_visible_blocker;

/* due_at is a date picked on the agency board and stored as UTC midnight, so it
   is read back in UTC (as Tasks.tsx does) or anyone west of Greenwich sees the
   day before. */
function dueText(t: TaskRow): string | null {
  if (t.due_at) {
    return new Date(t.due_at).toLocaleDateString(undefined, {
      timeZone: "UTC", weekday: "short", day: "numeric", month: "short",
    });
  }
  return t.due_label || null;
}

function completedText(t: TaskRow): string | null {
  const iso = t.completed_at ?? t.updated_at;
  if (!iso) return null;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function ClientBoard() {
  const [query, setQuery] = useState("");
  const [waitingOnly, setWaitingOnly] = useState(false);

  const { data: tasks = [], isLoading } = useQuery({
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

  const waitingCount = useMemo(() => tasks.filter(waitingOnClient).length, [tasks]);

  const { board, olderDone, shown } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const cutoff = Date.now() - DONE_WINDOW_DAYS * 86_400_000;
    const board: Record<Status, TaskRow[]> = { todo: [], in_progress: [], follow_up: [], review: [], done: [] };
    let olderDone = 0;
    let shown = 0;

    for (const t of tasks) {
      if (q && !t.title.toLowerCase().includes(q)) continue;
      if (waitingOnly && !waitingOnClient(t)) continue;
      if (t.status === "done") {
        const at = new Date(t.completed_at ?? t.updated_at ?? t.created_at).getTime();
        if (at < cutoff) { olderDone++; continue; }
      }
      (board[t.status] ?? board.todo).push(t);
      shown++;
    }

    // What needs the client floats up; then the most urgent; then the newest.
    for (const key of ["todo", "in_progress", "follow_up", "review"] as Status[]) {
      board[key].sort((a, b) =>
        Number(waitingOnClient(b)) - Number(waitingOnClient(a))
        || (PRIORITY_RANK[a.priority] ?? 2) - (PRIORITY_RANK[b.priority] ?? 2)
        || b.created_at.localeCompare(a.created_at));
    }
    board.done.sort((a, b) =>
      (b.completed_at ?? b.updated_at ?? "").localeCompare(a.completed_at ?? a.updated_at ?? ""));

    return { board, olderDone, shown };
  }, [tasks, query, waitingOnly]);

  if (isLoading) return <p className="text-sm text-faint">Loading…</p>;

  if (tasks.length === 0) {
    return (
      <div className="card p-6">
        <p className="text-sm text-faint">
          Nothing on your board yet. Tasks you request, and tasks your assistant adds for
          you, appear here.
        </p>
      </div>
    );
  }

  return (
    // min-w-0 so the horizontally scrolling board at lg is contained here
    // instead of widening the shell.
    <div className="min-w-0 space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tasks"
            aria-label="Search tasks"
            className="input pl-8"
          />
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setWaitingOnly((v) => !v)}
            aria-pressed={waitingOnly}
            className={cn(
              "pill whitespace-nowrap border py-1 transition-colors",
              waitingOnly
                ? "border-amber-500/50 bg-amber-500/15 text-amber-400"
                : "border-border text-faint hover:text-text",
            )}
          >
            <AlertTriangle size={12} /> Waiting on you
            {waitingCount > 0 ? <span className="tabular-nums">({waitingCount})</span> : null}
          </button>
          <span className="text-xs text-faint tabular-nums">
            {shown} task{shown === 1 ? "" : "s"} shown
          </span>
        </div>
      </div>

      {shown === 0 && olderDone === 0 ? (
        <div className="card p-6">
          <p className="text-sm text-faint">
            {waitingOnly && !query.trim()
              ? "Nothing is waiting on you right now."
              : "No tasks match."}
          </p>
        </div>
      ) : (
        /* Phone: one column per section, stacked, so nothing scrolls sideways.
           Then two, then three per row; from xl all five fit side by side, so
           Done is never hidden off the right edge. */
        <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {COLUMNS.map((col) => {
            const items = board[col.key];
            return (
              <section
                key={col.key}
                className={cn("flex min-w-0 flex-col rounded-xl border", col.edge, col.wash)}
              >
                <div className="flex items-center gap-2 border-b border-inherit px-3.5 py-2.5">
                  <span className={cn("h-2 w-2 shrink-0 rounded-full", col.dot)} />
                  <h2 className="text-[14px] font-bold">{col.label}</h2>
                  <span className="pill bg-black/20 text-faint">{items.length}</span>
                </div>
                <div className="space-y-2 p-3">
                  {items.map((t) => <TaskCard key={t.id} task={t} />)}
                  {items.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-border py-6 text-center text-xs text-faint">
                      No tasks
                    </p>
                  ) : null}
                  {col.key === "done" && olderDone > 0 ? (
                    <p className="pt-1 text-center text-xs text-faint">
                      {olderDone} older completed task{olderDone === 1 ? "" : "s"} not shown
                    </p>
                  ) : null}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TaskCard({ task: t }: { task: TaskRow }) {
  const due = dueText(t);
  const waiting = waitingOnClient(t);
  return (
    <article
      className={cn(
        "rounded-lg bg-surface-2 p-3",
        waiting && "ring-1 ring-amber-500/50",
      )}
    >
      <p className="break-words text-sm font-medium">{t.title}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-faint">
        <Badge tone={t.priority}>{PRIORITY_LABEL[t.priority] ?? t.priority}</Badge>
        {t.status === "done" ? (
          completedText(t) ? (
            <span className="flex items-center gap-1">
              <CheckCircle2 size={12} className="text-emerald-400" /> Completed {completedText(t)}
            </span>
          ) : null
        ) : due ? (
          <span className="flex items-center gap-1">
            <CalendarClock size={12} /> Due {due}
          </span>
        ) : null}
        {t.requested_by_client ? (
          <span className="flex items-center gap-1">
            <UserRound size={12} /> Requested by you
          </span>
        ) : null}
      </div>
      {/* Written by the assistant for the client (0075). The private blocker
          note is never selected by the view. */}
      {waiting ? (
        <p className="mt-2 flex items-start gap-1.5 rounded-md bg-amber-500/10 px-2 py-1.5 text-xs text-amber-400">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <span className="min-w-0 break-words">Waiting on you: {t.client_visible_blocker}</span>
        </p>
      ) : null}
    </article>
  );
}
