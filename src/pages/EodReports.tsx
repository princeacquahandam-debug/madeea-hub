import { useEffect, useMemo, useState } from "react";
import {
  ClipboardList,
  Percent,
  CalendarDays,
  CheckSquare,
  AlertTriangle,
  ListTodo,
  ChevronDown,
  ChevronRight,
  Link2,
  Send,
  Sparkles,
  HelpCircle,
  Trash2,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Badge, PageHeader } from "@/components/ui";
import { PageTour, usePageTour, type TourStep } from "@/components/PageTour";
import { EOD_DATA, type CellStatus } from "@/data/eod";
import { EOD_DATES, EOD_PEOPLE, IMPORTED_EOD } from "@/data/eodImport";
import { atLeast, useDeleteEod, useEodReports, useMyRole, useSubmitEod, useTaskMutations, useTasks, useWorkspaceMembers } from "@/data/hooks";
import { draftFromTasks, todayIso, type EodDraft as EodDraftState } from "@/lib/eodDraft";
import type { EodReport } from "@/types/db";
import { cn } from "@/lib/utils";

const IMPORTED_COUNT = IMPORTED_EOD.length;

// Self-serve walkthrough so the page explains itself. No live demo to the team.
const TOUR_KEY = "madeea-tour-eod";
const TOUR_STEPS: TourStep[] = [
  {
    title: "This is your EOD, done for you",
    body: "No more retyping into a sheet. Your end-of-day report is drafted from the work you already track on the board. Here's the 30-second tour.",
  },
  {
    selector: '[data-tour="eod-today"]',
    title: "Today's report, pre-filled",
    body: "Completed tasks, blocked tasks, and what's still open are pulled straight from your Task Manager. Edit any line, then submit, that's your EOD.",
  },
  {
    selector: '[data-tour="eod-notes"]',
    title: "Add what the board can't know",
    body: "Meetings, calls, a subscription that's down. Anything that isn't a task goes in Notes so your report is complete.",
  },
  {
    selector: '[data-tour="eod-kpis"]',
    title: "Team at a glance",
    body: "Live totals across everyone: submissions, tasks done, blockers raised and plans set for the days ahead.",
  },
  {
    selector: '[data-tour="eod-compliance"]',
    title: "Who's reporting",
    body: "Completion per person, plus a coverage grid of every day. This is why submitting matters: it's what compliance counts.",
  },
  {
    selector: '[data-tour="eod-reports"]',
    title: "Every report, searchable",
    body: "Filter by member, by date, or just the ones with blockers. Nothing gets lost in a spreadsheet tab.",
  },
  {
    selector: '[data-tour="eod-tour-btn"]',
    title: "Replay any time",
    body: "New teammate? Forgot a step? This button restarts the tour whenever you need it.",
  },
];

