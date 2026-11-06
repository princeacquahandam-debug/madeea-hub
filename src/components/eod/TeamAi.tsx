import { useState, type ReactNode } from "react";
import { Eye, MessageSquare } from "lucide-react";
import { AiActionBar, AiCard } from "@/components/ai/AiResult";
import { ClientWeeklyPanel } from "@/components/eod/ClientWeeklyPanel";
import {
  ATTENTION_EMPTY, findAttention, NO_REPORT_DAYS, OVERDUE_TASKS, runTeamAttention, runTeamSummary, SAME_BLOCKER_REPORTS, short, TEAM_EMPTY, weekAround,
  type AttentionRow, type TeamScope, type TeamSummary,
} from "@/lib/eodAi";
import { useMadeline } from "@/store/madeline";
import type { Client, EodReport, Task } from "@/types/db";

/**
 * The EOD Team view's ✦ quick actions (Abder's "AI quick actions and cost"
 * deck, 6 Nov 2026), for admins. All three follow the month and EA filters
 * and keep to neutral, factual wording. One result open at a time.
 *
 * Returns the buttons and the open result separately, so the page can put
 * the buttons beside its filters and the result above its stats.
 */
type Open = "summary" | "attention" | "weekly" | null;

export function useTeamAi(opts: {
  scope: TeamScope;
  allReports: EodReport[];
  month: string;
  today: string;
  tasks: Task[];
  clients: Client[];
  idOf: (name: string) => string | undefined;
  /** The EA filter: "all" or a name. */
  ea: string;
  sender?: string;
  onOpenReport: (r: EodReport) => void;
  onViewReports: (person: string) => void;
}): { bar: ReactNode; result: ReactNode } {
  const { scope } = opts;
  const [open, setOpen] = useState<Open>(null);
  const [at, setAt] = useState(() => new Date());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<TeamSummary | null>(null);
  const [attention, setAttention] = useState<AttentionRow[] | null>(null);
  const close = () => { setOpen(null); setError(null); };

  async function runSummary() {
    setOpen("summary"); setAt(new Date()); setError(null); setSummary(null);
    if (!scope.reports.length) return;
    setBusy(true);
    try { setSummary((await runTeamSummary(scope)).data); }
    catch (e) { setError(e instanceof Error ? e.message : "Madeline couldn't be reached. Try again."); }
    finally { setBusy(false); }
  }

  async function runAttention() {
    setOpen("attention"); setAt(new Date()); setError(null); setAttention(null);
    const rows = findAttention({
      people: scope.people, allReports: opts.allReports, monthReports: scope.reports, month: opts.month, today: opts.today, tasks: opts.tasks, idOf: opts.idOf,
    });
    if (!rows.length) { setAttention([]); return; }
    setBusy(true);
    try { setAttention((await runTeamAttention(rows)).data); }
    catch (e) {
      // The rules found them; if the wording fails, their own facts still stand.
      console.error("AI wording for attention rows failed", e);
      setAttention(rows);
    }
    finally { setBusy(false); }
  }

  /* The week the update covers: this week for the current month, or the last
     week of the month being looked at, so it follows the month filter. */
  const [y, m] = opts.month.split("-").map(Number);
  const monthEnd = `${opts.month}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
  const week = weekAround(monthEnd < opts.today ? monthEnd : opts.today);

  const bar = (
    <AiActionBar
      page="/eod"
      actions={[
        { label: "Summarize the team", help: "Submission rate, main blockers and highlights for this month and filter", run: () => void runSummary(), busy: busy && open === "summary" },
        { label: "Who needs attention?", help: `No report for ${NO_REPORT_DAYS}+ working days, the same blocker in ${SAME_BLOCKER_REPORTS}+ reports, or ${OVERDUE_TASKS}+ overdue tasks`, run: () => void runAttention(), busy: busy && open === "attention" },
        { label: "Client weekly report", help: "A ready-to-send weekly update for a client, from the week's reports and tasks", run: () => { setOpen("weekly"); setAt(new Date()); }, disabled: !opts.clients.length, disabledHelp: "No clients yet." },
      ]}
    />
  );

  const linkBtn = "font-semibold text-accent-soft hover:underline";
  let result: ReactNode = null;
  if (open === "summary") {
    result = (
      <AiCard
        title="Team summary"
        source={`${scope.reports.length} EOD ${scope.reports.length === 1 ? "report" : "reports"}, ${scope.label}`}
        at={at}
        loading={busy}
        error={error}
        summary={scope.reports.length ? summary?.summary : undefined}
        empty={scope.reports.length ? null : TEAM_EMPTY}
        onClose={close}
        onRefresh={() => void runSummary()}
        chat={summary ? `About the team's EOD reports (${scope.label}): ${summary.summary} Blockers: ${summary.themes.map((t) => t.text).join("; ") || "none"}. What should I follow up on?` : undefined}
      >
        {summary && (
          <div className="space-y-3 text-sm" data-testid="team-summary">
            {summary.themes.length > 0 && (
              <div>
                <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-faint">Blocker themes</p>
                <ul className="space-y-1">
                  {summary.themes.map((t) => (
                    <li key={t.text} className="flex flex-wrap items-baseline gap-x-2">
                      <span className="min-w-0 flex-1">{t.text}</span>
                      <span className="flex flex-wrap gap-x-2 text-xs">
                        {t.reports.map((r) => (
                          <button key={r.id} className={linkBtn} onClick={() => opts.onOpenReport(r)}>{(r.person ?? "").split(" ")[0]} · {short(r.report_date)}</button>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {summary.highlights.length > 0 && (
              <div>
                <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-faint">Highlights</p>
                <ul className="space-y-1">
                  {summary.highlights.map((h) => (
                    <li key={h.report.id + h.text} className="flex flex-wrap items-baseline gap-x-2">
                      <span className="min-w-0 flex-1">{h.text}</span>
                      <button className={`${linkBtn} text-xs`} onClick={() => opts.onOpenReport(h.report)}>View report</button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {!summary.themes.length && !summary.highlights.length && <p className="text-muted">No blockers or completions stand out in these reports.</p>}
          </div>
        )}
      </AiCard>
    );
  } else if (open === "attention") {
    result = (
      <AiCard
        title="Who needs attention?"
        source={`EOD reports and tasks, ${scope.label}. Rules: no report for ${NO_REPORT_DAYS}+ working days, the same blocker in ${SAME_BLOCKER_REPORTS}+ reports, ${OVERDUE_TASKS}+ overdue tasks`}
        at={at}
        loading={busy}
        error={error}
        summary={attention?.length ? `${attention.length} ${attention.length === 1 ? "person matches" : "people match"} a rule.` : undefined}
        empty={attention && !attention.length ? ATTENTION_EMPTY : null}
        onClose={close}
        onRefresh={() => void runAttention()}
        chat={attention?.length ? `These team members may need support: ${attention.map((r) => `${r.person} (${r.facts.join("; ")})`).join(", ")}. How should I approach each?` : undefined}
      >
        {attention && (
          <ul className="divide-y divide-border" data-testid="attention-rows">
            {attention.map((r) => (
              <li key={r.person} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                <span className="w-36 shrink-0 truncate font-semibold">{r.person}</span>
                <span className="min-w-0 flex-1 text-muted">{r.reason}</span>
                {/* No direct messages in the app, so Message opens Madeline with a draft to edit; nothing is sent. */}
                <button
                  className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-border px-2 text-xs font-semibold hover:bg-[var(--chip-bg)]"
                  onClick={() => { close(); useMadeline.getState().ask(`Help me write a short, supportive message to ${r.person}. Facts: ${r.facts.join("; ")}.`, { send: false }); }}
                >
                  <MessageSquare size={12} /> Message
                </button>
                <button
                  className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-border px-2 text-xs font-semibold hover:bg-[var(--chip-bg)]"
                  onClick={() => { close(); opts.onViewReports(r.person); }}
                >
                  <Eye size={12} /> View reports
                </button>
              </li>
            ))}
          </ul>
        )}
      </AiCard>
    );
  } else if (open === "weekly") {
    result = (
      <ClientWeeklyPanel
        clients={opts.clients}
        tasks={opts.tasks}
        reports={opts.allReports.filter((r) => opts.ea === "all" || r.person === opts.ea)}
        lo={week.lo}
        hi={week.hi}
        // An EA with no account (an imported name) has no tasks to count.
        assigneeId={opts.ea === "all" ? undefined : opts.idOf(opts.ea) ?? "none"}
        scopeLabel={opts.ea === "all" ? "all EAs" : opts.ea}
        sender={opts.sender}
        onClose={close}
      />
    );
  }
  return { bar, result };
}
