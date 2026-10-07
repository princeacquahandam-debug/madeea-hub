import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, CheckCircle2, Circle, Loader2, Play, RotateCcw, Undo2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { clockTime, dayLabel, dateOnly, localDayKey } from "./format";
import { fetchMyTasks, MY_TASKS_KEY, type MyTask, type MyTaskStatus } from "./memberData";

/**
 * A staff member's own work, as a board: To do, In progress, Done.
 *
 * Three columns, not the client's five. client_member_set_status (0078) lets a
 * member move their work between exactly these three; Follow-up and Review are
 * the agency's stages and are shown under In progress if a task is ever in one.
 *
 * "I'M STUCK" goes to the client. It is written into client_visible_blocker
 * (0085), which is what the client's board and bell already show as "Waiting
 * on you", so the person who can unblock it hears about it without a new
 * channel.
 */

const COLUMNS: { id: "todo" | "in_progress" | "done"; label: string }[] = [
  { id: "todo", label: "To do" },
  { id: "in_progress", label: "In progress" },
  { id: "done", label: "Done" },
];

const columnOf = (s: MyTaskStatus): "todo" | "in_progress" | "done" =>
  s === "done" ? "done" : s === "todo" ? "todo" : "in_progress";

export function ClientMemberBoard() {
  const qc = useQueryClient();
  const [error, setError] = useState("");
  const { data: tasks = [], isLoading } = useQuery({ queryKey: MY_TASKS_KEY, queryFn: fetchMyTasks });
  const refresh = () => void qc.invalidateQueries({ queryKey: MY_TASKS_KEY });

  const move = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "todo" | "in_progress" | "done" }) => {
      const { error } = await supabase!.rpc("client_member_set_status", { p_task_id: id, p_status: status });
      if (error) throw error;
    },
    onSuccess: () => { setError(""); refresh(); },
    onError: (e) => setError(e instanceof Error ? e.message : "Couldn't move that task."),
  });

  const flag = useMutation({
    mutationFn: async ({ id, note }: { id: string; note: string }) => {
      const { error } = await supabase!.rpc("client_member_set_blocker", { p_task_id: id, p_note: note });
      if (error) throw error;
    },
    onSuccess: () => { setError(""); refresh(); },
    onError: (e) => setError(e instanceof Error ? e.message : "Couldn't save that."),
  });

  if (isLoading) return <p className="text-sm text-faint">Loading…</p>;

  return (
    <div className="space-y-3">
      {error && (
        <p className="flex items-start gap-2 text-sm text-red-400"><AlertTriangle size={15} className="mt-0.5 shrink-0" /> {error}</p>
      )}
      {tasks.length === 0 ? (
        <p className="card p-5 text-sm text-faint">Nothing assigned to you yet. Work the account owner gives you appears here.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {COLUMNS.map((col) => {
            const items = tasks.filter((t) => columnOf(t.status) === col.id);
            return (
              <section key={col.id} className="card flex min-w-0 flex-col p-3" aria-label={col.label}>
                <div className="mb-2 flex items-center justify-between px-1">
                  <h2 className="text-sm font-bold">{col.label}</h2>
                  <span className="pill border border-border text-[11px] text-faint">{items.length}</span>
                </div>
                <div className="space-y-2">
                  {items.length === 0 ? (
                    <p className="px-1 py-3 text-xs text-faint">Nothing here.</p>
                  ) : items.map((t) => (
                    <Card key={t.id} t={t} busy={move.isPending || flag.isPending}
                      onMove={(status) => move.mutate({ id: t.id, status })}
                      onFlag={(note) => flag.mutate({ id: t.id, note })} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Card({ t, busy, onMove, onFlag }: {
  t: MyTask; busy: boolean;
  onMove: (s: "todo" | "in_progress" | "done") => void;
  onFlag: (note: string) => void;
}) {
  const [writing, setWriting] = useState(false);
  const [note, setNote] = useState("");
  const col = columnOf(t.status);
  const due = t.due_at ? `${dayLabel(dateOnly(localDayKey(t.due_at)))} ${clockTime(t.due_at)}` : t.due_label;

  return (
    <article className="rounded-xl bg-surface-2 p-3">
      <p className={cn("break-words text-sm font-medium", col === "done" && "text-muted line-through decoration-faint")}>{t.title}</p>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-faint">
        {col === "done" && t.completed_at ? (
          <span className="flex items-center gap-1"><CheckCircle2 size={12} className="text-emerald-400" /> Done {dayLabel(dateOnly(localDayKey(t.completed_at)))}</span>
        ) : due ? (
          <span className="flex items-center gap-1"><CalendarClock size={12} /> Due {due}</span>
        ) : null}
        {t.priority && t.priority !== "normal" ? <span className="capitalize">{t.priority}</span> : null}
      </div>

      {t.blocked && t.client_visible_blocker && col !== "done" ? (
        <div className="mt-2 rounded-md bg-amber-500/10 px-2 py-1.5 text-xs text-amber-400">
          <p className="flex items-start gap-1.5"><AlertTriangle size={12} className="mt-0.5 shrink-0" /><span className="min-w-0 break-words">Stuck: {t.client_visible_blocker}</span></p>
          <button onClick={() => onFlag("")} disabled={busy} className="mt-1 text-[11px] font-semibold underline-offset-2 hover:underline">Unstuck now</button>
        </div>
      ) : null}

      {writing && (
        <div className="mt-2 space-y-1.5">
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} autoFocus
            placeholder="What do you need to move this? The account owner sees this."
            aria-label="What you need" className="input w-full text-sm" />
          <div className="flex gap-1.5">
            <button className="btn-primary px-2.5 py-1 text-xs" disabled={!note.trim() || busy}
              onClick={() => { onFlag(note.trim()); setWriting(false); setNote(""); }}>Tell the account owner</button>
            <button className="btn-ghost px-2.5 py-1 text-xs" onClick={() => { setWriting(false); setNote(""); }}>Cancel</button>
          </div>
        </div>
      )}

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {col === "todo" && (
          <button onClick={() => onMove("in_progress")} disabled={busy} className="btn-ghost border border-border px-2.5 py-1 text-xs">
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} Start
          </button>
        )}
        {col !== "done" && (
          <button onClick={() => onMove("done")} disabled={busy} className="btn-ghost border border-border px-2.5 py-1 text-xs">
            <Circle size={12} /> Mark done
          </button>
        )}
        {col === "in_progress" && (
          <button onClick={() => onMove("todo")} disabled={busy} className="btn-ghost px-2.5 py-1 text-xs text-faint">
            <Undo2 size={12} /> Back to to-do
          </button>
        )}
        {col === "done" && (
          <button onClick={() => onMove("in_progress")} disabled={busy} className="btn-ghost px-2.5 py-1 text-xs text-faint">
            <RotateCcw size={12} /> Reopen
          </button>
        )}
        {col !== "done" && !t.blocked && !writing && (
          <button onClick={() => setWriting(true)} className="btn-ghost px-2.5 py-1 text-xs text-amber-400">
            <AlertTriangle size={12} /> I'm stuck
          </button>
        )}
      </div>
    </article>
  );
}
