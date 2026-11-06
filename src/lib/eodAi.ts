import { arr, lines, obj, runQuickAction, str, strs } from "@/lib/quickAi";
import { todayIso, type EodDraft } from "@/lib/eodDraft";
import type { Client, EodReport, Message, Task } from "@/types/db";

/**
 * The EOD page's ✦ quick actions (Abder's "AI quick actions and cost" deck,
 * 6 Nov 2026).
 *
 *   My report  "write it in seconds": the AI drafts, the EA edits and submits.
 *              The AI never submits. Draft my report · Polish wording.
 *   Team       admins only, following the month and EA filters, in neutral
 *              wording: Summarize the team · Who needs attention? · Client
 *              weekly report.
 *
 * Every count, rate and rule is worked out here; the model only words them.
 * Items go to the model by short ref ("T1", "R4", "P2") and come back by the
 * same ref, so an answer can never point at something that isn't there.
 */

const p2 = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const parse = (day: string) => new Date(`${day}T00:00:00`);
const onDay = (ts: string | null | undefined, day: string) => {
  if (!ts) return false;
  const d = new Date(ts);
  return !Number.isNaN(d.getTime()) && todayIso(d) === day;
};
const dayOf = (ts: string | null | undefined) => {
  if (!ts) return "";
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? "" : todayIso(d);
};
const isWorking = (day: string) => { const w = parse(day).getDay(); return w !== 0 && w !== 6; };
const addDays = (day: string, n: number) => { const d = parse(day); d.setDate(d.getDate() + n); return iso(d); };
export const nextWorkingDay = (day: string) => { let d = addDays(day, 1); while (!isWorking(d)) d = addDays(d, 1); return d; };
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const short = (day: string) => { const d = parse(day); return `${d.getDate()} ${MON[d.getMonth()]}`; };
const weekday = (day: string) => DOW[parse(day).getDay()];
/** At most n words. */
const words = (s: string, n: number) => s.split(/\s+/).filter(Boolean).slice(0, n).join(" ");
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** "a, b and c". */
const andList = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/* ═══════════════════════════ MY REPORT ═══════════════════════════ */

export interface DraftFacts {
  day: string;
  next: string;
  done: Task[];
  emails: Message[];
  blocked: { task: Task; reason: string }[];
  plan: Task[];
}

/**
 * What the day's report can be drafted from: your tasks moved to Done that
 * day, emails sent that day, your tasks marked Blocked (with the reason) and
 * your open tasks due the next working day.
 *
 * Sent mail is the workspace's outbound mail for the day: messages carry no
 * sender account, so on a shared mailbox this can include a teammate's sends.
 * The EA edits before submitting, which is where that gets caught.
 */
export function draftFacts(tasks: Task[], messages: Message[], myId: string | undefined, day: string): DraftFacts {
  const next = nextWorkingDay(day);
  const mine = myId ? tasks.filter((t) => t.assignee_id === myId) : [];
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const open = mine.filter((t) => t.status !== "done");
  const blocked = open.flatMap((t) => {
    if (t.blocked) return [{ task: t, reason: t.blocker_note?.trim() || "no reason given" }];
    const dep = t.depends_on ? byId.get(t.depends_on) : undefined;
    return dep && dep.status !== "done" ? [{ task: t, reason: `waiting on "${dep.title}"` }] : [];
  });
  const blockedIds = new Set(blocked.map((b) => b.task.id));
  return {
    day,
    next,
    done: mine.filter((t) => t.status === "done" && onDay(t.completed_at, day)),
    emails: messages.filter((m) => m.direction === "outbound" && onDay(m.received_at, day)),
    blocked,
    plan: open.filter((t) => !blockedIds.has(t.id) && dayOf(t.due_at) === next),
  };
}

export const draftCount = (f: DraftFacts) => f.done.length + f.emails.length + f.blocked.length + f.plan.length;
export const DRAFT_EMPTY = "No activity today yet. Add items manually.";