const KPI_ICONS = [ClipboardList, Percent, CalendarDays, CheckSquare, AlertTriangle, ListTodo];
const KPI_ICON_COLORS = [
  "text-accent",
  "text-amber-400",
  "text-sky-400",
  "text-emerald-400",
  "text-red-400",
  "text-violet-400",
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "2026-07-13" → "Jul 13". Parsed by hand so no timezone can shift the day.
 * Tolerates undefined: reports load async, so any date can be missing on the
 * first render.
 */
function fmtDate(iso: string | undefined): string {
  if (!iso) return "-";
  const [, m, d] = iso.split("-");
  return `${MONTHS[Number(m) - 1]} ${Number(d)}`;
}

/** Day-of-week without local-timezone drift. */
function isWeekend(iso: string): boolean {
  const [y, m, d] = iso.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow === 0 || dow === 6;
}

function pct(x: number): string {
  return `${(x * 100).toFixed(2)}%`;
}

const CELL_STYLES: Record<CellStatus, string> = {
  submitted: "bg-accent",
  template: "bg-amber-500/20 border border-amber-500/40",
  empty: "bg-surface-2 border border-border",
};
const CELL_LABELS: Record<CellStatus, string> = {
  submitted: "submitted a report",
  template: "blank template, never filled in",
  empty: "empty cell",
};

export default function EodReports() {
  const { meta } = EOD_DATA;
  const { data: reports = [] } = useEodReports();
  const { data: tasks = [] } = useTasks();
  const { data: members = [] } = useWorkspaceMembers();
  const submit = useSubmitEod();
  const remove = useDeleteEod();
  const { create: createTask } = useTaskMutations();
  const { data: role } = useMyRole();
  const isAdmin = atLeast(role, "admin");

  const [person, setPerson] = useState<string>("all");
  const [date, setDate] = useState<string>("all");
  const [blockersOnly, setBlockersOnly] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  /* The blocker feed opens short. It is the section people scroll PAST to reach
     the reports, and at 23 verbatim paragraphs it was several screens of text
     before anything else on the page could be reached. */
  const [allBlockers, setAllBlockers] = useState(false);
  // Tour no longer auto-opens on EOD. Only via the "Replay" button below.
  const tour = usePageTour(TOUR_KEY, false);

  // ---- the report you're filing: drafted from the board, edited and submitted ----
  const today = todayIso();
  const me = members.find((m) => m.is_me);

  /**
   * Which day this report covers. Defaults to today, but is changeable so
   * someone catching up can file for a day they missed. Previously this was
   * pinned to today and back-filling was impossible.
   */
  const [reportDate, setReportDate] = useState(today);

  const myReportForDate = useMemo(
    () => reports.find((r) => r.person === me?.name && r.report_date === reportDate),
    [reports, me, reportDate],
  );
  // Drafting respects the chosen day: pick an earlier date and it pulls the
  // tasks you completed on THAT day, not today's.
  const autoDraft = useMemo(() => draftFromTasks(tasks, me?.user_id, reportDate), [tasks, me, reportDate]);
  const [draft, setDraft] = useState(autoDraft);
  const [notes, setNotes] = useState("");
  const [touched, setTouched] = useState(false);

  // Re-sync from the board while the draft is untouched, so completing a task
  // shows up here immediately. Once edited, your text wins.
  useEffect(() => {
    if (touched) return;
    setDraft(
      myReportForDate
        ? { done: myReportForDate.done, blockers: myReportForDate.blockers, plans: myReportForDate.plans }
        : autoDraft,
    );
    setNotes(myReportForDate?.notes ?? "");
  }, [autoDraft, myReportForDate, touched]);

  const editDraft = (next: typeof draft) => {
    setTouched(true);
    setDraft(next);
  };

  /** Switching day discards an unsaved draft and loads that day's instead. */
  const changeReportDate = (next: string) => {
    setReportDate(next);
    setTouched(false);
    setNotes("");
  };

  /**
   * R-4.3.4. Rowena, 1:07:10: a next step in the EOD should land in the to-do
   * list for the following day rather than being retyped there.
   *
   * The day after the report, not tomorrow-from-now: file Monday's EOD on
   * Tuesday and its plan still belongs on Monday+1. Assigned to you, because a
   * line in your own report is your own work.
   */
  const pushPlanToBoard = (title: string) => {
    const [y, m, d] = reportDate.split("-").map(Number);
    const next = new Date(y, m - 1, d + 1);
    const p = (n: number) => String(n).padStart(2, "0");
    createTask.mutate({
      title,
      priority: "normal",
      due_at: `${next.getFullYear()}-${p(next.getMonth() + 1)}-${p(next.getDate())}`,
      assignee_id: me?.user_id ?? null,
    });
  };

  /**
   * Everyone who has ever reported: the sheet's eight, plus anyone who has
   * submitted since.
   *
   * Deliberately NOT "every current workspace member". Completion divides by
   * people.length, so folding in the live roster would let a new hire silently
   * rewrite July's numbers (33/248 = 13.31% became 33/310 = 10.65% the moment
   * two demo members appeared). July is settled history measured over eight
   * people, and it has to keep matching the sheet the team already reads.
   * A member shows up here the first time they submit.
   */
  const people = useMemo(() => {
    const names = [...EOD_PEOPLE];
    for (const r of reports) if (r.person && !names.includes(r.person)) names.push(r.person);
    return names;
  }, [reports]);

  // Every dated row the sheet defined, extended by any day reported since.
  const dates = useMemo(() => {
    const set = new Set(EOD_DATES);
    for (const r of reports) set.add(r.report_date);
    return [...set].sort();
  }, [reports]);

  const entries = reports;

  /**
   * Cell status. The sheet's "blank template" state is history: it explains why
   * July reads low and is preserved for those dates. Days after the sheet was
   * retired are simply submitted or not.
   */
  const matrix = useMemo(() => {
    const m: Record<string, CellStatus> = {};
    const submitted = new Set(reports.map((r) => `${r.person}|${r.report_date}`));
    for (const p of people) {
      for (const d of dates) {
        const key = `${p}|${d}`;
        m[key] = submitted.has(key) ? "submitted" : EOD_DATA.matrix[key] ?? "empty";
      }
    }
    return m;
  }, [people, dates, reports]);

  const stats = useMemo(() => {
    const byPerson: Record<string, { subs: number; done: number; blockers: number; plans: number; days: string[] }> = {};
    people.forEach((p) => (byPerson[p] = { subs: 0, done: 0, blockers: 0, plans: 0, days: [] }));
    const byDate: Record<string, number> = {};
    dates.forEach((d) => (byDate[d] = 0));

    entries.forEach((e) => {
      const s = byPerson[e.person ?? ""];
      if (!s) return;
      s.subs += 1;
      s.done += e.done.length;
      s.blockers += e.blockers.length;
      s.plans += e.plans.length;
      s.days.push(e.report_date);
      if (e.report_date in byDate) byDate[e.report_date] += 1;
    });

    const cells = Object.values(matrix);
    return {
      byPerson,
      byDate,
      totalSubs: entries.length,
      totalDone: entries.reduce((a, e) => a + e.done.length, 0),
      totalBlockers: entries.reduce((a, e) => a + e.blockers.length, 0),
      totalPlans: entries.reduce((a, e) => a + e.plans.length, 0),
      totalLinks: entries.reduce((a, e) => a + (e.links?.length ?? 0), 0),
      withBlockers: entries.filter((e) => e.blockers.length > 0).length,
      activeDates: dates.filter((d) => byDate[d] > 0),
      counts: {
        submitted: cells.filter((c) => c === "submitted").length,
        template: cells.filter((c) => c === "template").length,
        empty: cells.filter((c) => c === "empty").length,
      },
    };
  }, [people, dates, matrix, entries]);

  // Live Kanban metrics. These replace the sheet's Task Tracker tab, which held
  // the same four columns and never had a single row in it.
  const kanban = useMemo(() => {
    const done = tasks.filter((t) => t.status === "done").length;
    return {
      total: tasks.length,
      open: tasks.length - done,
      blocked: tasks.filter((t) => t.blocked).length,
      rate: tasks.length ? done / tasks.length : 0,
    };
  }, [tasks]);

  const { byPerson, byDate, activeDates, counts } = stats;
  // Days where everyone expected to report actually did.
  const fullTurnoutDays = activeDates.filter((d) => byDate[d] === people.length).length;
  // The sheet divides every member by a fixed 31, so this is the highest anyone
  // could score in a period where only `activeDates` were ever reported on.
  const ceiling = activeDates.length / meta.denominator;
  const teamCompletion = stats.totalSubs / (people.length * meta.denominator);
  const maxDay = Math.max(...dates.map((d) => byDate[d]), 1);

  // Guard every average: reports load async, so totalSubs is 0 on first render
  // and a bare division would print NaN.
  const avg = (n: number) => (stats.totalSubs ? (n / stats.totalSubs).toFixed(1) : "0");
  const kpis = [
    { label: "Submissions", value: stats.totalSubs, foot: `across ${people.length} members` },
    { label: "Team Completion", value: pct(teamCompletion), foot: `${stats.totalSubs} of ${people.length * meta.denominator} possible` },
    { label: "Days With Reports", value: activeDates.length, foot: `of ${dates.length} dated rows` },
    { label: "Tasks Completed", value: stats.totalDone, foot: `${avg(stats.totalDone)} avg per report` },
    { label: "Blockers Raised", value: stats.totalBlockers, foot: `${stats.withBlockers} of ${stats.totalSubs} reports` },
    { label: "Planned Items", value: stats.totalPlans, foot: `${avg(stats.totalPlans)} avg per report` },
  ];

  const blockerFeed = useMemo(
    () =>
      [...entries]
        .sort((a, b) => a.report_date.localeCompare(b.report_date))
        .flatMap((e) =>
          e.blockers.map((b, i) => ({
            key: `${e.person}-${e.report_date}-${i}`,
            person: e.person ?? "",
            date: e.report_date,
            text: b,
          })),
        ),
    [entries],
  );

  const visible = useMemo(
    () =>
      [...entries]
        .sort((a, b) =>
          a.report_date === b.report_date
            ? people.indexOf(a.person ?? "") - people.indexOf(b.person ?? "")
            : b.report_date.localeCompare(a.report_date),
        )
        .filter(
          (e) =>
            (person === "all" || e.person === person) &&
            (date === "all" || e.report_date === date) &&
            (!blockersOnly || e.blockers.length > 0),
        ),
    [entries, people, person, date, blockersOnly],
  );

  return (
    <div>
      <PageTour steps={TOUR_STEPS} storageKey={TOUR_KEY} open={tour.open} onClose={tour.close} />

      <PageHeader
        title="EOD Reports"
        subtitle={`Daily end-of-day reporting, submission compliance and blockers · ${fmtDate(dates[0])} – ${fmtDate(
          dates[dates.length - 1],
        )} 2026`}
        action={
          <div className="flex shrink-0 items-center gap-2">
            {myReportForDate && (
              <span className="pill bg-emerald-500/15 text-emerald-400">
                {reportDate === today ? "Today's EOD submitted" : `${fmtDate(reportDate)} submitted`}
              </span>
            )}
            <button data-tour="eod-tour-btn" className="btn-ghost border border-border" onClick={tour.replay}>
              <HelpCircle size={15} />
              Tour
            </button>
          </div>
        }
      />

      <TodayEod
        me={me?.name}
        draft={draft}
        onChange={editDraft}
        notes={notes}
        onNotes={setNotes}
        existing={myReportForDate}
        saving={submit.isPending}
        reportDate={reportDate}
        today={today}
        onDateChange={changeReportDate}
        onSubmit={() =>
          submit.mutate({
            person: me?.name ?? "",
            report_date: reportDate,
            done: draft.done,
            blockers: draft.blockers,
            plans: draft.plans,
            notes,
          })
        }
        onPushPlan={pushPlanToBoard}
      />

      {/* ---------------- KPIs ---------------- */}
      <div data-tour="eod-kpis" className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {kpis.map((kpi, i) => {
          const Icon = KPI_ICONS[i];
          const alert = kpi.label === "Blockers Raised" && stats.totalBlockers > 0;
          return (
            <div key={kpi.label} className={cn("card p-4", alert && "border-red-500/40")}>
              <div className="flex items-center justify-between">
                <span className="eyebrow">{kpi.label}</span>
                <Icon size={16} className={KPI_ICON_COLORS[i]} />
              </div>
              <p className={cn("display mt-2 text-4xl", alert && "text-red-400")}>{kpi.value}</p>
              <p className="mt-1 text-[11px] text-faint">{kpi.foot}</p>
            </div>
          );
        })}
      </div>

      {/* Why completion reads low, the single most misread number on this page. */}
      {activeDates.length > 0 && (
        <div className="card mt-5 border-accent/40 bg-accent/5 p-4">
          <p className="text-sm text-muted">
            <span className="font-semibold text-accent-soft">Reading completion:</span> reports so far run{" "}
            <strong className="text-zinc-100">
              {fmtDate(activeDates[0])} – {fmtDate(activeDates[activeDates.length - 1])}
            </strong>
            , but completion divides each member by a fixed <strong className="text-zinc-100">{meta.denominator}</strong> days, the way the
            sheet always has. It therefore tops out at <strong className="text-zinc-100">{pct(ceiling)}</strong> even for someone who reported
            every active day.{" "}
            {fullTurnoutDays > 0 && (
              <>
                Turnout itself was strong:{" "}
                <strong className="text-zinc-100">
                  {fullTurnoutDays} of {activeDates.length}
                </strong>{" "}
                active days saw every member report.
              </>
            )}
          </p>
        </div>
      )}

      {/* ---------------- Compliance ---------------- */}
      <section data-tour="eod-compliance" className="card mt-5 p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="font-semibold">Submission Compliance</h2>
          <span className="text-xs text-faint">Dashed marker = best possible this period ({pct(ceiling)})</span>
        </div>

        <div className="space-y-2.5">
          {people.map((p) => {
            const s = byPerson[p];
            const c = s.subs / meta.denominator;
            return (
              <div key={p} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:grid-cols-[11rem_1fr_4rem]">
                <span className="truncate text-sm text-muted">{p}</span>
                <div className="relative order-3 col-span-2 h-2 rounded-full bg-surface-2 sm:order-none sm:col-span-1">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${c * 100}%` }} />
                  <span
                    className="absolute -top-1 -bottom-1 border-l border-dashed border-zinc-400/50"
                    style={{ left: `${ceiling * 100}%` }}
                    title={`Best possible this period: ${pct(ceiling)}`}
                  />
                </div>
                <span className="text-right text-xs tabular-nums text-amber-400">{pct(c)}</span>
              </div>
            );
          })}
        </div>

        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[46rem] text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="eyebrow py-2 pr-3 font-semibold">Team member</th>
                <th className="eyebrow py-2 px-3 text-right font-semibold">Submissions</th>
                <th className="eyebrow py-2 px-3 text-right font-semibold">Completion</th>
                <th className="eyebrow py-2 px-3 text-right font-semibold">Tasks done</th>
                <th className="eyebrow py-2 px-3 text-right font-semibold">Blockers</th>
                <th className="eyebrow py-2 px-3 text-right font-semibold">Plans</th>
                <th className="eyebrow py-2 px-3 text-right font-semibold">Avg / report</th>
                <th className="eyebrow py-2 pl-3 font-semibold">First → last</th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => {
                const s = byPerson[p];
                const days = [...s.days].sort();
                return (
                  <tr key={p} className="border-b border-border/60 last:border-0">
                    <td className="py-2.5 pr-3 font-medium">{p}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums">{s.subs}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums text-amber-400">{pct(s.subs / meta.denominator)}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums">{s.done}</td>
                    <td className={cn("py-2.5 px-3 text-right tabular-nums", s.blockers > 0 && "text-red-400")}>{s.blockers}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums">{s.plans}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums">{s.subs ? (s.done / s.subs).toFixed(1) : "0"}</td>
                    <td className="py-2.5 pl-3 text-xs text-faint">
                      {days.length ? `${fmtDate(days[0])} → ${fmtDate(days[days.length - 1])}` : "-"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-border font-semibold">
                <td className="py-2.5 pr-3">Team total</td>
                <td className="py-2.5 px-3 text-right tabular-nums">{stats.totalSubs}</td>
                <td className="py-2.5 px-3 text-right tabular-nums text-amber-400">{pct(teamCompletion)}</td>
                <td className="py-2.5 px-3 text-right tabular-nums">{stats.totalDone}</td>
                <td className="py-2.5 px-3 text-right tabular-nums">{stats.totalBlockers}</td>
                <td className="py-2.5 px-3 text-right tabular-nums">{stats.totalPlans}</td>
                <td className="py-2.5 px-3 text-right tabular-nums">{avg(stats.totalDone)}</td>
                <td className="py-2.5 pl-3 text-xs font-normal text-faint">
                  {fmtDate(activeDates[0])} → {fmtDate(activeDates[activeDates.length - 1])}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {/* ---------------- Daily submissions + coverage ---------------- */}
      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <section className="card p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="font-semibold">Submissions Per Day</h2>
            <span className="text-xs text-faint">
              Peak {maxDay} · {activeDates.length} of {dates.length} dates active
            </span>
          </div>
          <div className="flex h-44 items-end gap-1 overflow-x-auto pt-4">
            {dates.map((d) => {
              const v = byDate[d];
              return (
                <div
                  key={d}
                  className="flex h-full min-w-[1.4rem] flex-1 flex-col items-center justify-end gap-1.5"
                  title={`${fmtDate(d)}: ${v} submission${v === 1 ? "" : "s"}`}
                >
                  <span className="text-[10px] tabular-nums text-muted">{v || ""}</span>
                  <div
                    className={cn("w-full rounded-t", v ? "bg-accent" : "bg-surface-2")}
                    style={{ height: `${Math.max((v / maxDay) * 100, 2)}%` }}
                  />
                  <span className={cn("text-[9px] [writing-mode:vertical-rl] rotate-180", isWeekend(d) ? "text-faint/40" : "text-faint")}>
                    {fmtDate(d)}
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="card p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="font-semibold">Coverage</h2>
            <span className="text-xs text-faint">Every cell in the sheet</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] border-separate border-spacing-[2px]">
              <thead>
                <tr>
                  <th />
                  {dates.map((d) => (
                    <th key={d} className="pb-1 text-[8px] font-normal text-faint">
                      {d.slice(8)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p}>
                    <th className="pr-2 text-right text-[11px] font-normal text-muted whitespace-nowrap">{p.split(" ")[0]}</th>
                    {dates.map((d) => {
                      const st = matrix[`${p}|${d}`];
                      return (
                        <td key={d}>
                          <span
                            className={cn("block h-4 rounded-sm", CELL_STYLES[st])}
                            title={`${p} · ${fmtDate(d)} · ${CELL_LABELS[st]}`}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-[11px] text-faint">
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-sm bg-accent" />
              Submitted ({counts.submitted})
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-sm border border-amber-500/40 bg-amber-500/20" />
              Blank template ({counts.template})
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-sm border border-border bg-surface-2" />
              Empty ({counts.empty})
            </span>
          </div>
        </section>
      </div>

      {/* ---------------- Blockers ---------------- */}
      <section className="card mt-5 p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-semibold">Blockers Raised</h2>
          <span className="text-xs text-faint">Verbatim · “None” answers excluded</span>
        </div>
        <div className="space-y-2">
          {(allBlockers ? blockerFeed : blockerFeed.slice(0, BLOCKER_PREVIEW)).map((b) => (
            <BlockerCard key={b.key} text={b.text} person={b.person} date={b.date} />
          ))}
          {blockerFeed.length === 0 && <p className="py-4 text-center text-xs text-faint">No blockers recorded</p>}
        </div>

        {/* Counted, not just "See more". A blocker feed is a queue of things
            somebody is stuck on, and how many are hidden is the part worth
            knowing before deciding whether to open it. */}
        {blockerFeed.length > BLOCKER_PREVIEW && (
          <button
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-border py-2 text-xs text-accent-soft transition-colors hover:bg-surface-2"
            onClick={() => setAllBlockers((v) => !v)}
            aria-expanded={allBlockers}
          >
            {allBlockers ? (
              <>
                <ChevronDown size={13} /> Show fewer
              </>
            ) : (
              <>
                <ChevronRight size={13} /> See all {blockerFeed.length} blockers
              </>
            )}
          </button>
        )}
      </section>

      {/* ---------------- Report browser ---------------- */}
      <section data-tour="eod-reports" className="card mt-5 p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="font-semibold">Every Report</h2>
          <span className="text-xs text-faint">
            <strong className="text-zinc-100">{visible.length}</strong> shown
          </span>
        </div>

        <div className="space-y-3 border-b border-border pb-4">
          <div className="flex flex-wrap gap-1.5">
            <FilterChip active={person === "all"} onClick={() => setPerson("all")}>
              All members
            </FilterChip>
            {people.map((p) => (
              <FilterChip key={p} active={person === p} onClick={() => setPerson(p)}>
                {p.split(" ")[0]} <span className="opacity-60">{byPerson[p].subs}</span>
              </FilterChip>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <FilterChip active={date === "all"} onClick={() => setDate("all")}>
              All dates
            </FilterChip>
            {activeDates.map((d) => (
              <FilterChip key={d} active={date === d} onClick={() => setDate(d)}>
                {fmtDate(d)}
              </FilterChip>
            ))}
            <span className="mx-1 h-4 w-px bg-border" />
            <FilterChip active={blockersOnly} onClick={() => setBlockersOnly(!blockersOnly)}>
              With blockers
            </FilterChip>
            <button
              className="ml-auto text-xs text-accent-soft hover:underline"
              onClick={() => {
                setPerson("all");
                setDate("all");
                setBlockersOnly(false);
              }}
            >
              Reset
            </button>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {visible.map((e) => (
            <ReportCard
              key={e.id}
              entry={e}
              open={expanded === e.id}
              onToggle={() => setExpanded(expanded === e.id ? null : e.id)}
              onDelete={() => remove.mutateAsync(e.id)}
            />
          ))}
          {visible.length === 0 && <p className="py-8 text-center text-xs text-faint">No reports match these filters</p>}
        </div>
      </section>

      {/* ---------------- Kanban metrics (live, replaces the sheet's tab) ---------------- */}
      <section className="card mt-5 p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="font-semibold">Task Metrics</h2>
          <Link to="/tasks" className="text-xs text-accent-soft hover:underline">
            Open Task Manager →
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { label: "Total Tasks", value: kanban.total, foot: "on the board" },
            { label: "Open Tasks", value: kanban.open, foot: "not yet done" },
            { label: "Blocked", value: kanban.blocked, foot: "flagged blocked" },
            { label: "Completion Rate", value: pct(kanban.rate), foot: "done ÷ total" },
          ].map((k) => (
            <div key={k.label} className="rounded-lg bg-surface-2 p-4">
              <span className="eyebrow">{k.label}</span>
              <p className={cn("display mt-1.5 text-3xl", k.label === "Blocked" && kanban.blocked > 0 && "text-red-400")}>{k.value}</p>
              <p className="mt-1 text-[11px] text-faint">{k.foot}</p>
            </div>
          ))}
        </div>

        {kanban.total === 0 && (
          <div className="py-8 text-center">
            <p className="text-sm text-muted">No tasks on the board yet</p>
            <p className="mx-auto mt-1 max-w-md text-xs text-faint">
              These metrics come live from the Task Manager, which replaces the sheet's old Task Tracker tab. Add a task and it counts here,
              and lands in your EOD draft by itself.
            </p>
          </div>
        )}
      </section>

      <p className="mt-5 text-xs leading-relaxed text-faint">
        Figures for July reproduce the old sheet's own <code className="rounded bg-surface-2 px-1 py-0.5">COUNTIFS</code> and{" "}
        <code className="rounded bg-surface-2 px-1 py-0.5">=B4/31</code> formulas and match it cell-for-cell; a cell counted only when it was
        filled in and not the untouched blank template ({counts.template} cells still hold it). Those {IMPORTED_COUNT} reports are imported
        history. Everything from {fmtDate(dates[dates.length - 1])} on is submitted here, drafted from the Task Manager. Completion keeps the
        sheet's 31-day denominator so the numbers still line up with what the team knows.
      </p>
    </div>
  );
}

/**
 * Today's report, drafted from the Kanban. Each line is editable and removable,
 * the board gets you 90% there, you fix the rest and submit.
 */
function TodayEod({
  me,
  draft,
  onChange,
  notes,
  onNotes,
  existing,
  saving,
  reportDate,
  today,
  onDateChange,
  onSubmit,
  onPushPlan,
}: {
  me?: string;
  draft: EodDraftState;
  onChange: (d: EodDraftState) => void;
  notes: string;
  onNotes: (s: string) => void;
  existing?: EodReport;
  saving: boolean;
  reportDate: string;
  today: string;
  onDateChange: (d: string) => void;
  onSubmit: () => void;
  onPushPlan: (title: string) => void;
}) {
  const [open, setOpen] = useState(!existing);
  const total = draft.done.length + draft.blockers.length + draft.plans.length;
  const isToday = reportDate === today;

  /** Yesterday, as YYYY-MM-DD in local time (not UTC, which can shift the day). */
  const yesterday = (() => {
    const [y, m, d] = today.split("-").map(Number);
    const dt = new Date(y, m - 1, d - 1);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
  })();

  if (!me) {
    return (
      <div className="card mt-5 p-4 text-xs text-faint">
        Sign in to draft and submit your end-of-day report.
      </div>
    );
  }

  return (
    <section data-tour="eod-today" className="card mt-5 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-5 py-3 text-left hover:bg-surface-2/40"
      >
        <Sparkles size={15} className="shrink-0 text-accent" />
        <span className="text-sm font-medium">
          {existing
            ? isToday ? "Your EOD for today" : `Your EOD for ${fmtDate(reportDate)}`
            : isToday ? "Draft today's EOD" : `Draft EOD for ${fmtDate(reportDate)}`}
        </span>
        <span className="pill bg-surface-2 text-faint">
          {total} {total === 1 ? "item" : "items"} from your board
        </span>
        {existing && <Badge tone="done">Submitted</Badge>}
        {!isToday && !existing && <Badge tone="high">Catching up</Badge>}
        <span className="ml-auto text-faint">{open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</span>
      </button>

      {open && (
        <div className="space-y-4 border-t border-border px-5 py-4">
          {/* Which day this report is for. Lets someone who fell behind file for a
              missed day instead of being locked to today. */}
          <div className="flex flex-wrap items-end gap-3 rounded-lg bg-surface-2 p-3">
            <div>
              <label className="field-label" htmlFor="eod-date">Report for</label>
              <input
                id="eod-date"
                type="date"
                className="input py-1.5"
                value={reportDate}
                max={today}
                onChange={(e) => e.target.value && onDateChange(e.target.value)}
              />
            </div>
            <div className="flex gap-1.5 pb-0.5">
              <button
                type="button"
                onClick={() => onDateChange(today)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                  isToday ? "border-accent bg-accent/15 text-accent-soft" : "border-border text-muted hover:text-zinc-100",
                )}
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => onDateChange(yesterday)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                  reportDate === yesterday
                    ? "border-accent bg-accent/15 text-accent-soft"
                    : "border-border text-muted hover:text-zinc-100",
                )}
              >
                Yesterday
              </button>
            </div>
            <p className="ml-auto max-w-xs text-[11px] text-faint">
              {existing
                ? "You already filed this day. Submitting again updates it."
                : isToday
                  ? "Filing for today."
                  : "Catching up on a missed day. Future dates aren't allowed."}
            </p>
          </div>

          <p className="text-xs text-faint">
            Pulled from your tasks: {isToday ? "completed today" : `completed on ${fmtDate(reportDate)}`}, blocked, and
            still open. Edit anything, then submit.
          </p>

          <DraftList
            title={isToday ? "Completed today" : `Completed on ${fmtDate(reportDate)}`}
            items={draft.done}
            dot="bg-emerald-400"
            empty={isToday ? "Nothing marked done today. Move cards to Done on the board, or add a line." : "Nothing marked done on this date. Add what you did."}
            onChange={(done) => onChange({ ...draft, done })}
          />
          <DraftList
            title="Blockers"
            items={draft.blockers}
            dot="bg-red-400"
            empty="No blocked tasks. Flag a task as blocked, or add a blocker here."
            onChange={(blockers) => onChange({ ...draft, blockers })}
          />
          <DraftList
            title="Plan for next day"
            items={draft.plans}
            dot="bg-amber-400"
            empty="No open tasks assigned to you."
            onChange={(plans) => onChange({ ...draft, plans })}
            onPush={onPushPlan}
            pushLabel="Add to board"
          />

          <div data-tour="eod-notes">
            <label className="field-label" htmlFor="eod-notes">
              Notes (things that aren't tasks)
            </label>
            <textarea
              id="eod-notes"
              className="input min-h-[70px]"
              placeholder="Attended the Monday meeting, OLJ subscription still down…"
              value={notes}
              onChange={(e) => onNotes(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-3">
            <button className="btn-primary" onClick={onSubmit} disabled={saving || total === 0}>
              <Send size={14} />
              {saving ? "Submitting…" : existing ? "Update this report" : "Submit EOD"}
            </button>
            {existing && <span className="text-xs text-faint">Submitting again corrects this report.</span>}
            {total === 0 && !existing && <span className="text-xs text-faint">Add at least one item to submit.</span>}
          </div>
        </div>
      )}
    </section>
  );
}

/** An editable list of draft lines. */
function DraftList({
  title,
  items,
  dot,
  empty,
  onChange,
  onPush,
  pushLabel,
}: {
  title: string;
  items: string[];
  dot: string;
  empty: string;
  onChange: (next: string[]) => void;
  /** R-4.3.4: turn this line into a real task. Only the plan list passes it. */
  onPush?: (title: string) => void;
  pushLabel?: string;
}) {
  const [add, setAdd] = useState("");
  /* Which lines have been pushed, by index. Local and deliberately not
     persisted: it exists so you can see the click landed and not create the
     same task three times in one sitting. The board is the real record. */
  const [pushed, setPushed] = useState<Set<number>>(new Set());

  return (
    <div>
      <p className="eyebrow mb-1.5">{title}</p>
      <ul className="space-y-1">
        {items.map((t, i) => (
          <li key={i} className="group flex items-start gap-2 rounded-md px-1 py-0.5 hover:bg-surface-2/60">
            <span className={cn("mt-2 h-1.5 w-1.5 shrink-0 rounded-sm", dot)} />
            <span className="min-w-0 flex-1 text-sm text-zinc-200">{t}</span>
            {onPush && (
              <button
                className={cn(
                  "shrink-0 text-[11px] transition-opacity",
                  pushed.has(i)
                    ? "text-emerald-400 opacity-100"
                    : "reveal-on-hover text-faint hover:text-accent",
                )}
                onClick={() => { onPush(t); setPushed((s) => new Set(s).add(i)); }}
                disabled={pushed.has(i)}
                title={pushed.has(i) ? "Already on the board" : `${pushLabel} for the next day`}
              >
                {pushed.has(i) ? "On the board" : pushLabel}
              </button>
            )}
            <button
              className="reveal-on-hover shrink-0 text-[11px] text-faint hover:text-red-400"
              onClick={() => onChange(items.filter((_, j) => j !== i))}
              aria-label={`Remove "${t}"`}
            >
              Remove
            </button>
          </li>
        ))}
        {items.length === 0 && <li className="px-1 text-xs text-faint">{empty}</li>}
      </ul>
      <form
        className="mt-1.5 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!add.trim()) return;
          onChange([...items, add.trim()]);
          setAdd("");
        }}
      >
        <input
          className="input py-1 text-xs"
          placeholder={`Add to ${title.toLowerCase()}…`}
          value={add}
          onChange={(e) => setAdd(e.target.value)}
        />
        <button type="submit" className="btn-ghost shrink-0 px-3 py-1 text-xs" disabled={!add.trim()}>
          Add
        </button>
      </form>
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
        active ? "border-accent bg-accent/15 text-accent-soft" : "border-border text-muted hover:bg-surface-2 hover:text-zinc-100",
      )}
    >
      {children}
    </button>
  );
}

/**
 * One blocker, small until it needs to be large.
 *
 * TWO LEVELS OF COLLAPSE, AND WHY BOTH EARN THEIR PLACE. The feed hides
 * everything past the fourth card, which fixes the length of the SECTION. This
 * fixes the length of a CARD: several blockers are a paragraph each, so four
 * cards could still be a screen and a half, and the fix for that is not fewer
 * cards but shorter ones.
 *
 * Clamped to three lines, expanded by pressing it. Whole-card rather than a
 * "more" link, because the card is already the click target people reach for
 * and a 40px link inside a paragraph is not.
 */
function BlockerCard({ text, person, date }: { text: string; person: string; date: string }) {
  const [open, setOpen] = useState(false);
  /* Only interactive when there is something hidden. A short blocker that
     already fits must not grow a pointer cursor and an expand affordance that
     do nothing when pressed. */
  const long = text.length > CLAMP_CHARS;

  const body = (
    <>
      <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-400" />
      <div className="min-w-0 flex-1">
        <p className={cn("text-sm", long && !open && "line-clamp-3")}>{text}</p>
        <p className="mt-0.5 text-xs text-faint">
          {person} · {fmtDate(date)}
          {long && <span className="ml-1.5 text-accent-soft">{open ? "Show less" : "Show more"}</span>}
        </p>
      </div>
    </>
  );

  if (!long) return <div className="flex gap-3 rounded-lg bg-surface-2 p-3">{body}</div>;

  return (
    <button
      type="button"
      onClick={() => setOpen((v) => !v)}
      aria-expanded={open}
      className="flex w-full gap-3 rounded-lg bg-surface-2 p-3 text-left transition-colors hover:bg-surface-2/70"
    >
      {body}
    </button>
  );
}

/** How much of a report is worth showing before it earns a click. Two items is
 *  enough to recognise which report this is, which is all the collapsed state
 *  has to do. */
const PREVIEW_ITEMS = 2;
/** Roughly three lines of prose. Only used to decide whether the See more
 *  button appears at all; the visual cut is done with line-clamp. */
const CLAMP_CHARS = 220;
/** Blockers shown before the feed asks. */
const BLOCKER_PREVIEW = 4;

function ReportCard({
  entry,
  open,
  onToggle,
  onDelete,
}: {
  entry: EodReport;
  open: boolean;
  onToggle: () => void;
  onDelete: () => Promise<unknown>;
}) {
  const links = entry.links ?? [];
  const [confirm, setConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  /* Collapsed by default, and this is the change that makes the page readable.
     An imported report is one enormous run-on paragraph per section, so three
     of them filled a screen and a half EACH: scanning ten reports meant
     scrolling past fifteen screens of prose to find the one you wanted. The
     card now shows enough to recognise a report and hides the rest behind a
     count. */
  const [full, setFull] = useState(false);

  /* Whether there is anything to reveal, worked out from the content rather
     than assumed. A short report that already fits shows no button, because a
     "See more" that expands into nothing is worse than no button at all. */
  const all = [...entry.done, ...entry.blockers, ...entry.plans];
  const hiddenItems =
    Math.max(0, entry.done.length - PREVIEW_ITEMS) +
    Math.max(0, entry.blockers.length - PREVIEW_ITEMS) +
    Math.max(0, entry.plans.length - PREVIEW_ITEMS);
  const hasLongText = all.some((t) => t.length > CLAMP_CHARS) || (entry.notes?.length ?? 0) > CLAMP_CHARS;
  const truncatable = hiddenItems > 0 || hasLongText;

  /**
   * The button is always shown; the database decides. RLS ("eod write") allows
   * your own reports, and any report if you're an admin. Hiding the control in
   * the UI was never the protection, and when the role lookup lagged it hid
   * the button from someone who genuinely could delete.
   */
  async function doDelete() {
    setDeleting(true);
    setError("");
    try {
      await onDelete();
    } catch (err) {
      const m = err instanceof Error ? err.message.toLowerCase() : "";
      setError(
        m.includes("row-level") || m.includes("policy") || m.includes("permission")
          ? "You can only delete your own reports."
          : "Couldn't delete that. Please try again.",
      );
      setConfirm(false);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <article className="group rounded-lg border border-border bg-surface-2/50">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <span className="pill bg-accent/15 text-accent-soft">{fmtDate(entry.report_date)}</span>
        <h3 className="flex-1 text-sm font-medium">{entry.person}</h3>
        <Badge tone="done">{entry.done.length} done</Badge>
        {entry.blockers.length > 0 && <Badge tone="urgent">{entry.blockers.length} blocked</Badge>}
        {entry.plans.length > 0 && <Badge tone="reply">{entry.plans.length} planned</Badge>}

        {/* Deleting is permanent, so it asks first. Always visible. Hover-only
            controls are undiscoverable and don't exist on touch at all. */}
        {confirm ? (
          <span className="flex items-center gap-1.5">
            <span className="text-xs text-muted">Delete this report?</span>
            <button
              className="rounded-md bg-red-500/15 px-2 py-1 text-xs font-medium text-red-400 hover:bg-red-500/25"
              onClick={doDelete}
              disabled={deleting}
            >
              {deleting ? "Deleting…" : "Yes, delete"}
            </button>
            <button className="px-1.5 py-1 text-xs text-faint hover:text-zinc-100" onClick={() => setConfirm(false)}>
              Cancel
            </button>
          </span>
        ) : (
          <button
            className="rounded-md border border-border p-1.5 text-faint transition-colors hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-400"
            onClick={() => setConfirm(true)}
            title="Delete this report"
            aria-label={`Delete ${entry.person}'s report for ${fmtDate(entry.report_date)}`}
          >
            <Trash2 size={14} />
          </button>
        )}
        {error && <span className="w-full text-xs text-red-400">{error}</span>}
      </div>

      <div className="space-y-4 px-4 py-3">
        <Section title="Completed" items={entry.done} dot="bg-emerald-400" collapsed={!full} />
        <Section title="Blockers" items={entry.blockers} dot="bg-red-400" collapsed={!full} />
        <Section title="Plan for next day" items={entry.plans} dot="bg-amber-400" collapsed={!full} />
        {entry.notes?.trim() && (
          <div>
            <p className="eyebrow mb-1.5">Notes</p>
            <p className={cn("whitespace-pre-wrap text-sm text-zinc-200", !full && "line-clamp-3")}>{entry.notes}</p>
          </div>
        )}

        {truncatable && (
          <button
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border py-1.5 text-xs text-accent-soft transition-colors hover:bg-surface-2"
            onClick={() => setFull((v) => !v)}
            aria-expanded={full}
            aria-label={full ? `Collapse ${entry.person}'s report` : `Expand ${entry.person}'s report`}
          >
            {full ? (
              <>
                <ChevronDown size={13} /> Show less
              </>
            ) : (
              <>
                <ChevronRight size={13} />
                {/* Says what is behind it. "See more" alone does not tell you
                    whether that is one hidden line or forty. */}
                See more{hiddenItems > 0 ? ` · ${hiddenItems} more item${hiddenItems === 1 ? "" : "s"}` : ""}
              </>
            )}
          </button>
        )}

        {links.length > 0 && (
          <div className="flex flex-wrap gap-1.5 border-t border-border pt-3">
            {links.map((l) => (
              <a
                key={l}
                href={l}
                target="_blank"
                rel="noopener noreferrer"
                className="flex max-w-full items-center gap-1 truncate rounded-md border border-border bg-surface px-2 py-1 text-[11px] text-accent-soft hover:border-accent/60"
              >
                <Link2 size={11} className="shrink-0" />
                {l.replace(/^https?:\/\//, "").slice(0, 52)}
              </a>
            ))}
          </div>
        )}

        {/* Only imported sheet reports carry original text; ones submitted here
            are already structured, so there is nothing rawer to show. */}
        {entry.raw?.trim() && (
        <div className="border-t border-border pt-2">
          <button onClick={onToggle} className="flex items-center gap-1 text-[11px] text-faint hover:text-zinc-100">
            {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            Original text from the sheet
          </button>
          {open && (
            <pre className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-bg p-3 text-[11px] leading-relaxed text-muted">
              {entry.raw}
            </pre>
          )}
        </div>
        )}
      </div>
    </article>
  );
}

function Section({
  title, items, dot, collapsed = false,
}: {
  title: string;
  items: string[];
  dot: string;
  /** Preview mode: a couple of items, each cut to three lines. */
  collapsed?: boolean;
}) {
  if (items.length === 0) return null;
  const shown = collapsed ? items.slice(0, PREVIEW_ITEMS) : items;
  const rest = items.length - shown.length;

  return (
    <div>
      <p className="eyebrow mb-1.5">{title}</p>
      <ul className="space-y-1">
        {shown.map((t, i) => (
          <li key={i} className="flex gap-2 text-sm text-zinc-200">
            <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-sm", dot)} />
            {/* Clamped by lines rather than cut by characters: a hard character
                cut lands mid-word and reads as corrupted text, and the imported
                reports are one long paragraph where that happens every time. */}
            <span className={cn("min-w-0", collapsed && "line-clamp-3")}>{t}</span>
          </li>
        ))}
      </ul>
      {rest > 0 && (
        <p className="mt-1 pl-4 text-[11px] text-faint">
          +{rest} more {rest === 1 ? "item" : "items"}
        </p>
      )}
    </div>
  );
}
