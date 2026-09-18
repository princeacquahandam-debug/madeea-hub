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
  client_visible_blocker: string | null;
  completed_at: string | null;
  created_at: string;
  requested_by_client: boolean;
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
    <div className="space-y-6">
      <section className="grid grid-cols-2 gap-4 md:grid-cols-3">
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
          <p className="mt-2 flex items-start gap-2 text-sm" style={{ color: "var(--c-danger)" }}>
            <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {error}
          </p>
        ) : null}
      </section>
      )}

      <section className="card p-5">
        <h2 className="mb-3 text-[17px] font-bold">Your tasks</h2>
        {tasks.length === 0 ? (
          <p className="text-faint text-sm">Nothing on your account yet.</p>
        ) : (
          <ul className="space-y-2">
            {tasks.map((t) => (
              <li
                key={t.id}
                className="flex items-start gap-3 rounded-lg bg-surface-2 p-3"
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
                  {/* The assistant wrote this for the client specifically (0075).
                      blocker_note, the private one, is not published at all. */}
                  {t.blocked && t.client_visible_blocker ? (
                    <p className="mt-1.5 flex items-start gap-1.5 text-xs" style={{ color: "var(--c-danger)" }}>
                      <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                      Waiting on you: {t.client_visible_blocker}
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
