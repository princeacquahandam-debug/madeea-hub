import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, ClipboardList, Loader2, Send, Wand2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { dayLabel, dateOnly } from "./format";
import { fetchMyTasks, fetchTeamReports, localToday, MY_TASKS_KEY, TEAM_REPORTS_KEY } from "./memberData";

/**
 * A staff member's end-of-day report, for the account owner (0085).
 *
 * The same three questions the agency's EOD asks (done, blocked, next), so the
 * client reads their own staff the way they read their assistant. One report
 * per day: sending again replaces that day's, because a correction is not a
 * second report.
 *
 * "Fill from my tasks" drafts it from the board -- what was finished today,
 * what is flagged stuck, what is still open -- as a starting point to edit,
 * never sent without the member pressing Send.
 */

export function ClientStaffReport() {
  const qc = useQueryClient();
  const today = localToday();
  const { data: reports = [], isLoading } = useQuery({ queryKey: TEAM_REPORTS_KEY, queryFn: fetchTeamReports });
  const { data: tasks = [] } = useQuery({ queryKey: MY_TASKS_KEY, queryFn: fetchMyTasks });
  const mine = reports.filter((r) => r.is_you);
  const todays = mine.find((r) => r.work_date === today) ?? null;

  const [done, setDone] = useState("");
  const [blocked, setBlocked] = useState("");
  const [next, setNext] = useState("");
  const [sent, setSent] = useState("");
  const [loaded, setLoaded] = useState(false);

  // Editing today's report starts from what was sent, once.
  useEffect(() => {
    if (loaded || isLoading) return;
    setLoaded(true);
    if (todays) { setDone(todays.done); setBlocked(todays.blocked); setNext(todays.next); }
  }, [loaded, isLoading, todays]);

  function fill() {
    const isToday = (iso: string | null) => !!iso && new Date(iso).toDateString() === new Date().toDateString();
    const bullets = (xs: string[]) => xs.map((x) => `- ${x}`).join("\n");
    const finished = tasks.filter((t) => t.status === "done" && isToday(t.completed_at)).map((t) => t.title);
    const stuck = tasks.filter((t) => t.status !== "done" && t.blocked && t.client_visible_blocker).map((t) => `${t.title}: ${t.client_visible_blocker}`);
    const open = tasks.filter((t) => t.status !== "done" && !t.blocked).map((t) => t.title).slice(0, 8);
    if (!done.trim() && finished.length) setDone(bullets(finished));
    if (!blocked.trim() && stuck.length) setBlocked(bullets(stuck));
    if (!next.trim() && open.length) setNext(bullets(open));
  }

  const send = useMutation({
    mutationFn: async () => {
      const { error } = await supabase!.rpc("client_submit_report", {
        p_work_date: today, p_done: done.trim(), p_blocked: blocked.trim(), p_next: next.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setSent(todays ? "Updated. The account owner sees the new version." : "Sent to the account owner.");
      void qc.invalidateQueries({ queryKey: TEAM_REPORTS_KEY });
    },
  });

  return (
    <div className="space-y-5">
      <section className="card p-5">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="flex-1 text-[17px] font-bold">Today, {dayLabel(dateOnly(today))}</h2>
          {todays && <span className="pill bg-emerald-500/15 text-[11px] text-emerald-400"><Check size={11} /> Sent</span>}
          <button onClick={fill} className="btn-ghost border border-border px-3 py-1.5 text-xs" title="Draft from your task board">
            <Wand2 size={13} /> Fill from my tasks
          </button>
        </div>
        <div className="space-y-3">
          <Field label="What I got done" value={done} onChange={setDone} placeholder={"- Cleared the support inbox\n- Updated 40 CRM contacts"} />
          <Field label="What's blocked (optional)" value={blocked} onChange={setBlocked} placeholder="Anything you need from the account owner" />
          <Field label="Next (optional)" value={next} onChange={setNext} placeholder="What you'll pick up tomorrow" />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button className="btn-primary" disabled={!done.trim() || send.isPending} onClick={() => { setSent(""); send.mutate(); }}>
            {send.isPending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            {todays ? "Update report" : "Send report"}
          </button>
          {sent && <span className="text-sm" style={{ color: "var(--c-accent)" }}>{sent}</span>}
          {send.error && (
            <span className="flex items-start gap-1.5 text-sm text-red-400"><AlertTriangle size={14} className="mt-0.5 shrink-0" /> {(send.error as Error).message}</span>
          )}
        </div>
      </section>

      <section className="card p-5">
        <h2 className="mb-3 text-[17px] font-bold">Your earlier reports</h2>
        {mine.filter((r) => r.work_date !== today).length === 0 ? (
          <p className="text-sm text-faint">None yet.</p>
        ) : (
          <div className="space-y-3">
            {mine.filter((r) => r.work_date !== today).map((r) => <ReportView key={r.id} r={r} />)}
          </div>
        )}
      </section>
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder: string;
}) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3} maxLength={4000}
        placeholder={placeholder} className="input w-full text-sm" />
    </label>
  );
}

/** One report, read-only. Shared with the client's Staff tab. */
export function ReportView({ r, who }: { r: { work_date: string; done: string; blocked: string; next: string; updated_at: string }; who?: string | null }) {
  return (
    <article className="rounded-xl bg-surface-2 p-3">
      <p className="mb-1.5 flex flex-wrap items-center gap-x-2 text-sm font-semibold">
        <ClipboardList size={14} className="text-faint" />
        {who ? <span className="min-w-0 truncate">{who}</span> : null}
        <span className={who ? "text-xs font-normal text-faint" : ""}>{dayLabel(dateOnly(r.work_date))}</span>
      </p>
      <Block title="Done" text={r.done} />
      {r.blocked ? <Block title="Blocked" text={r.blocked} tone="text-amber-400" /> : null}
      {r.next ? <Block title="Next" text={r.next} /> : null}
    </article>
  );
}

function Block({ title, text, tone }: { title: string; text: string; tone?: string }) {
  return (
    <div className="mt-1.5">
      <p className={`text-[11px] font-bold uppercase tracking-wider ${tone ?? "text-faint"}`}>{title}</p>
      <p className="whitespace-pre-wrap break-words text-sm text-muted">{text}</p>
    </div>
  );
}
