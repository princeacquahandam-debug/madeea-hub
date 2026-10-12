import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ClipboardList, CheckCircle2, ArrowRight, AlertTriangle } from "lucide-react";
import { useEodReports, useTasks, useWorkspaceMembers } from "@/data/hooks";
import { draftFromTasks } from "@/lib/eodDraft";

/**
 * Today's EOD, on the Dashboard.
 *
 * The flow this closes is EOD -> Dashboard -> Task Manager. The report is built
 * from tasks, so this card shows what the report WOULD say if filed right now,
 * drawn from the board rather than from anything typed here.
 *
 * Two states worth distinguishing, because they mean opposite things to an
 * admin looking at compliance: filed, and not filed yet. A card that showed
 * only the draft would never tell you which.
 */
export function EodCard() {
  const nav = useNavigate();
  const { data: reports = [] } = useEodReports();
  const { data: tasks = [] } = useTasks();
  const { data: members = [] } = useWorkspaceMembers();

  const me = members.find((m) => m.is_me);
  const today = new Date().toISOString().slice(0, 10);

  const filed = useMemo(
    () => reports.find((r) => r.person === me?.name && r.report_date === today),
    [reports, me, today],
  );

  // What the report would say, straight off the board. Same function the EOD
  // page drafts with, so the two can never disagree.
  const draft = useMemo(() => draftFromTasks(tasks, me?.user_id, today), [tasks, me, today]);

  const done = filed ? filed.done : draft.done;
  const blockers = filed ? filed.blockers : draft.blockers;
  const plans = filed ? filed.plans : draft.plans;

  return (
    <section className="card p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <ClipboardList size={16} className="text-accent" />
        <h2 className="text-[15px] font-semibold">End-of-day report</h2>
        {filed ? (
          <span className="pill bg-emerald-500/15 text-emerald-400">
            <CheckCircle2 size={11} className="mr-1 inline" />Submitted
          </span>
        ) : (
          <span className="pill bg-surface-2 text-muted">Not submitted</span>
        )}
        <button
          onClick={() => nav("/eod")}
          className="ml-auto inline-flex items-center gap-1 text-[13px] font-semibold text-accent-soft hover:text-accent"
        >
          {filed ? "Open" : "Submit report"} <ArrowRight size={14} />
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Column label="Completed today" tone="text-text" items={done} empty="No tasks completed yet" />
        <Column label="Blockers" tone="text-text" items={blockers} empty="No blockers" icon />
        <Column label="Plan for tomorrow" tone="text-text" items={plans} empty="No tasks planned" />
      </div>

      {!filed && (
        <p className="mt-3 text-[12px] text-faint">
          Tasks you move to Done are added here automatically.
        </p>
      )}
    </section>
  );
}

function Column({
  label, items, empty, tone, icon,
}: { label: string; items: string[]; empty: string; tone: string; icon?: boolean }) {
  return (
    <div className="rounded-lg bg-[rgb(var(--c-bg))] p-3">
      <p className={`mb-1.5 text-xs font-semibold ${tone}`}>
        {label} {items.length > 0 && <span className="text-faint">{items.length}</span>}
      </p>
      {items.length === 0 ? (
        <p className="text-[12.5px] text-faint">{empty}</p>
      ) : (
        <ul className="space-y-1">
          {items.slice(0, 4).map((t) => (
            <li key={t} className="flex items-start gap-1.5 text-[12.5px] text-muted">
              {icon && <AlertTriangle size={11} className="mt-1 shrink-0 text-red-400/70" />}
              <span className="line-clamp-2">{t}</span>
            </li>
          ))}
          {items.length > 4 && <li className="text-[12px] text-faint">and {items.length - 4} more</li>}
        </ul>
      )}
    </div>
  );
}
