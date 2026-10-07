import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Camera, Check, Circle, Clock, Loader2, Play, Plus, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { clockTime, dateOnly, dayLabel, hm, surfaceLabel } from "./format";
import { fetchTeamReports, TEAM_REPORTS_KEY } from "./memberData";
import { ReportView } from "./ClientStaffReport";

/**
 * What the client sees of their own staff: hours, screenshots, and a way to hand
 * work over.
 *
 * WHY THE IMAGES ARE HERE AND NOT IN 0073's CLIENT VIEW. That one withholds
 * screenshots of an ASSISTANT's monitor from the client, because an agency
 * assistant works several accounts and one frame can carry another client's
 * inbox. None of that applies here: this is the client's own staff, working
 * only on this account, monitored by the person who employs them. Different
 * people, different answer.
 *
 * THE CLIENT CANNOT EDIT THE TIMESHEET. 0078 gives the primary select and
 * nothing else on client_time_entries. A timesheet the employer can quietly
 * correct is not evidence of anything, and the moment it is editable it stops
 * being useful to either side.
 */

interface Person { role: string; email: string | null; }
/* client_tasks under the Board's key and select (it reads "*"), so the two
   panes share one cache entry. staff_email marks a task as with their staff. */
interface TeamTask {
  id: string; title: string; status: string; due_label: string | null;
  blocked: boolean; client_visible_blocker: string | null; completed_at: string | null;
  staff_email?: string | null;
}
interface Day {
  owner_id: string; email: string; work_date: string;
  minutes: number; sessions: number;
  first_started_at: string | null; last_ended_at: string | null; running: boolean;
}
interface Shot {
  id: string; owner_id: string; email: string; captured_at: string;
  storage_path: string; surface: string | null;
}

