import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Clock3, RotateCcw, ShieldCheck } from "lucide-react";
import { Modal, PageHeader } from "@/components/ui";
import { atLeast, useMyRole, useTaskMutations, useTasks, useWorkspaceMembers } from "@/data/hooks";
import type { Task } from "@/types/db";
import { cn } from "@/lib/utils";

/**
 * Approvals: client-facing work that needs an owner's or admin's sign-off
 * (QA write test WA-14, 23 Nov 2026).
 *
 * "Needs approval" on a task (0030) stops it being marked Done until someone
 * approves it. Approving lived only inside each task, so nobody could see what
 * was waiting, and the only answer was yes. This page lists what is waiting,
 * lets the approver send work back with a reason (0110), and keeps the record
 * of who approved what, and when.
 *
 * Who may approve or send back is checked by the database, not just here.
 */

const DAY = 864e5;
const STATUS_LABEL: Record<string, string> = {
  todo: "To do", in_progress: "In progress", follow_up: "Waiting", review: "Ready for review", done: "Done",
};

function when(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export default function Approvals() {
  const { data: role } = useMyRole();
  const canApprove = atLeast(role, "admin");
  const { data: tasks = [], isLoading } = useTasks();
  const { data: members = [] } = useWorkspaceMembers();
  const { approve, sendBack } = useTaskMutations();
  const [backTask, setBackTask] = useState<Task | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  const nameOf = (id: string | null | undefined) =>
    (id && members.find((m) => m.user_id === id)?.name) || (id ? "Someone" : "Unassigned");

  const { waiting, returned, approved } = useMemo(() => {
    const gated = tasks.filter((t) => t.requires_approval);
    const monthAgo = new Date(Date.now() - 30 * DAY).toISOString();
    const order = (t: Task) => (t.status === "review" ? 0 : 1);
    return {
      // Submitted for review first, then anything else still open.
      waiting: gated
        .filter((t) => !t.approved_at && t.status !== "done" && (!t.returned_at || t.status === "review"))
        .sort((a, b) => order(a) - order(b) || (a.due_at ?? "9").localeCompare(b.due_at ?? "9")),
      returned: gated
        .filter((t) => !t.approved_at && t.returned_at && t.status !== "review" && t.status !== "done")
        .sort((a, b) => (b.returned_at ?? "").localeCompare(a.returned_at ?? "")),
      approved: gated
        .filter((t) => t.approved_at && t.approved_at >= monthAgo)
        .sort((a, b) => (b.approved_at ?? "").localeCompare(a.approved_at ?? "")),
    };
  }, [tasks]);

  async function doApprove(t: Task) {
    setError("");
    try { await approve.mutateAsync(t.id); }
    catch (e) { setError(e instanceof Error ? e.message : "Couldn't approve that."); }
  }

  async function doSendBack() {
    if (!backTask || !reason.trim()) return;
    setError("");
    try {
      await sendBack.mutateAsync({ id: backTask.id, reason: reason.trim() });
      setBackTask(null);
      setReason("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send that back.");
    }
  }

  const row = (t: Task, actions: boolean) => (
    <li key={t.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <Link to={`/tasks?task=${t.id}`} className="break-words text-sm font-medium hover:text-accent">{t.title}</Link>
        <p className="mt-0.5 text-xs text-faint">
          {t.client_id ? t.client_name : "No client"} · {nameOf(t.assignee_id ?? t.owner_id)}
          {" · "}
          <span className={cn(t.status === "review" && "font-medium text-violet-400")}>{STATUS_LABEL[t.status] ?? t.status}</span>
          {t.due_at ? ` · due ${new Date(t.due_at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : ""}
        </p>
        {t.returned_at && t.return_reason ? (
          !t.approved_at && t.status === "review" ? (
            /* Back in Review after changes (QA AP-04): the earlier note is history. */
            <p className="mt-1 text-xs text-muted">
              <span className="pill mr-1.5 bg-violet-500/15 text-violet-400">Resubmitted</span>
              Earlier sent back by {nameOf(t.returned_by)} {when(t.returned_at)}: {t.return_reason}
            </p>
          ) : (
            <p className="mt-1 text-xs text-amber-400">
              Sent back by {nameOf(t.returned_by)} {when(t.returned_at)}: {t.return_reason}
            </p>
          )
        ) : null}
        {t.approved_at ? (
          <p className="mt-1 text-xs text-emerald-500">Approved by {nameOf(t.approved_by)} {when(t.approved_at)}</p>
        ) : null}
      </div>
      {actions && canApprove ? (
        <div className="flex shrink-0 gap-2">
          <button className="btn-ghost border border-border text-xs" onClick={() => { setBackTask(t); setReason(""); setError(""); }}>
            <RotateCcw size={13} /> Send back
          </button>
          <button className="btn-primary text-xs" disabled={approve.isPending} onClick={() => void doApprove(t)}>
            <ShieldCheck size={13} /> Approve
          </button>
        </div>
      ) : null}
    </li>
  );

  const section = (title: string, icon: React.ReactNode, list: Task[], empty: string, actions: boolean) => (
    <section className="card mb-4 overflow-hidden" aria-label={title}>
      <h2 className="flex items-center gap-2 border-b border-border px-4 py-3 text-sm font-semibold">
        {icon} {title} <span className="pill bg-surface-2 text-muted">{list.length}</span>
      </h2>
      {list.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-faint">{empty}</p>
      ) : (
        <ul className="divide-y divide-border">{list.map((t) => row(t, actions))}</ul>
      )}
    </section>
  );

  return (
    <div>
      <PageHeader
        title="Approvals"
        subtitle="Work marked Needs approval can't be completed until an owner or admin approves it. Approve it here, or send it back with what needs changing."
      />
      {error ? (
        <p role="alert" className="mb-3 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {error}
        </p>
      ) : null}
      {isLoading ? (
        <p className="text-sm text-faint">Loading approvals…</p>
      ) : (
        <>
          {section("Waiting for approval", <Clock3 size={15} className="text-violet-400" />, waiting,
            "Nothing is waiting. Tick \"Needs approval\" on a task to route it here.", true)}
          {section("Sent back", <RotateCcw size={15} className="text-amber-400" />, returned,
            "Nothing sent back. Work that needs changes waits here until the assistant moves it to Review again.", false)}
          {section("Approved in the last 30 days", <CheckCircle2 size={15} className="text-emerald-500" />, approved,
            "Nothing approved yet.", false)}
        </>
      )}

      <Modal open={backTask !== null} onClose={() => setBackTask(null)}>
        {backTask ? (
          <div>
            <h2 className="pr-10 text-lg font-semibold">Send back for changes</h2>
            <p className="mt-1 break-words text-sm text-muted">{backTask.title}</p>
            <label htmlFor="return-reason" className="field-label mt-4">What needs changing?</label>
            <textarea id="return-reason" className="input min-h-[90px]" maxLength={1000} autoFocus
              value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Use the client's new logo and fix the date on page 2" />
            <p className="mt-1 text-xs text-faint">The task goes back to In progress, with this note on it and in its comments. It isn't shown to the client.</p>
            {error ? <p className="mt-2 text-sm text-red-400">{error}</p> : null}
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn-ghost border border-border" onClick={() => setBackTask(null)}>Cancel</button>
              <button className="btn-primary" disabled={!reason.trim() || sendBack.isPending} onClick={() => void doSendBack()}>
                <RotateCcw size={14} /> {sendBack.isPending ? "Sending back…" : "Send back"}
              </button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
