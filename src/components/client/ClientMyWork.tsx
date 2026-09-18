import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, Camera, CheckCircle2, Circle, Clock, Loader2, Play, Square,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useClientCapture } from "@/hooks/useClientCapture";
import { cn } from "@/lib/utils";
import { clockTime, dateOnly, dayLabel, hm } from "./format";

/**
 * A team member's own working day: their tasks, their clock, their captures.
 *
 * ONE PANE, NOT THREE. The agency app splits Task Manager, Time Tracker and
 * Screenshots because an assistant lives in each of them all day and needs the
 * room. A client's team member has one loop -- start the clock, work the list,
 * stop the clock -- and splitting it across three destinations would mean
 * clocking in on one screen and forgetting on another, which is the failure
 * 0063 exists to catch on the agency side.
 *
 * WHAT THEY CANNOT SEE, and it is most of the account: the client's activity
 * totals, their delegation plans, their two message channels, and every other
 * member's hours and captures. They are staff on this account, not a second
 * owner of it.
 */

interface Task {
  id: string;
  title: string;
  status: "todo" | "in_progress" | "done";
  due_label: string | null;
  blocked: boolean;
  client_visible_blocker: string | null;
  completed_at: string | null;
}

interface Shift {
  id: string;
  started_at: string;
  ended_at: string | null;
  work_date: string;
  note: string | null;
  captures: number;
}

