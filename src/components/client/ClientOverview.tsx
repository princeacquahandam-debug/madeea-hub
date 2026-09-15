import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, CheckCircle2, Circle, Loader2, Plus, AlertTriangle, ArrowRight } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { hm } from "./format";

/**
 * The front page of the client portal: where the account stands, right now.
 *
 * Every read here goes through a VIEW, never a table. `client_tasks` and
 * `client_days` list their columns by name, so a column added to `tasks` or
 * `time_entries` later is not published to clients by accident — see 0072.
 *
 * SCOPE. This pane answers "what is open, and what can I ask for?". The day by
 * day record of what was finished moved to ClientActivity when 0073 added the
 * digest, because the two answer different questions and one long scroll
 * answered neither well.
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
  status: "todo" | "in_progress" | "done";
  priority: string;
  due_label: string | null;
  blocked: boolean;
  completed_at: string | null;
  created_at: string;
  requested_by_client: boolean;
}

export function ClientOverview({ onSeeActivity }: { onSeeActivity: () => void }) {
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

  const totals = useMemo(() => {
    const last7 = days.reduce((n, r) => n + Number(r.minutes ?? 0), 0);
    const open = tasks.filter((t) => t.status !== "done").length;
    const done = tasks.filter((t) => t.status === "done").length;
    return { last7, open, done };
  }, [days, tasks]);

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
    <div className="space-y-6 px-6 py-4">
      <section className="grid gap-3 sm:grid-cols-3">
        <Stat label="Hours, last 7 days" value={hm(totals.last7)} icon={Clock} />
        <Stat label="Open tasks" value={String(totals.open)} icon={Circle} />
        <Stat label="Completed" value={String(totals.done)} icon={CheckCircle2} />
      </section>

      {overview?.assistant_name ? (
        <p className="text-faint text-sm">
          Your assistant is <span className="font-medium" style={{ color: "var(--c-text)" }}>{overview.assistant_name}</span>.
        </p>
      ) : (
        <p className="text-faint text-sm">No assistant is assigned to your account yet.</p>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider">Ask for something</h2>
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
            className="flex-1 rounded-xl px-4 py-2.5 text-sm"
            style={{ background: "var(--glass)", border: "1px solid var(--c-border)" }}
          />
          <input
            value={due}
            onChange={(e) => setDue(e.target.value)}
            placeholder="When? (optional)"
            className="rounded-xl px-4 py-2.5 text-sm sm:w-48"
            style={{ background: "var(--glass)", border: "1px solid var(--c-border)" }}
          />
          <button
            onClick={() => void submit()}
            disabled={!title.trim() || request.isPending}
            className="flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium disabled:opacity-40"
            style={{ background: "var(--c-accent)", color: "#fff" }}
          >
            {request.isPending ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Request
          </button>
        </div>
        {error ? (
          <p className="mt-2 flex items-start gap-2 text-sm" style={{ color: "var(--c-danger)" }}>
            <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {error}
          </p>
        ) : null}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider">Your tasks</h2>
        {tasks.length === 0 ? (
          <p className="text-faint text-sm">Nothing on your account yet.</p>
        ) : (
          <ul className="space-y-2">
            {tasks.map((t) => (
              <li
                key={t.id}
                className="flex items-start gap-3 rounded-xl px-4 py-3"
                style={{ background: "var(--glass)", border: "1px solid var(--c-border)" }}
              >
                {t.status === "done" ? (
                  <CheckCircle2 size={16} className="mt-0.5 shrink-0" style={{ color: "var(--c-accent)" }} />
                ) : t.status === "in_progress" ? (
                  <Loader2 size={16} className="mt-0.5 shrink-0" />
                ) : (
                  <Circle size={16} className="text-faint mt-0.5 shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-sm">{t.title}</div>
                  <div className="text-faint mt-0.5 flex flex-wrap gap-x-3 text-xs">
                    <span>{t.status === "in_progress" ? "In progress" : t.status === "done" ? "Done" : "To do"}</span>
                    {t.due_label ? <span>Due {t.due_label}</span> : null}
                    {t.blocked ? <span style={{ color: "var(--c-danger)" }}>Blocked</span> : null}
                    {t.requested_by_client ? <span>Requested by you</span> : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {days.length > 0 ? (
        <button
          onClick={onSeeActivity}
          className="flex w-full items-center justify-between rounded-xl px-4 py-3 text-sm"
          style={{ background: "var(--glass)", border: "1px solid var(--c-border)" }}
        >
          <span>See what was done, day by day</span>
          <ArrowRight size={15} className="text-faint shrink-0" />
        </button>
      ) : null}
    </div>
  );
}

function Stat({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Clock }) {
  return (
    <div className="rounded-xl px-4 py-3" style={{ background: "var(--glass)", border: "1px solid var(--c-border)" }}>
      <div className="text-faint flex items-center gap-2 text-xs uppercase tracking-wider">
        <Icon size={14} /> {label}
      </div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
    </div>
  );
}