/** "Drafted from 4 tasks done today, 2 emails sent and 1 blocker". */
export function draftSourceLine(f: DraftFacts, isToday: boolean): string {
  const parts = [
    f.done.length ? `${plural(f.done.length, "task")} done ${isToday ? "today" : `on ${short(f.day)}`}` : "",
    f.emails.length ? `${plural(f.emails.length, "email")} sent` : "",
    f.blocked.length ? plural(f.blocked.length, "blocker") : "",
    f.plan.length ? `${plural(f.plan.length, "task")} due ${weekday(f.next)}` : "",
  ].filter(Boolean);
  return `Drafted from ${andList(parts)}`;
}

const cleanList = (v: unknown) => strs(v, 240).map((s) => words(s, 20)).slice(0, 6);

export async function runEodDraft(f: DraftFacts) {
  const recipient = (m: Message) => m.client_name || m.sender_name || "a contact";
  return runQuickAction<EodDraft>({
    tool: "eod_draft",
    format: "Draft my report",
    page: "/eod",
    inputs: {
      "Report for": `${weekday(f.day)} ${short(f.day)}`,
      "Next working day": `${weekday(f.next)} ${short(f.next)}`,
      "Tasks moved to Done": f.done.length ? lines(f.done.map((t, i) => `T${i + 1} | ${t.title}${t.client_name ? ` | client: ${t.client_name}` : ""}`)) : "none",
      "Emails sent": f.emails.length ? lines(f.emails.map((m, i) => `E${i + 1} | to: ${recipient(m)} | subject: ${m.subject}`)) : "none",
      "Tasks marked Blocked": f.blocked.length ? lines(f.blocked.map((b, i) => `B${i + 1} | ${b.task.title} | reason: ${b.reason}`)) : "none",
      "Open tasks due next working day": f.plan.length ? lines(f.plan.map((t, i) => `P${i + 1} | ${t.title}`)) : "none",
    },
    check: (v) => {
      const o = obj(v);
      const d = { done: cleanList(o.completed), blockers: cleanList(o.blockers), plans: cleanList(o.plan) };
      if (!d.done.length && !d.blockers.length && !d.plans.length) throw new Error("Madeline's draft came back empty. Try again.");
      return d;
    },
    /* Demo: the same facts, worded by rule. A verb first, past tense for
       Completed, at most 6 a section and 20 words an item. */
    demo: () => ({
      done: [
        ...f.done.map((t) => `Finished "${t.title}"`),
        ...f.emails.map((m) => `Emailed ${recipient(m)} about "${m.subject}"`),
      ].map((s) => words(s, 20)).slice(0, 6),
      blockers: f.blocked.map((b) => words(`Waiting to move "${b.task.title}": ${b.reason}`, 20)).slice(0, 6),
      plans: f.plan.map((t) => words(`Finish "${t.title}"`, 20)).slice(0, 6),
    }),
  });
}

/* ── Polish wording ── */

const SECTIONS = [["done", "C"], ["blockers", "B"], ["plans", "P"]] as const;
type Section = (typeof SECTIONS)[number][0];
export interface PolishItem { section: Section; index: number; old: string; text: string }

