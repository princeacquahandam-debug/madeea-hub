import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Link2, Send, Trash2 } from "lucide-react";
import { Badge, PageHeader } from "@/components/ui";
import { EOD_DATA, type CellStatus } from "@/data/eod";
import { EOD_DATES } from "@/data/eodImport";
import { atLeast, useDeleteEod, useEodReports, useMyRole, useSubmitEod, useTaskMutations, useTasks, useWorkspaceMembers } from "@/data/hooks";
import { draftFromTasks, todayIso, type EodDraft as EodDraftState } from "@/lib/eodDraft";
import { DraftList } from "@/components/EodDraftList";
import type { EodReport } from "@/types/db";
import { cn } from "@/lib/utils";

/*
 * EOD reports, in two tabs (12 Oct 2026, UI review deck slides 7-8).
 *
 * The page used to be one long scroll: your draft, six stats, a bar chart that
 * repeated the table below it, an often-empty submissions chart, every report,
 * and task metrics that repeated the Tasks board. "My report" is now the page
 * for everyone; "Team" holds the analytics, for managers and admins.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

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

/** "2026-10-09" → "Friday, Oct 9". Spelled out, never 09/10/2026 (deck slide 7). */
function fmtLong(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${DAYS_LONG[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ${MONTHS[m - 1]} ${d}`;
}

/** Day-of-week without local-timezone drift. */
function isWeekend(iso: string): boolean {
  const [y, m, d] = iso.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow === 0 || dow === 6;
}

/** Whole percentages: 8.06% reads as 8% (deck slide 8). */
function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

/** Every day of a "YYYY-MM" month, stopping at today for the current one. */
function daysOf(month: string, today: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const out: string[] = [];
  for (let d = 1; d <= n; d++) {
    const iso = `${month}-${String(d).padStart(2, "0")}`;
    if (iso > today) break;
    out.push(iso);
  }
  return out;
}

const daysInMonth = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

type Cell = CellStatus | "weekend";
const CELL_STYLES: Record<Cell, string> = {
  submitted: "bg-accent",
  template: "bg-surface-2",
  empty: "bg-surface-2",
  weekend: "border border-border",
};
const CELL_LABELS: Record<Cell, string> = {
  submitted: "submitted a report",
  template: "missed",
  empty: "missed",
  weekend: "weekend",
};

const segBtn = (on: boolean) =>
  cn("min-h-[28px] rounded-md px-3 text-[13px] font-medium transition-colors", on ? "bg-surface text-text shadow-sm" : "text-muted hover:text-text");

export default function EodReports() {
  const { data: reports = [], isLoading: eodLoading, isError: eodError, error: eodErr, refetch: refetchEod } = useEodReports();
  const { data: tasks = [] } = useTasks();
  const { data: members = [] } = useWorkspaceMembers();
  const submit = useSubmitEod();
  const remove = useDeleteEod();
  const { create: createTask } = useTaskMutations();
  const { data: role } = useMyRole();
  // The team view is for whoever watches the team: managers and admins.
  const canTeam = atLeast(role, "manager");
  const [tab, setTab] = useState<"mine" | "team">("mine");

  // ---- the report you're filing: drafted from the board, edited and submitted ----
  const today = todayIso();
  const me = members.find((m) => m.is_me);

  /**
   * Which day this report covers. Defaults to today, but is changeable so
   * someone catching up can file for a day they missed.
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

  /**
   * Typing a note is editing the report, so it marks the draft touched too.
   * Otherwise a tasks refetch (a tab switch is enough) re-runs the re-sync
   * above and clears the note mid-sentence.
   */
  const editNotes = (next: string) => {
    setTouched(true);
    setNotes(next);
  };

  /** Switching day discards an unsaved draft and loads that day's instead. */
  const changeReportDate = (next: string) => {
    setReportDate(next);
    setTouched(false);
    setNotes("");
  };

  /**
   * R-4.3.4: a next step in the EOD lands on the board for the day after the
   * report (not tomorrow-from-now), assigned to you.
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

  // Your own reports, newest first.
  const mine = useMemo(
    () => reports.filter((r) => r.person === me?.name).sort((a, b) => b.report_date.localeCompare(a.report_date)),
    [reports, me],
  );
  const mineThisMonth = mine.filter((r) => r.report_date.startsWith(today.slice(0, 7))).length;
  const [showAllMine, setShowAllMine] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div>
      {/* A failed read used to render as a team that reported nothing: every
          figure reads 0, which is a real and alarming number. */}
      {eodError && (
        <div className="card mb-3 flex flex-wrap items-center gap-2 border-amber-500/40 bg-amber-500/5 p-2.5 text-[12.5px] text-amber-200">
          <AlertTriangle size={14} className="shrink-0" />
          <span className="min-w-0 flex-1">
            Couldn't load reports, so the figures below are not your team's. Try again in a moment.{" "}
            {(eodErr as Error)?.message}
          </span>
          <button className="btn-ghost border border-amber-500/40 px-2 py-1 text-[11.5px]" onClick={() => void refetchEod()}>
            Try again
          </button>
        </div>
      )}
      {eodLoading && <p className="mb-3 text-sm text-faint">Loading reports…</p>}

      <PageHeader title="EOD reports" />

      {canTeam && (
        <div className="-mt-2 mb-4 flex gap-5 border-b border-border" role="tablist" aria-label="EOD views">
          {([["mine", "My report"], ["team", "Team"]] as const).map(([k, l]) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={cn(
                "-mb-px border-b-2 pb-2 text-sm font-medium transition-colors",
                tab === k ? "border-accent text-text" : "border-transparent text-muted hover:text-text",
              )}
            >
              {l}
            </button>
          ))}
        </div>
      )}

      {tab === "team" && canTeam ? (
        <TeamTab reports={reports} members={members.map((m) => m.name)} today={today} onDelete={(id) => remove.mutateAsync(id)} />
      ) : (
        <>
          <TodayEod
            me={me?.name}
            draft={draft}
            onChange={editDraft}
            notes={notes}
            onNotes={editNotes}
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

          <section className="card mt-4 overflow-hidden">
            <div className="flex items-center gap-2 border-b border-border px-5 py-3">
              <h2 className="text-[15px] font-semibold">Your past reports</h2>
              <span className="ml-auto text-xs text-faint">{mineThisMonth} this month</span>
            </div>
            {mine.length === 0 ? (
              <p className="py-8 text-center text-sm text-faint">Reports you submit will appear here.</p>
            ) : (
              <div className="space-y-3 p-4">
                {(showAllMine ? mine : mine.slice(0, 5)).map((e) => (
                  <ReportCard
                    key={e.id}
                    entry={e}
                    open={expanded === e.id}
                    onToggle={() => setExpanded(expanded === e.id ? null : e.id)}
                    onDelete={() => remove.mutateAsync(e.id)}
                  />
                ))}
                {mine.length > 5 && (
                  <button className="w-full text-center text-xs font-medium text-accent-soft hover:underline" onClick={() => setShowAllMine(!showAllMine)}>
                    {showAllMine ? "Show fewer" : `Show all ${mine.length}`}
                  </button>
                )}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- Team tab */

function TeamTab({
  reports, members, today, onDelete,
}: {
  reports: EodReport[];
  members: string[];
  today: string;
  onDelete: (id: string) => Promise<unknown>;
}) {
  /**
   * Everyone this page measures. Membership is the source of who works here;
   * reports add names only so a report whose author has left still counts.
   * Matched case-insensitively so "FJ Caballes" and "fj caballes" can't be two
   * people.
   */
  const people = useMemo(() => {
    const seen = new Map<string, string>();
    const add = (raw: string | null | undefined) => {
      const name = (raw ?? "").trim();
      const key = name.toLowerCase();
      if (key && !seen.has(key)) seen.set(key, name);
    };
    for (const m of members) add(m);
    for (const r of reports) add(r.person);
    return [...seen.values()];
  }, [members, reports]);

  // Months with anything in them, newest first; this month is always offered.
  const months = useMemo(() => {
    const set = new Set<string>([today.slice(0, 7)]);
    for (const d of EOD_DATES) set.add(d.slice(0, 7));
    for (const r of reports) set.add(r.report_date.slice(0, 7));
    return [...set].sort().reverse();
  }, [reports, today]);
  // Opens on the newest month that has a report, so the tab isn't all zeros
  // on the 1st.
  const [month, setMonth] = useState(() => {
    const latest = [...reports].map((r) => r.report_date).sort().pop();
    return (latest ?? today).slice(0, 7);
  });
  const [ea, setEa] = useState("all");

  const inMonth = useMemo(() => reports.filter((r) => r.report_date.startsWith(month)), [reports, month]);
  const scopePeople = ea === "all" ? people : people.filter((p) => p === ea);
  const scoped = ea === "all" ? inMonth : inMonth.filter((r) => r.person === ea);
  const expected = scopePeople.length * daysInMonth(month);

  const byPerson = useMemo(() => {
    const out: Record<string, { subs: number; done: number; blockers: number; plans: number; last: string | null }> = {};
    for (const p of people) out[p] = { subs: 0, done: 0, blockers: 0, plans: 0, last: null };
    for (const e of inMonth) {
      const s = out[e.person ?? ""];
      if (!s) continue;
      s.subs += 1;
      s.done += e.done.length;
      s.blockers += e.blockers.length;
      s.plans += e.plans.length;
      if (!s.last || e.report_date > s.last) s.last = e.report_date;
    }
    return out;
  }, [people, inMonth]);

  const totalDone = scoped.reduce((a, e) => a + e.done.length, 0);
  const totalBlockers = scoped.reduce((a, e) => a + e.blockers.length, 0);
  const reporters = scopePeople.filter((p) => byPerson[p]?.subs > 0);
  const silent = scopePeople.filter((p) => !byPerson[p]?.subs);
  const ranked = [...reporters].sort((a, b) => byPerson[b].subs - byPerson[a].subs);

  const kpis = [
    { label: "Reports submitted", value: String(scoped.length), foot: `from ${reporters.length} of ${scopePeople.length} EAs` },
    {
      label: "Submission rate",
      value: pct(expected ? scoped.length / expected : 0),
      foot: `${scoped.length} of ${expected} expected`,
      // Was a banner above the table; now the tooltip on the number it explains.
      tip: "Counts the days each EA submitted an EOD report this month, out of every day in the month.",
    },
    { label: "Tasks completed", value: String(totalDone), foot: `${scoped.length ? (totalDone / scoped.length).toFixed(1) : "0"} per report` },
    { label: "Blockers raised", value: String(totalBlockers), foot: `in ${scoped.filter((e) => e.blockers.length).length} reports`, alert: totalBlockers > 0 },
  ];

  // Coverage: each day of the month so far.
  const days = useMemo(() => daysOf(month, today), [month, today]);
  const submitted = useMemo(() => new Set(inMonth.map((r) => `${r.person}|${r.report_date}`)), [inMonth]);
  const cell = (p: string, d: string): Cell =>
    submitted.has(`${p}|${d}`) ? "submitted" : isWeekend(d) ? "weekend" : EOD_DATA.matrix[`${p}|${d}`] ?? "empty";

  // ---- Reports: three dropdowns instead of two rows of chips ----
  const [person, setPerson] = useState("all");
  useEffect(() => setPerson(ea), [ea]);
  const [date, setDate] = useState("all");
  const [blockersOnly, setBlockersOnly] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const reportedPeople = people.filter((p) => byPerson[p]?.subs > 0);
  const personDates = useMemo(
    () => [...new Set(inMonth.filter((e) => person === "all" || e.person === person).map((e) => e.report_date))].sort().reverse(),
    [inMonth, person],
  );
  // Newest day by default; falls back when the choice stops making sense.
  useEffect(() => {
    if (personDates.length && date !== "all" && !personDates.includes(date)) setDate(personDates[0]);
  }, [personDates, date]);
  useEffect(() => setDate(personDates[0] ?? "all"), [month]); // eslint-disable-line react-hooks/exhaustive-deps

  const visible = useMemo(
    () =>
      [...inMonth]
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
    [inMonth, people, person, date, blockersOnly],
  );

  const monthLabel = (m: string) => `${MONTHS_LONG[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <select className="input w-auto" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month">
          {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
        <select className="input w-auto" value={ea} onChange={(e) => setEa(e.target.value)} aria-label="EA">
          <option value="all">All EAs</option>
          {people.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      {/* Four stats in one strip. */}
      <div className="card grid grid-cols-2 overflow-hidden lg:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="-mb-px -mr-px border-b border-r border-border px-4 py-3.5" title={k.tip}>
            <span className="block text-xs text-muted">
              {k.label}
              {k.tip && <span className="ml-1 cursor-help text-faint" aria-label={k.tip}>ⓘ</span>}
            </span>
            <span className={cn("mt-1 block text-[22px] font-semibold leading-tight tabular-nums", k.alert && "text-red-500")}>{k.value}</span>
            <span className="block text-[11px] text-faint">{k.foot}</span>
          </div>
        ))}
      </div>

      {/* By EA: the rate bar lives in the table. */}
      <section className="card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-border px-5 py-3">
          <h2 className="text-[15px] font-semibold">By EA</h2>
          <span className="ml-auto text-xs text-faint">Sorted by submission rate</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <th className="px-5 py-2 font-medium">EA</th>
                <th className="px-3 py-2 text-right font-medium">Reports</th>
                <th className="px-3 py-2 font-medium">Submission rate</th>
                <th className="px-3 py-2 text-right font-medium">Tasks done</th>
                <th className="px-3 py-2 text-right font-medium">Blockers</th>
                <th className="px-3 py-2 text-right font-medium">Plans</th>
                <th className="px-5 py-2 font-medium">Last report</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((p) => {
                const s = byPerson[p];
                const rate = s.subs / daysInMonth(month);
                return (
                  <tr key={p} className="border-b border-border last:border-0">
                    <td className="px-5 py-2.5 font-medium">{p}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{s.subs}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-28 overflow-hidden rounded-full bg-surface-2">
                          <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, rate * 100)}%` }} />
                        </div>
                        <span className="w-9 text-right text-xs tabular-nums text-muted">{pct(rate)}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{s.done}</td>
                    <td className={cn("px-3 py-2.5 text-right tabular-nums", s.blockers > 0 && "text-red-500")}>{s.blockers}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{s.plans}</td>
                    <td className="px-5 py-2.5 text-xs text-muted">{fmtDate(s.last ?? undefined)}</td>
                  </tr>
                );
              })}
              {ranked.length === 0 && (
                <tr><td colSpan={7} className="px-5 py-6 text-center text-sm text-faint">No reports in {monthLabel(month)}.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {/* Everyone at zero on one line rather than a row each. */}
        {silent.length > 0 && (
          <p className="border-t border-border px-5 py-2.5 text-xs text-faint">
            {silent.length} {silent.length === 1 ? "EA" : "EAs"} with no reports this month: {silent.join(", ")}
          </p>
        )}
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="card min-w-0 p-5">
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-[15px] font-semibold">Coverage</h2>
            <span className="ml-auto text-xs text-faint">{days.length ? `${fmtDate(days[0])} – ${fmtDate(days[days.length - 1])}` : ""}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="border-separate border-spacing-[2px]">
              <tbody>
                {scopePeople.map((p) => (
                  <tr key={p}>
                    <th className="whitespace-nowrap pr-2 text-left text-[11px] font-normal text-muted">{p.split(" ")[0]}</th>
                    {days.map((d) => {
                      const st = cell(p, d);
                      return (
                        <td key={d}>
                          <span className={cn("block h-3.5 w-3.5 rounded-[3px]", CELL_STYLES[st])} title={`${p} · ${fmtDate(d)} · ${CELL_LABELS[st]}`} />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th />
                  {days.map((d, i) => (
                    <td key={d} className="text-center text-[9px] text-faint">{i % 7 === 0 ? Number(d.slice(8)) : ""}</td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-faint">
            <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-[3px] bg-accent" /> Submitted</span>
            <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-[3px] bg-surface-2" /> Missed</span>
            <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-[3px] border border-border" /> Weekend</span>
          </div>
        </section>

        <section className="card min-w-0 p-5">
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-[15px] font-semibold">Reports</h2>
            <span className="ml-auto text-xs text-faint">{visible.length} shown</span>
          </div>
          <div className="mb-3 flex flex-wrap gap-2">
            <select className="input h-8 w-auto py-0 text-xs" value={person} onChange={(e) => setPerson(e.target.value)} aria-label="Whose reports">
              <option value="all">All EAs</option>
              {reportedPeople.map((p) => <option key={p} value={p}>{p} ({byPerson[p].subs})</option>)}
            </select>
            <select className="input h-8 w-auto py-0 text-xs" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Report date">
              <option value="all">All dates</option>
              {personDates.map((d) => <option key={d} value={d}>{fmtDate(d)}</option>)}
            </select>
            <select className="input h-8 w-auto py-0 text-xs" value={blockersOnly ? "blockers" : "all"} onChange={(e) => setBlockersOnly(e.target.value === "blockers")} aria-label="Blockers">
              <option value="all">All reports</option>
              <option value="blockers">With blockers only</option>
            </select>
          </div>
          <div className="space-y-3">
            {visible.map((e) => (
              <ReportCard
                key={e.id}
                entry={e}
                open={expanded === e.id}
                onToggle={() => setExpanded(expanded === e.id ? null : e.id)}
                onDelete={() => onDelete(e.id)}
              />
            ))}
            {visible.length === 0 && <p className="py-8 text-center text-xs text-faint">No reports match these filters</p>}
          </div>
        </section>
      </div>
    </div>
  );
}

/**
 * Your report for one day, drafted from the board. Three sections side by
 * side, each with its own "Add item" (deck slide 7).
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
    return <div className="card p-4 text-xs text-faint">Sign in to draft and submit your end-of-day report.</div>;
  }

  return (
    <section data-tour="eod-today" className="card p-5">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="text-[15px] font-semibold">Report for {fmtLong(reportDate)}</h2>
        <div className="flex gap-0.5 rounded-lg bg-surface-2 p-0.5">
          <button type="button" className={segBtn(isToday)} aria-pressed={isToday} onClick={() => onDateChange(today)}>Today</button>
          <button type="button" className={segBtn(reportDate === yesterday)} aria-pressed={reportDate === yesterday} onClick={() => onDateChange(yesterday)}>Yesterday</button>
        </div>
        {/* Any earlier day, for catching up on one that was missed. */}
        <input
          type="date"
          aria-label="Report for another day"
          className="input h-8 w-auto py-0 text-xs"
          value={reportDate}
          max={today}
          onChange={(e) => e.target.value && onDateChange(e.target.value)}
        />
        {existing && <Badge tone="done">Submitted</Badge>}
        <span className="ml-auto text-xs text-faint">Pre-filled from your task board</span>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <DraftList
          boxed
          title={isToday ? "Completed today" : `Completed on ${fmtDate(reportDate)}`}
          items={draft.done}
          dot="bg-emerald-400"
          empty={isToday ? "No tasks moved to Done today." : "No tasks marked done on this date."}
          onChange={(done) => onChange({ ...draft, done })}
        />
        <DraftList
          boxed
          title="Blockers"
          items={draft.blockers}
          dot="bg-red-400"
          empty="No blocked tasks."
          onChange={(blockers) => onChange({ ...draft, blockers })}
        />
        <DraftList
          boxed
          title="Plan for tomorrow"
          items={draft.plans}
          dot="bg-amber-400"
          empty="No open tasks assigned to you."
          onChange={(plans) => onChange({ ...draft, plans })}
          onPush={onPushPlan}
          pushLabel="Add to board"
        />
      </div>

      <div data-tour="eod-notes" className="mt-4">
        <label className="field-label" htmlFor="eod-notes">Notes (optional)</label>
        <textarea
          id="eod-notes"
          className="input min-h-[70px]"
          placeholder="Anything that isn't a task, e.g. attended the Monday client meeting"
          value={notes}
          onChange={(e) => onNotes(e.target.value)}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button className="btn-primary" onClick={onSubmit} disabled={saving || total === 0}>
          <Send size={14} />
          {saving ? "Submitting…" : existing ? "Update report" : "Submit report"}
        </button>
        {existing && <span className="text-xs text-faint">Submitting again updates this report.</span>}
        {total === 0 && !existing && <span className="text-xs text-faint">Add at least one item to submit.</span>}
        {!isToday && !existing && <span className="text-xs text-faint">Catching up on a missed day.</span>}
      </div>
    </section>
  );
}

/** How much of a report is worth showing before it earns a click. Two items is
 *  enough to recognise which report this is, which is all the collapsed state
 *  has to do. */
const PREVIEW_ITEMS = 2;
/** Roughly three lines of prose. Only used to decide whether the See more
 *  button appears at all; the visual cut is done with line-clamp. */
const CLAMP_CHARS = 220;

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
    <article
      className={cn(
        "group rounded-lg border bg-surface-2/50",
        /* Edged in amber when somebody is stuck. The standalone blocker feed
           used to be how a blocker got noticed from across the page; without
           it, the card itself has to carry that, or a blocker becomes something
           you only find by opening every report in turn. */
        entry.blockers.length > 0 ? "border-amber-500/40" : "border-border",
      )}
    >
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
        <Section title="Completed today" items={entry.done} dot="bg-emerald-400" collapsed={!full} />
        <Section title="Blockers" items={entry.blockers} dot="bg-red-400" collapsed={!full} />
        <Section title="Plan for tomorrow" items={entry.plans} dot="bg-amber-400" collapsed={!full} />
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
                See more{hiddenItems > 0 ? ` · ${hiddenItems} more line${hiddenItems === 1 ? "" : "s"}` : ""}
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

        {/* Only imported reports carry original text; ones submitted here
            are already structured, so there is nothing rawer to show. */}
        {entry.raw?.trim() && (
        <div className="border-t border-border pt-2">
          <button onClick={onToggle} className="flex items-center gap-1 text-[11px] text-faint hover:text-zinc-100">
            {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            Original report text
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