export function ClientMyWork({ clientId }: { clientId: string }) {
  const qc = useQueryClient();

  const { data: tasks = [], isLoading: loadingTasks } = useQuery({
    queryKey: ["client-portal", "my-tasks"],
    queryFn: async () => {
      const { data, error } = await supabase!
        .from("client_my_tasks")
        .select("id, title, status, due_label, blocked, client_visible_blocker, completed_at")
        .order("status")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Task[];
    },
  });

  const { data: shifts = [] } = useQuery({
    queryKey: ["client-portal", "my-time"],
    // A running shift's elapsed time only moves if something asks again.
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase!
        .from("client_my_time")
        .select("id, started_at, ended_at, work_date, note, captures")
        .order("started_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return (data ?? []) as Shift[];
    },
  });

  const running = shifts.find((s) => !s.ended_at) ?? null;
  const capture = useClientCapture(running?.id ?? null, clientId);

  const today = useMemo(() => {
    const key = new Date().toISOString().slice(0, 10);
    const mins = shifts
      .filter((s) => s.work_date === key)
      .reduce((n, s) => n + (new Date(s.ended_at ?? Date.now()).getTime() - new Date(s.started_at).getTime()) / 60000, 0);
    return Math.round(mins);
  }, [shifts]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["client-portal", "my-time"] });
    qc.invalidateQueries({ queryKey: ["client-portal", "my-tasks"] });
  };

  const clockIn = useMutation({
    mutationFn: async () => {
      const { error } = await supabase!.rpc("client_clock_in");
      if (error) throw error;
    },
    onSuccess: refresh,
  });

  const clockOut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase!.rpc("client_clock_out");
      if (error) throw error;
    },
    onSuccess: () => { capture.stop(); refresh(); },
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: Task["status"] }) => {
      const { error } = await supabase!.rpc("client_member_set_status", {
        p_task_id: id, p_status: status,
      });
      if (error) throw error;
    },
    onSuccess: refresh,
  });

  const open = tasks.filter((t) => t.status !== "done");
  const done = tasks.filter((t) => t.status === "done");

  return (
    <div className="space-y-5">
      {/* ---- the clock ---- */}
      <section className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11.5px] font-bold uppercase tracking-[0.09em] text-faint">
              {running ? "On the clock" : "Today"}
            </p>
            <p className="mt-1 text-[34px] font-extrabold leading-none tracking-[-0.02em]">
              {hm(today)}
            </p>
            {running ? (
              <p className="mt-1.5 text-sm text-muted">
                Started {clockTime(running.started_at)}.
              </p>
            ) : (
              <p className="mt-1.5 text-sm text-muted">Not clocked in.</p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {running ? (
              <button
                className="btn-ghost border border-border whitespace-nowrap"
                onClick={() => clockOut.mutate()}
                disabled={clockOut.isPending}
              >
                {clockOut.isPending ? <Loader2 size={15} className="animate-spin" /> : <Square size={15} />}
                Clock out
              </button>
            ) : (
              <button
                className="btn-primary whitespace-nowrap"
                onClick={() => clockIn.mutate()}
                disabled={clockIn.isPending}
              >
                {clockIn.isPending ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
                Clock in
              </button>
            )}

            {running && !capture.sharing && (
              <button className="btn-ghost border border-border whitespace-nowrap" onClick={() => void capture.start()}>
                <Camera size={15} /> Share screen
              </button>
            )}
            {capture.sharing && (
              <span className="pill bg-accent/15 text-accent-soft whitespace-nowrap">
                <Camera size={11} /> Sharing
                {capture.surface ? ` · ${capture.surface}` : ""}
              </span>
            )}
          </div>
        </div>

        {(clockIn.error || clockOut.error || capture.error) && (
          <p className="mt-3 flex items-start gap-2 text-sm text-red-400">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            {capture.error
              || (clockIn.error as Error)?.message
              || (clockOut.error as Error)?.message}
          </p>
        )}

        {running && (
          <p className="mt-3 text-xs text-faint">
            {capture.sharing
              ? `A screenshot is taken every ${capture.intervalMinutes} minutes while you share, and goes to the person who runs this account. ${capture.count} taken this session. Stop sharing from your browser at any time.`
              : "Screen sharing is off. Your hours are still recorded."}
          </p>
        )}
      </section>

      {/* ---- their work ---- */}
      <section className="card p-5">
        <h2 className="mb-3 text-[17px] font-bold">Your tasks</h2>
        {loadingTasks ? (
          <p className="text-sm text-faint">Loading…</p>
        ) : open.length === 0 ? (
          <p className="text-sm text-faint">Nothing assigned to you right now.</p>
        ) : (
          <div className="space-y-2">
            {open.map((t) => (
              <div key={t.id} className="flex items-start gap-3 rounded-lg bg-surface-2 p-3">
                <button
                  onClick={() => setStatus.mutate({ id: t.id, status: "done" })}
                  className="mt-0.5 shrink-0 text-faint transition-colors hover:text-accent"
                  aria-label={`Mark ${t.title} done`}
                  title="Mark done"
                >
                  <Circle size={16} />
                </button>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{t.title}</p>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-faint">
                    {t.due_label ? <span>Due {t.due_label}</span> : null}
                    {t.blocked ? <span className="text-red-400">Blocked</span> : null}
                  </div>
                  {t.blocked && t.client_visible_blocker ? (
                    <p className="mt-1 text-xs text-red-400">{t.client_visible_blocker}</p>
                  ) : null}
                </div>
                <button
                  onClick={() => setStatus.mutate({
                    id: t.id,
                    status: t.status === "in_progress" ? "todo" : "in_progress",
                  })}
                  className={cn(
                    "pill shrink-0 whitespace-nowrap",
                    t.status === "in_progress"
                      ? "bg-accent/15 text-accent-soft"
                      : "border border-border text-faint hover:text-text",
                  )}
                >
                  {t.status === "in_progress" ? "In progress" : "Start"}
                </button>
              </div>
            ))}
          </div>
        )}

        {done.length > 0 && (
          <div className="mt-4">
            <p className="field-label">Done recently</p>
            <div className="space-y-1.5">
              {done.slice(0, 5).map((t) => (
                <div key={t.id} className="flex items-center gap-2 text-sm text-muted">
                  <CheckCircle2 size={14} className="shrink-0 text-accent" />
                  <span className="min-w-0 truncate">{t.title}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ---- their timesheet ---- */}
      <section className="card p-5">
        <h2 className="mb-3 text-[17px] font-bold">Your hours</h2>
        {shifts.length === 0 ? (
          <p className="text-sm text-faint">No shifts recorded yet.</p>
        ) : (
          <div className="space-y-1.5">
            {shifts.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center gap-x-3 text-sm">
                <span className="min-w-[7rem] text-muted">{dayLabel(dateOnly(s.work_date))}</span>
                <span className="text-faint">
                  {clockTime(s.started_at)} – {s.ended_at ? clockTime(s.ended_at) : "now"}
                </span>
                <span className="ml-auto flex items-center gap-3 text-xs text-faint">
                  {s.captures > 0 && (
                    <span className="flex items-center gap-1"><Camera size={11} />{s.captures}</span>
                  )}
                  <span className="flex items-center gap-1">
                    <Clock size={11} />
                    {hm((new Date(s.ended_at ?? Date.now()).getTime() - new Date(s.started_at).getTime()) / 60000)}
                  </span>
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
