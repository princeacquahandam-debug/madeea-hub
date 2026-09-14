import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, CheckCircle2, Circle, Loader2, Plus, AlertTriangle } from "lucide-react";
import { supabase } from "@/lib/supabase";

/**
 * The proof-of-work half of the client portal.
 *
 * Every read here goes through a VIEW, never a table. `client_tasks` and
 * `client_hours` list their columns by name, so a column added to `tasks` or
 * `time_entries` later is not published to clients by accident — see 0072.
 *
 * What is deliberately absent: EOD reports (one report covers every client that
 * assistant touched, so it is not this client's to read) and screenshots (a
 * photograph of a monitor shows whoever else was on it).
 */

interface Overview {
  client_name: string;
  company: string | null;
  assistant_name: string | null;
  assistant_initials: string | null;
}

interface HoursRow {
  work_date: string;
  minutes: number;
  sessions: number;
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

function hm(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  return h ? `${h}h ${m % 60}m` : `${m}m`;
}

export function ClientOverview() {
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

  const { data: hours = [] } = useQuery({
    queryKey: ["client-portal", "hours"],
    queryFn: async () => {
      const { data, error } = await supabase!
        .from("client_hours")
        .select("*")
        .order("work_date", { ascending: false })
        .limit(14);
      if (error) throw error;
      return (data ?? []) as HoursRow[];
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
    const last7 = hours.slice(0, 7).reduce((n, r) => n + Number(r.minutes ?? 0), 0);
    const open = tasks.filter((t) => t.status !== "done").length;
    const done = tasks.filter((t) => t.status === "done").length;
    return { last7, open, done };
  }, [hours, tasks]);

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

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider">Time on your account</h2>
        {hours.length === 0 ? (
          <p className="text-faint text-sm">No time has been logged against your account yet.</p>
        ) : (
          <ul className="space-y-1">
            {hours.map((h) => (
              <li key={h.work_date} className="flex items-center justify-between text-sm">
                <span className="text-faint">{new Date(h.work_date + "T00:00:00").toLocaleDateString()}</span>
                <span>
                  {hm(Number(h.minutes))}
                  <span className="text-faint"> · {h.sessions} session{h.sessions === 1 ? "" : "s"}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
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