/** Light, rules-based tidying for demo mode: shorthand spelled out, a capital and no trailing full stop. */
const SHORTHAND: [RegExp, string][] = [
  [/\bpls\b/gi, "please"], [/\bw\/o\b/gi, "without"], [/\bw\//gi, "with "], [/\basap\b/gi, "as soon as possible"],
  [/\bmtg\b/gi, "meeting"], [/\bmsg\b/gi, "message"], [/\bfyi\b/gi, "for information"], [/\bthx\b/gi, "thanks"],
  [/\btmrw\b/gi, "tomorrow"], [/\bre:\s*/gi, "about "], [/\s+&\s+/g, " and "],
];
function tidy(s: string): string {
  let t = s.replace(/\s+/g, " ").trim();
  for (const [re, to] of SHORTHAND) t = t.replace(re, to);
  t = t.replace(/\s{2,}/g, " ").replace(/[.;,]+$/, "").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * Rewrites each item, never adding or removing one. Only items that actually
 * changed come back; the page puts each into the form with its old wording
 * beside it, to Accept or Revert.
 */
export async function runEodPolish(draft: EodDraft) {
  const refs = new Map<string, { section: Section; index: number; old: string }>();
  for (const [section, letter] of SECTIONS) draft[section].forEach((old, index) => refs.set(`${letter}${index + 1}`, { section, index, old }));
  const changed = (list: { id: string; text: string }[]): PolishItem[] =>
    list.flatMap(({ id, text }) => {
      const r = refs.get(id);
      return r && text && text !== r.old ? [{ ...r, text }] : [];
    });
  return runQuickAction<PolishItem[]>({
    tool: "eod_polish",
    format: "Polish wording",
    page: "/eod",
    inputs: {
      Items: lines([...refs].map(([id, r]) => `${id} | ${r.section === "done" ? "completed" : r.section === "plans" ? "plan" : "blocker"} | ${r.old}`), 12000),
    },
    check: (v) => {
      const items = arr(obj(v).items).map((x) => obj(x)).map((x) => ({ id: str(x.id, 8).toUpperCase(), text: str(x.text, 300) }));
      /* Same meaning and every number: an answer that drops or invents a
         figure is not a rewording, so that item stays as it was. A rewrite
         much longer than the 20 words asked for is ignored too. */
      const nums = (s: string) => (s.match(/\d+([.,:]\d+)?/g) ?? []).sort().join("|");
      return changed(items.filter((x) => {
        const r = refs.get(x.id);
        return r && nums(r.old) === nums(x.text) && x.text.split(/\s+/).length <= 30;
      }));
    },
    demo: () => changed([...refs].map(([id, r]) => ({ id, text: tidy(r.old) }))),
  });
}

/* ═══════════════════════════ TEAM ═══════════════════════════ */

export interface TeamScope {
  /** Reports in the selected month, already narrowed to the EA filter. */
  reports: EodReport[];
  people: string[];
  /** "July 2026, all EAs". */
  label: string;
  /** The submission rate exactly as the page shows it. */
  rate: string;
  submitted: number;
  expected: number;
}

/* ── Summarize the team ── */

export interface TeamSummary {
  summary: string;
  themes: { text: string; reports: EodReport[] }[];
  highlights: { text: string; report: EodReport }[];
}

export const TEAM_EMPTY = "No reports in this period.";

/** Common blocker themes, for the demo's grouping. */
const THEMES: [RegExp, string][] = [
  [/\b(access|login|log in|password|credential|permission)/i, "Waiting on access or logins"],
  [/\b(approv|sign[- ]?off)/i, "Waiting on approvals"],
  [/\b(reply|respon|feedback|waiting on|waiting for|hear back)/i, "Waiting on replies or feedback"],
  [/\b(invoice|payment|paid|billing)/i, "Payments and invoices"],
  [/\b(internet|power|outage|laptop|wifi|connection)/i, "Connection or equipment problems"],
  [/\b(schedul|calendar|availability|reschedul)/i, "Scheduling and availability"],
];

export async function runTeamSummary(scope: TeamScope) {
  const sorted = [...scope.reports].sort((a, b) => b.report_date.localeCompare(a.report_date)).slice(0, 60);
  const byRef = new Map(sorted.map((r, i) => [`R${i + 1}`, r]));
  const lead = `${scope.rate} submission rate (${scope.submitted} of ${scope.expected} expected reports)`;
  const clip = (xs: string[], n: number) => xs.slice(0, n).map((x) => x.slice(0, 140)).join("; ");
  return runQuickAction<TeamSummary>({
    tool: "team_summary",
    format: "Summarize the team",
    page: "/eod",
    inputs: {
      Period: scope.label,
      "Submission rate": lead,
      Reports: lines([...byRef].map(([ref, r]) =>
        `${ref} | ${r.person} | ${short(r.report_date)} | done (${r.done.length}): ${clip(r.done, 4)} | blockers (${r.blockers.length}): ${clip(r.blockers, 3) || "none"}`), 12000),
    },
    check: (v) => {
      const o = obj(v);
      const summary = str(o.summary, 240);
      return {
        summary: summary.includes(scope.rate) ? summary : `${lead}.`,
        themes: arr(o.themes).map((x) => obj(x)).map((x) => ({
          text: words(str(x.text, 160), 15),
          reports: strs(x.refs, 8).map((r) => byRef.get(r.toUpperCase())).filter((r): r is EodReport => !!r).slice(0, 4),
        })).filter((t) => t.text && t.reports.length).slice(0, 3),
        highlights: arr(o.highlights).map((x) => obj(x)).map((x) => ({ text: words(str(x.text, 160), 15), report: byRef.get(str(x.ref, 8).toUpperCase()) }))
          .filter((h): h is { text: string; report: EodReport } => !!h.text && !!h.report).slice(0, 2),
      };
    },
    demo: () => {
      const groups = new Map<string, EodReport[]>();
      for (const r of sorted) {
        for (const b of r.blockers) {
          const hit = THEMES.find(([re]) => re.test(b));
          if (!hit) continue;
          const list = groups.get(hit[1]) ?? [];
          if (!list.includes(r)) list.push(r);
          groups.set(hit[1], list);
        }
      }
      const themes = [...groups].sort((a, b) => b[1].length - a[1].length).slice(0, 3)
        .map(([text, rs]) => ({ text: `${text} (${plural(rs.length, "report")})`, reports: rs.slice(0, 4) }));
      const highlights = [...sorted].filter((r) => r.done.length).sort((a, b) => b.done.length - a.done.length).slice(0, 2)
        .map((r) => ({ text: words(`${(r.person ?? "").split(" ")[0]}: ${r.done[0]}`, 15), report: r }));
      const withBlockers = sorted.filter((r) => r.blockers.length).length;
      return { summary: `${lead}; ${plural(withBlockers, "report")} raised blockers.`, themes, highlights };
    },
  });
}

/* ── Who needs attention? ── */

export const NO_REPORT_DAYS = 3;
export const SAME_BLOCKER_REPORTS = 2;
export const OVERDUE_TASKS = 3;
export const ATTENTION_EMPTY = "Everyone is on track.";

export interface AttentionRow { person: string; facts: string[]; reason: string }

/** Working days after `from` up to and including `to`. */
function workingDaysBetween(from: string, to: string): number {
  let n = 0;
  for (let d = addDays(from, 1); d <= to; d = addDays(d, 1)) if (isWorking(d)) n++;
  return n;
}
const blockerKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean).slice(0, 8).join(" ");

/**
 * The rules, in code (deck: "AI writes the reasons only"):
 *   no report for 3+ working days · the same blocker in 2+ reports ·
 *   3+ overdue tasks.
 * The report rules follow the month and EA filters. Days are counted to the
 * end of the month, or to yesterday for the current month (today's report
 * isn't due yet). Overdue tasks are as of today.
 */
export function findAttention(opts: {
  people: string[]; allReports: EodReport[]; monthReports: EodReport[]; month: string; today: string;
  tasks: Task[]; idOf: (name: string) => string | undefined;
}): AttentionRow[] {
  const [y, m] = opts.month.split("-").map(Number);
  const monthEnd = iso(new Date(y, m, 0));
  const yesterday = addDays(opts.today, -1);
  const end = monthEnd < opts.today ? monthEnd : yesterday;
  const monthStart = `${opts.month}-01`;
  const rows: (AttentionRow & { weight: number })[] = [];
  for (const person of opts.people) {
    const facts: string[] = [];
    let weight = 0;
    const last = opts.allReports.filter((r) => r.person === person && r.report_date <= end).map((r) => r.report_date).sort().pop();
    const gap = workingDaysBetween(last ?? addDays(monthStart, -1), end);
    if (end >= monthStart && gap >= NO_REPORT_DAYS) {
      facts.push(last ? `No report for ${gap} working days (last on ${short(last)})` : `No report in ${gap} working days this month`);
      weight += gap;
    }
    const seen = new Map<string, { text: string; n: number }>();
    for (const r of opts.monthReports.filter((r) => r.person === person)) {
      for (const k of new Set(r.blockers.map(blockerKey).filter(Boolean))) {
        const text = r.blockers.find((b) => blockerKey(b) === k)!;
        seen.set(k, { text, n: (seen.get(k)?.n ?? 0) + 1 });
      }
    }
    const repeat = [...seen.values()].sort((a, b) => b.n - a.n)[0];
    if (repeat && repeat.n >= SAME_BLOCKER_REPORTS) {
      facts.push(`Same blocker in ${repeat.n} reports: "${words(repeat.text, 8)}"`);
      weight += repeat.n * 2;
    }
    const id = opts.idOf(person);
    const overdue = id ? opts.tasks.filter((t) => t.assignee_id === id && t.status !== "done" && t.due_at && dayOf(t.due_at) < opts.today).length : 0;
    if (overdue >= OVERDUE_TASKS) { facts.push(`${overdue} overdue tasks`); weight += overdue; }
    if (facts.length) rows.push({ person, facts, reason: facts.join("; "), weight });
  }
  return rows.sort((a, b) => b.weight - a.weight).slice(0, 5).map(({ weight: _w, ...r }) => r);
}

/** No judgement words, ever: a reason that has one is replaced by the plain facts. */
const JUDGEMENT = /\b(lazy|poor|poorly|fail|failing|failed|bad|careless|negligent|unreliable|slacking|disappoint\w*|worrying)\b/i;

export async function runTeamAttention(rows: AttentionRow[]) {
  const byRef = new Map(rows.map((r, i) => [`P${i + 1}`, r]));
  return runQuickAction<AttentionRow[]>({
    tool: "team_attention",
    format: "Who needs attention?",
    page: "/eod",
    inputs: { People: lines([...byRef].map(([ref, r]) => `${ref} | ${r.person} | ${r.facts.join("; ")}`)) },
    check: (v) => {
      const said = new Map(arr(obj(v).rows).map((x) => obj(x)).map((x) => [str(x.ref, 8).toUpperCase(), words(str(x.reason, 200), 15)]));
      return [...byRef].map(([ref, r]) => {
        const reason = said.get(ref);
        return { ...r, reason: reason && !JUDGEMENT.test(reason) ? reason : r.reason };
      });
    },
    demo: () => rows,
  });
}

/* ── Client weekly report ── */

export const WEEKLY_EMPTY = "No activity for this client this week.";

export interface ClientWeekFacts {
  client: Client;
  lo: string;
  hi: string;
  completed: string[];
  inProgress: string[];
  needs: string[];
  nextWeek: string[];
  /** EOD lines that mention the client, for context. */
  eodLines: string[];
  count: number;
}

export interface ClientWeekly {
  highlights: string[];
  completed: string[];
  in_progress: string[];
  needs_from_you: string[];
  next_week: string[];
}

/** Mon to Sun of the week holding `day`. */
export function weekAround(day: string): { lo: string; hi: string } {
  const d = parse(day);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const lo = iso(d);
  return { lo, hi: addDays(lo, 6) };
}

/**
 * One client's week, from their tasks and the EOD lines that name them (the
 * reports have no client field, so the client's name or company in a line is
 * the link). Narrowed to one EA when the EA filter is set.
 */
export function clientWeekFacts(opts: {
  client: Client; tasks: Task[]; reports: EodReport[]; lo: string; hi: string; assigneeId?: string;
}): ClientWeekFacts {
  const { client, lo, hi } = opts;
  const inWeek = (ts: string | null | undefined) => { const d = dayOf(ts); return !!d && d >= lo && d <= hi; };
  const tasks = opts.tasks.filter((t) => t.client_id === client.id && (!opts.assigneeId || t.assignee_id === opts.assigneeId));
  const nextLo = addDays(hi, 1);
  const nextHi = addDays(hi, 7);
  const completed = tasks.filter((t) => t.status === "done" && inWeek(t.completed_at)).map((t) => t.title);
  // Not started and due next week: "Next week", not "In progress", so nothing is listed twice.
  const next = tasks.filter((t) => t.status !== "done" && t.status !== "in_progress" && !t.blocked && t.due_at && dayOf(t.due_at) >= nextLo && dayOf(t.due_at) <= nextHi);
  const nextIds = new Set(next.map((t) => t.id));
  const inProgress = tasks.filter((t) => t.status !== "done" && !t.blocked && !nextIds.has(t.id) && (t.status === "in_progress" || inWeek(t.updated_at))).map((t) => t.title);
  // Only the blocker text written for the client (0075); the team's own note stays internal.
  const needs = tasks.filter((t) => t.status !== "done" && t.blocked && t.client_visible_blocker?.trim()).map((t) => `${t.title}: ${t.client_visible_blocker!.trim()}`);
  const nextWeek = next.map((t) => t.title);
  const names = [client.name, client.company].map((s) => (s ?? "").trim().toLowerCase()).filter((s) => s.length >= 3);
  const mentions = (s: string) => { const l = s.toLowerCase(); return names.some((n) => l.includes(n)); };
  const eodLines = opts.reports
    .filter((r) => r.report_date >= lo && r.report_date <= hi)
    .flatMap((r) => [...r.done.map((x) => `done: ${x}`), ...r.plans.map((x) => `planned: ${x}`)])
    .filter(mentions)
    .slice(0, 20);
  return { client, lo, hi, completed, inProgress, needs, nextWeek, eodLines, count: completed.length + inProgress.length + needs.length + nextWeek.length + eodLines.length };
}

/** Strips anything that looks like an internal id or ref before it reaches a client. */
const clientSafe = (s: string) => s.replace(/\b([TREPBCM]\d{1,3}|EOS-\d+|[0-9a-f]{8}-[0-9a-f-]{27,})\b/g, "").replace(/\s{2,}/g, " ").replace(/\s+([,.;:])/g, "$1").trim();

/** Keeps the whole update within 200 words, trimming the longest lists last-first. */
function cap200(w: ClientWeekly): ClientWeekly {
  const out: ClientWeekly = { ...w };
  const keys: (keyof ClientWeekly)[] = ["next_week", "in_progress", "completed", "highlights", "needs_from_you"];
  const count = () => Object.values(out).flat().join(" ").split(/\s+/).filter(Boolean).length;
  for (const k of keys) while (count() > 200 && out[k].length > 1) out[k] = out[k].slice(0, -1);
  return out;
}

export async function runClientWeekly(f: ClientWeekFacts) {
  const list = (xs: string[]) => (xs.length ? lines(xs.map((x) => `- ${x}`), 3000) : "none");
  const clean = (v: unknown, n: number) => strs(v, 240).map(clientSafe).filter(Boolean).slice(0, n);
  return runQuickAction<ClientWeekly>({
    tool: "client_weekly",
    format: "Client weekly report",
    page: "/eod",
    inputs: {
      Client: `${f.client.name}${f.client.company ? `, ${f.client.company}` : ""}`,
      Week: `${short(f.lo)} to ${short(f.hi)}`,
      "Completed this week": list(f.completed),
      "In progress": list(f.inProgress),
      "Waiting on the client": list(f.needs),
      "Due next week": list(f.nextWeek),
      "From the team's end-of-day reports": list(f.eodLines),
    },
    check: (v) => {
      const o = obj(v);
      return cap200({
        highlights: clean(o.highlights, 3), completed: clean(o.completed, 6), in_progress: clean(o.in_progress, 6),
        needs_from_you: clean(o.needs_from_you, 4), next_week: clean(o.next_week, 5),
      });
    },
    demo: () => cap200({
      highlights: [
        f.completed.length ? `${plural(f.completed.length, "task")} completed this week` : "",
        f.needs.length ? `${plural(f.needs.length, "item")} waiting on you` : "",
      ].filter(Boolean),
      completed: [...f.completed, ...f.eodLines.filter((l) => l.startsWith("done: ")).map((l) => l.slice(6))].map(clientSafe).slice(0, 6),
      in_progress: f.inProgress.map(clientSafe).slice(0, 6),
      needs_from_you: f.needs.map(clientSafe).slice(0, 4),
      next_week: [...f.nextWeek, ...f.eodLines.filter((l) => l.startsWith("planned: ")).map((l) => l.slice(9))].map(clientSafe).slice(0, 5),
    }),
  });
}

export const WEEKLY_SECTIONS: [keyof ClientWeekly, string][] = [
  ["highlights", "Highlights"], ["completed", "Completed"], ["in_progress", "In progress"],
  ["needs_from_you", "Needs from you"], ["next_week", "Next week"],
];

/** The update as plain text, for Copy and Send. */
export function weeklyText(f: ClientWeekFacts, w: ClientWeekly, from?: string): string {
  const first = f.client.name.split(" ")[0];
  const body = WEEKLY_SECTIONS.filter(([k]) => w[k].length).map(([k, label]) => `${label}\n${w[k].map((x) => `• ${x}`).join("\n")}`).join("\n\n");
  return `Hi ${first},\n\nHere is your update for the week of ${short(f.lo)} to ${short(f.hi)}.\n\n${body}\n\nBest regards${from ? `,\n${from.split(" ")[0]}` : ""}`;
}