export function ClientTeam() {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState("");
  const [due, setDue] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [shotUrl, setShotUrl] = useState<{ url: string; who: string; at: string } | null>(null);

  const { data: people = [] } = useQuery({
    queryKey: ["client-portal", "people"],
    queryFn: async () => {
      const { data, error } = await supabase!.from("client_people").select("role, email");
      if (error) throw error;
      return (data ?? []) as Person[];
    },
  });
  const members = people.filter((p) => p.role === "member" && p.email);

  const { data: days = [] } = useQuery({
    queryKey: ["client-portal", "team-time"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase!
        .from("client_team_time")
        .select("owner_id, email, work_date, minutes, sessions, first_started_at, last_ended_at, running")
        .order("work_date", { ascending: false })
        .limit(60);
      if (error) throw error;
      return (data ?? []) as Day[];
    },
  });

  const { data: shots = [] } = useQuery({
    queryKey: ["client-portal", "team-shots"],
    queryFn: async () => {
      const { data, error } = await supabase!
        .from("client_team_screenshots")
        .select("id, owner_id, email, captured_at, storage_path, surface")
        .order("captured_at", { ascending: false })
        .limit(60);
      if (error) throw error;
      return (data ?? []) as Shot[];
    },
  });

  const { data: allTasks = [] } = useQuery({
    queryKey: ["client-portal", "tasks"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase!.from("client_tasks").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as TeamTask[];
    },
  });
  const { data: reports = [] } = useQuery({ queryKey: TEAM_REPORTS_KEY, queryFn: fetchTeamReports, refetchInterval: 120_000 });

  /* Their work, by person: what is open (stuck first), and what they finished this week. */
  const work = useMemo(() => {
    const weekAgo = Date.now() - 7 * 86_400_000;
    const m = new Map<string, { open: TeamTask[]; doneWeek: number }>();
    for (const t of allTasks) {
      if (!t.staff_email) continue;
      const row = m.get(t.staff_email) ?? { open: [], doneWeek: 0 };
      if (t.status === "done") { if (t.completed_at && new Date(t.completed_at).getTime() >= weekAgo) row.doneWeek++; }
      else row.open.push(t);
      m.set(t.staff_email, row);
    }
    for (const r of m.values()) r.open.sort((a, b) => Number(b.blocked) - Number(a.blocked));
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [allTasks]);

  const assign = useMutation({
    mutationFn: async () => {
      const { error } = await supabase!.rpc("client_create_team_task", {
        p_title: title.trim(),
        p_assignee_email: assignee,
        p_due_label: due.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setDone(`Assigned to ${assignee}.`);
      setTitle("");
      setDue("");
      qc.invalidateQueries({ queryKey: ["client-portal", "tasks"] });
    },
  });

  async function send() {
    if (!title.trim() || !assignee || assign.isPending) return;
    setError(""); setDone("");
    try { await assign.mutateAsync(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not assign that."); }
  }

  /* Signed on demand rather than up front. The bucket is private, so a URL only
     exists for as long as somebody is looking at the picture. */
  async function openShot(s: Shot) {
    const { data, error } = await supabase!.storage
      .from("client-screenshots")
      .createSignedUrl(s.storage_path, 60);
    if (error || !data?.signedUrl) { setError(error?.message ?? "Could not open that image."); return; }
    setShotUrl({ url: data.signedUrl, who: s.email, at: new Date(s.captured_at).toLocaleString() });
  }

  const byPerson = useMemo(() => {
    const m = new Map<string, { email: string; minutes: number; days: Day[] }>();
    for (const d of days) {
      const row = m.get(d.owner_id) ?? { email: d.email, minutes: 0, days: [] };
      row.minutes += Number(d.minutes ?? 0);
      row.days.push(d);
      m.set(d.owner_id, row);
    }
    return [...m.values()];
  }, [days]);

  return (
    <div className="space-y-5">
      <section className="card p-5">
        <h2 className="mb-3 text-[17px] font-bold">Give your staff something to do</h2>
        {members.length === 0 ? (
          <p className="text-sm text-faint">
            No staff yet. Add a staff member under People, then assign work here.
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void send(); } }}
                placeholder="What needs doing?"
                className="input flex-1"
              />
              <select
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                className="input sm:w-56"
                aria-label="Assign to"
              >
                <option value="">Assign to…</option>
                {members.map((m) => <option key={m.email} value={m.email!}>{m.email}</option>)}
              </select>
              <input
                value={due}
                onChange={(e) => setDue(e.target.value)}
                placeholder="When? (optional)"
                className="input sm:w-40"
              />
              <button
                className="btn-primary whitespace-nowrap"
                onClick={() => void send()}
                disabled={!title.trim() || !assignee || assign.isPending}
              >
                {assign.isPending ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                Assign
              </button>
            </div>
            {error && (
              <p className="mt-2 flex items-start gap-2 text-sm text-red-400">
                <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {error}
              </p>
            )}
            {done && (
              <p className="mt-2 flex items-start gap-2 text-sm" style={{ color: "var(--c-accent)" }}>
                <Check size={15} className="mt-0.5 shrink-0" /> {done}
              </p>
            )}
          </>
        )}
      </section>

      <section className="card p-5">
        <h2 className="mb-3 text-[17px] font-bold">Their work</h2>
        {work.length === 0 ? (
          <p className="text-sm text-faint">Nothing assigned to your staff yet.</p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {work.map(([email, w]) => (
              <div key={email} className="min-w-0 rounded-xl bg-surface-2 p-3">
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="min-w-0 truncate text-sm font-semibold">{email}</span>
                  <span className="text-xs text-faint">{w.open.length} open · {w.doneWeek} done this week</span>
                </div>
                {w.open.length === 0 ? (
                  <p className="text-xs text-faint">All caught up.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {w.open.slice(0, 6).map((t) => (
                      <li key={t.id} className="text-sm">
                        <span className="flex items-start gap-2">
                          {t.status === "todo"
                            ? <Circle size={13} className="mt-0.5 shrink-0 text-faint" aria-label="To do" />
                            : <Play size={13} className="mt-0.5 shrink-0 text-accent-soft" aria-label="In progress" />}
                          <span className="min-w-0 flex-1 break-words">{t.title}</span>
                          {t.due_label && <span className="shrink-0 text-xs text-faint">{t.due_label}</span>}
                        </span>
                        {t.blocked && t.client_visible_blocker && (
                          <span className="ml-5 mt-0.5 flex items-start gap-1.5 text-xs text-amber-400">
                            <AlertTriangle size={11} className="mt-0.5 shrink-0" /> <span className="break-words">Stuck: {t.client_visible_blocker}</span>
                          </span>
                        )}
                      </li>
                    ))}
                    {w.open.length > 6 && <li className="text-xs text-faint">+{w.open.length - 6} more on your Tasks board</li>}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card p-5">
        <h2 className="mb-1 text-[17px] font-bold">Daily reports</h2>
        <p className="mb-3 text-sm text-muted">What each of your staff got done, what's blocked, and what's next, in their own words.</p>
        {reports.length === 0 ? (
          <p className="text-sm text-faint">No reports yet. Staff send one from their Daily report page.</p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {reports.slice(0, 12).map((r) => <ReportView key={r.id} r={r} who={r.email} />)}
          </div>
        )}
      </section>

      <section className="card p-5">
        <h2 className="mb-3 text-[17px] font-bold">Hours</h2>
        {byPerson.length === 0 ? (
          <p className="text-sm text-faint">None of your staff have clocked in yet.</p>
        ) : (
          <div className="space-y-4">
            {byPerson.map((p) => (
              <div key={p.email}>
                <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="text-sm font-medium">{p.email}</span>
                  <span className="text-xs text-faint">{hm(p.minutes)} total</span>
                </div>
                <div className="space-y-1">
                  {p.days.map((d) => (
                    <div key={`${d.owner_id}-${d.work_date}`} className="flex flex-wrap items-center gap-x-3 rounded-lg bg-surface-2 px-3 py-2 text-sm">
                      <span className="min-w-[7rem] text-muted">{dayLabel(dateOnly(d.work_date))}</span>
                      <span className="text-xs text-faint">
                        {d.first_started_at ? clockTime(d.first_started_at) : "—"}
                        {" – "}
                        {d.running ? "now" : d.last_ended_at ? clockTime(d.last_ended_at) : "—"}
                      </span>
                      {d.running && (
                        <span className="pill bg-accent/15 text-accent-soft text-[10px]">Working</span>
                      )}
                      <span className="ml-auto flex items-center gap-1 text-xs text-faint">
                        <Clock size={11} /> {hm(Number(d.minutes))}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card p-5">
        <h2 className="mb-1 text-[17px] font-bold">Screenshots</h2>
        <p className="mb-3 text-sm text-muted">
          Taken every ten minutes while a staff member has screen sharing on and is clocked in.
        </p>
        {shots.length === 0 ? (
          <p className="text-sm text-faint">No screenshots yet.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {shots.map((s) => (
              <button
                key={s.id}
                onClick={() => void openShot(s)}
                className="rounded-lg bg-surface-2 p-3 text-left transition-colors hover:bg-[var(--chip-bg)]"
              >
                <Camera size={14} className="mb-2 text-faint" />
                <p className="truncate text-xs font-medium">{s.email}</p>
                <p className="mt-0.5 text-[11px] text-faint">
                  {new Date(s.captured_at).toLocaleString()}
                </p>
                {s.surface && <p className="mt-0.5 text-[11px] text-faint">{surfaceLabel(s.surface)}</p>}
              </button>
            ))}
          </div>
        )}
      </section>

      {shotUrl && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 p-4"
          onClick={() => setShotUrl(null)}
          role="dialog"
          aria-modal="true"
        >
          <div className="max-h-full w-full max-w-4xl overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between gap-3 text-sm text-white">
              <span className="min-w-0 truncate">{shotUrl.who} · {shotUrl.at}</span>
              <button onClick={() => setShotUrl(null)} aria-label="Close" className="shrink-0">
                <X size={18} />
              </button>
            </div>
            <img src={shotUrl.url} alt={`Screenshot from ${shotUrl.who}`} className="w-full rounded-lg" />
          </div>
        </div>
      )}
    </div>
  );
}
