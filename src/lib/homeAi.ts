import type { Client, Meeting, Message, Task, TaskActivity, TaskComment, TaskEvent, TimeEntry } from "@/types/db";
import type { Flag } from "@/lib/followups";
import { STAGE_LABEL, dayKey, nextWorkingDay, shortDate } from "@/lib/taskInsights";
import { taskLine } from "@/lib/taskPrioritizeAi";
import { arr, lines, obj, str } from "@/lib/quickAi";
import { supabase } from "@/lib/supabase";
import { loadDemoActivity, loadDemoComments } from "@/store/demoComments";
import { loadDemoTaskEvents } from "@/store/demoAssignees";
import { capKeep, isAutomated } from "@/lib/inboxAi";

/**
 * The three ✦ actions on Home (Abder's "AI quick actions and cost" deck,
 * 6 Nov 2026): Plan my day, Catch me up, Draft follow-ups.
 *
 * Each one builds its facts here, in code, with short refs ("T1", "M2", "F3")
 * that map back to real rows; every count is worked out here too. The model
 * only words the answer (prompts in supabase/functions/generate/quickActions.ts)
 * and `check*` drops anything that does not map back to a ref we sent. The
 * `demo*` answers are rules over the same facts, so demo mode is honest.
 */

const DAY = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");
export const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const fromMin = (m: number) => { const c = Math.max(0, Math.min(23 * 60 + 59, Math.round(m))); return `${pad(Math.floor(c / 60))}:${pad(c % 60)}`; };
const isHhmm = (v: unknown): v is string => typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const words = (v: unknown, n: number) => str(v).split(" ").filter(Boolean).slice(0, n).join(" ");
const plural = (n: number, w: string, many = `${w}s`) => `${n} ${n === 1 ? w : many}`;
const daysAgo = (iso: string | null | undefined, now: Date) => {
  const t = Date.parse(iso ?? "");
  return Number.isFinite(t) ? Math.max(0, Math.floor((now.getTime() - t) / DAY)) : null;
};
const firstName = (name: string | null | undefined) => (name ?? "").trim().split(/\s+/)[0] ?? "";

/* ─────────────────────────── Plan my day ─────────────────────────── */

export type PlanKind = "meeting" | "task" | "followup" | "eod";
export interface PlanRow {
  time: string;
  end: string;
  kind: PlanKind;
  action: string;
  reason: string;
  meeting?: Meeting;
  task?: Task;
  flag?: Flag;
}
export interface PlanResult { summary: string; rows: PlanRow[]; date: string }

/** Meetings carry no end time, so a block of this length is assumed and said so. */
const MEETING_MIN = 30;
const EOD_MIN = 15;

/**
 * Today's shift: from the first clock-in today if there is one, else 09:00,
 * for the workspace's daily hours. The app keeps no fixed shift times, so this
 * is the closest honest reading of "shift hours".
 */
export function shiftFor(now: Date, entries: TimeEntry[], dailyHours: number): { start: string; end: string } {
  const today = dayKey(now);
  const first = entries
    .filter((e) => e.work_date === today || dayKey(new Date(e.started_at)) === today)
    .map((e) => new Date(e.started_at))
    .sort((a, b) => a.getTime() - b.getTime())[0];
  const start = first ? toMin(hhmm(first)) : 9 * 60;
  return { start: fromMin(start), end: fromMin(start + (dailyHours || 8) * 60) };
}

const PRIORITY_RANK: Record<Task["priority"], number> = { urgent: 0, high: 1, normal: 2, low: 3 };
/** Overdue, then due today, then by priority and due date. */
function taskOrder(a: Task, b: Task, today: string): number {
  const rank = (t: Task) => { const d = t.due_at?.slice(0, 10); return !d ? 2 : d < today ? 0 : d === today ? 1 : 2; };
  return rank(a) - rank(b) || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
    || (Date.parse(a.due_at ?? "") || Infinity) - (Date.parse(b.due_at ?? "") || Infinity);
}

export interface PlanFacts {
  inputs: Record<string, string>;
  meetings: Map<string, Meeting>;
  tasks: Map<string, Task>;
  flags: Map<string, Flag>;
  window: { start: string; end: string; eod: string };
  shift: { start: string; end: string };
  empty: boolean;
  date: string;
}

export function planFacts(opts: {
  now: Date; meetings: Meeting[]; tasks: Task[]; flags: Flag[]; shift: { start: string; end: string };
  name: (id: string | null | undefined) => string;
}): PlanFacts {
  const { now, shift } = opts;
  const today = dayKey(now);
  const nowMin = toMin(hhmm(now));
  // From now (to the next quarter hour) or the shift start, whichever is later.
  const start = Math.max(Math.ceil(nowMin / 15) * 15, toMin(shift.start));
  // Working past the end of the shift still gets a short plan rather than none.
  let end = toMin(shift.end);
  if (end - start < 90) end = Math.min(start + 90, 23 * 60 + 59);
  const eod = end - EOD_MIN;

  const todays = opts.meetings
    .filter((m) => m.starts_at && dayKey(new Date(m.starts_at)) === today)
    .filter((m) => toMin(hhmm(new Date(m.starts_at!))) + MEETING_MIN > nowMin)
    .sort((a, b) => Date.parse(a.starts_at!) - Date.parse(b.starts_at!))
    .slice(0, 4);
  const open = opts.tasks.filter((t) => t.status !== "done").sort((a, b) => taskOrder(a, b, today)).slice(0, 15);
  const flags = opts.flags.slice(0, 5);

  const meetings = new Map(todays.map((m, i) => [`M${i + 1}`, m]));
  const tasks = new Map(open.map((t, i) => [`T${i + 1}`, t]));
  const flagMap = new Map(flags.map((f, i) => [`F${i + 1}`, f]));

  const inputs: Record<string, string> = {
    Today: `${today} (${now.toLocaleDateString("en-GB", { weekday: "long" })})`,
    "Time now": hhmm(now),
    "Shift hours": `${shift.start} to ${shift.end}. Plan from ${fromMin(start)}; the EOD report goes at ${fromMin(eod)}.`,
    "Today's meetings (fixed; end times are not stored, assume 30 minutes)": meetings.size
      ? lines([...meetings].map(([r, m]) => `${r} | ${hhmm(new Date(m.starts_at!))} | "${m.title}" | with ${m.with}`))
      : "none",
    "Open tasks": tasks.size ? lines([...tasks].map(([r, t]) => taskLine(r, t, now, today, opts.name))) : "none",
    "Waiting on a follow-up": flagMap.size ? lines([...flagMap].map(([r, f]) => `${r} | "${f.title}" | ${f.subtitle} | ${f.reason}`)) : "none",
    Counts: `${meetings.size} meetings left today, ${open.length} open tasks listed, ${flagMap.size} follow-ups.`,
  };
  return {
    inputs, meetings, tasks, flags: flagMap,
    window: { start: fromMin(start), end: fromMin(end), eod: fromMin(eod) },
    shift, empty: !meetings.size && !tasks.size && !flagMap.size, date: today,
  };
}

function taskReason(t: Task, today: string, now: Date): string {
  const due = t.due_at?.slice(0, 10);
  if (due && due < today) return `${plural(Math.round((Date.parse(today) - Date.parse(due)) / DAY), "day")} overdue`;
  if (due === today) return `Due today, ${t.priority} priority`;
  if (t.blocked) return "Blocked; chase what it is waiting on";
  if (due) return `${t.priority[0].toUpperCase()}${t.priority.slice(1)} priority, due ${shortDate(due)}`;
  const upd = daysAgo(t.updated_at, now);
  return upd !== null ? `${t.priority[0].toUpperCase()}${t.priority.slice(1)} priority, last update ${upd} days ago` : `${t.priority} priority`;
}

const eodRow = (f: PlanFacts): PlanRow => ({
  time: f.window.eod, end: f.window.end, kind: "eod",
  action: "Write and send your EOD report", reason: `Your shift ends at ${f.window.end}`,
});

function planSummary(rows: PlanRow[], f: PlanFacts): string {
  const n = (k: PlanKind) => rows.filter((r) => r.kind === k).length;
  const parts = [n("meeting") && plural(n("meeting"), "meeting"), n("task") && plural(n("task"), "task"), n("followup") && plural(n("followup"), "follow-up")].filter(Boolean);
  return `${plural(rows.length, "block")} from ${f.window.start} to ${f.window.end}${parts.length ? `: ${parts.join(", ")}` : ""}, then your EOD report.`;
}

/** Rules over the same facts: meetings fixed, the rest fitted into the gaps. */
export function demoPlan(f: PlanFacts, now: Date): PlanResult {
  if (f.empty) return { summary: "Nothing is due or scheduled today.", rows: [], date: f.date };
  const today = dayKey(now);
  const fixed: PlanRow[] = [...f.meetings.values()].map((m) => {
    const s = toMin(hhmm(new Date(m.starts_at!)));
    return { time: fromMin(s), end: fromMin(s + MEETING_MIN), kind: "meeting", action: words(`Attend ${m.title}`, 8), reason: `Fixed meeting with ${m.with}`, meeting: m };
  });
  // Task titles already start with a verb, so the title is the action.
  const queue: PlanRow[] = [
    ...[...f.tasks.values()].map((t): PlanRow => ({ time: "", end: "", kind: "task", action: capWords(t.title, 10), reason: words(taskReason(t, today, now), 12), task: t })),
    ...[...f.flags.values()].map((fl): PlanRow => ({ time: "", end: "", kind: "followup", action: words(`Follow up with ${fl.subtitle}`, 8), reason: words(`${fl.reason} on ${fl.title}`, 12), flag: fl })),
  ];
  const budget = Math.max(0, 5 - fixed.length);
  const placed: PlanRow[] = [];
  let cursor = toMin(f.window.start);
  const eod = toMin(f.window.eod);
  const busy = fixed.map((r) => [toMin(r.time), toMin(r.end)] as const).sort((a, b) => a[0] - b[0]);
  while (placed.length < budget && queue.length && cursor < eod) {
    const clash = busy.find(([s, e]) => cursor >= s && cursor < e);
    if (clash) { cursor = clash[1]; continue; }
    const next = busy.find(([s]) => s > cursor)?.[0] ?? eod;
    const gap = Math.min(next, eod) - cursor;
    if (gap < 15) { cursor = next; continue; }
    const row = queue.shift()!;
    const len = Math.min(row.kind === "followup" ? 15 : 60, gap);
    placed.push({ ...row, time: fromMin(cursor), end: fromMin(cursor + len) });
    cursor += len;
  }
  const rows = [...fixed, ...placed].sort((a, b) => toMin(a.time) - toMin(b.time));
  rows.push(eodRow(f));
  return { summary: planSummary(rows, f), rows, date: f.date };
}

export function checkPlan(v: unknown, f: PlanFacts): PlanResult {
  const o = obj(v);
  const raw = arr(o.rows);
  const seen = new Set<string>();
  const rows: PlanRow[] = [];
  for (const x of raw) {
    const r = obj(x);
    const kind = str(r.kind) as PlanKind;
    const time = str(r.time);
    if (!isHhmm(time)) continue;
    const ref = str(r.ref).toUpperCase();
    const base = { time, end: isHhmm(str(r.end)) ? str(r.end) : "", action: words(r.action, 10), reason: words(r.reason, 14) };
    if (kind === "eod") continue; // added below, always last
    if (seen.has(ref)) continue;
    if (kind === "meeting" && f.meetings.has(ref)) rows.push({ ...base, kind, meeting: f.meetings.get(ref) });
    else if (kind === "task" && f.tasks.has(ref)) rows.push({ ...base, kind, task: f.tasks.get(ref) });
    else if (kind === "followup" && f.flags.has(ref)) rows.push({ ...base, kind, flag: f.flags.get(ref) });
    else continue;
    seen.add(ref);
  }
  if (!rows.length && !f.empty) throw new Error("Madeline's plan didn't match your tasks. Try again.");
  if (!rows.length) return { summary: "Nothing is due or scheduled today.", rows: [], date: f.date };
  rows.sort((a, b) => toMin(a.time) - toMin(b.time));
  const kept = rows.slice(0, 5);
  // A block with no end runs to the next one (or 30 minutes).
  kept.forEach((r, i) => { if (!r.end) r.end = kept[i + 1]?.time ?? fromMin(toMin(r.time) + 30); });
  for (const r of kept) if (!r.action) r.action = r.task?.title ?? r.meeting?.title ?? r.flag?.title ?? "";
  kept.push(eodRow(f));
  const summary = str(o.summary, 300) || planSummary(kept, f);
  return { summary, rows: kept, date: f.date };
}

/* ─────────────────────────── Catch me up ─────────────────────────── */

export type CatchGroupName = "Tasks" | "Inbox" | "Team";
export interface CatchChange { ref: string; group: CatchGroupName; text: string; link: string; at: string }
export interface CatchGroup { group: CatchGroupName; items: { text: string; link: string }[] }
export interface CatchResult { summary: string; groups: CatchGroup[] }

const LAST_VISIT_KEY = (uid: string) => `madeea-home-last-visit:${uid}`;
export function readLastVisit(uid: string): Date {
  try {
    const t = Date.parse(localStorage.getItem(LAST_VISIT_KEY(uid)) ?? "");
    if (Number.isFinite(t)) return new Date(t);
  } catch { /* storage blocked */ }
  // First visit on this browser: the last day is the honest window.
  return new Date(Date.now() - DAY);
}
export function writeLastVisit(uid: string, at = new Date()) {
  try { localStorage.setItem(LAST_VISIT_KEY(uid), at.toISOString()); } catch { /* storage blocked */ }
}

/** "Tuesday 18:05", "today 08:40", or with the date when it was over a week ago. */
export function visitLabel(d: Date, now = new Date()): string {
  if (dayKey(d) === dayKey(now)) return `today ${hhmm(d)}`;
  const old = now.getTime() - d.getTime() > 6 * DAY;
  return `${d.toLocaleDateString("en-GB", old ? { weekday: "long", day: "numeric", month: "short" } : { weekday: "long" })} ${hhmm(d)}`;
}

function activityText(a: TaskActivity, who: string, title: string): string {
  switch (a.verb) {
    case "status": return `${who} moved "${title}" to ${STAGE_LABEL[a.to_value as Task["status"]] ?? a.to_value}`;
    case "priority": return `${who} set "${title}" to ${a.to_value} priority`;
    case "due": return `${who} moved the due date of "${title}" to ${a.to_value ? shortDate(a.to_value.slice(0, 10)) : "none"}`;
    case "blocked": return `${who} marked "${title}" blocked`;
    case "unblocked": return `${who} unblocked "${title}"`;
    case "created": return `${who} created "${title}"`;
    case "commented": return `${who} commented on "${title}"`;
    default: return `${who} updated "${title}"`;
  }
}

/**
 * Every change since `since` made by someone else, as facts: task activity,
 * assignments to me, comments, and new incoming mail. Reads go through the
 * user's own session, so RLS decides what they may see.
 */
export async function fetchChanges(opts: {
  since: Date; me: Set<string>; tasks: Task[]; messages: Message[];
  name: (id: string | null | undefined) => string;
}): Promise<CatchChange[]> {
  const { since, me, tasks } = opts;
  const iso = since.toISOString();
  const after = (at: string) => Date.parse(at) > since.getTime();
  const byOther = (id: string | null | undefined) => Boolean(id) && !me.has(id!);
  let activity: TaskActivity[] = [];
  let comments: TaskComment[] = [];
  let events: TaskEvent[] = [];
  if (supabase) {
    const [a, c, e] = await Promise.all([
      supabase.from("task_activity").select("id,task_id,actor_id,verb,from_value,to_value,created_at").gt("created_at", iso).order("created_at", { ascending: false }).limit(100),
      supabase.from("task_comments").select("id,task_id,author_id,body,created_at").gt("created_at", iso).order("created_at", { ascending: false }).limit(100),
      supabase.from("task_events").select("id,task_id,actor_id,from_user_id,to_user_id,created_at").gt("created_at", iso).order("created_at", { ascending: false }).limit(100),
    ]);
    // A table not migrated yet reads as "no changes of that kind", not an error.
    activity = (a.data ?? []) as TaskActivity[];
    comments = (c.data ?? []) as TaskComment[];
    events = (e.data ?? []) as TaskEvent[];
  } else {
    activity = loadDemoActivity();
    comments = loadDemoComments();
    events = loadDemoTaskEvents();
  }
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const mineTask = (t: Task | undefined) => Boolean(t && ((t.assignee_id && me.has(t.assignee_id)) || (!t.assignee_id && t.owner_id && me.has(t.owner_id))));
  const out: Omit<CatchChange, "ref">[] = [];
  const seenTask = new Set<string>();

  for (const ev of events) {
    if (!after(ev.created_at) || !byOther(ev.actor_id) || !ev.to_user_id || !me.has(ev.to_user_id)) continue;
    const t = taskById.get(ev.task_id);
    if (!t) continue;
    seenTask.add(t.id);
    out.push({ group: "Tasks", text: `${opts.name(ev.actor_id)} assigned you "${t.title}"`, link: `/tasks?task=${t.id}`, at: ev.created_at });
  }
  for (const a of activity) {
    if (!after(a.created_at) || !byOther(a.actor_id) || a.verb === "commented") continue;
    const t = taskById.get(a.task_id);
    if (!t) continue;
    seenTask.add(t.id);
    out.push({ group: mineTask(t) ? "Tasks" : "Team", text: activityText(a, opts.name(a.actor_id), t.title), link: `/tasks?task=${t.id}`, at: a.created_at });
  }
  for (const c of comments) {
    if (!after(c.created_at) || !byOther(c.author_id)) continue;
    const t = taskById.get(c.task_id);
    if (!t) continue;
    out.push({ group: mineTask(t) ? "Tasks" : "Team", text: `${opts.name(c.author_id)} commented on "${t.title}"`, link: `/tasks?task=${t.id}`, at: c.created_at });
  }
  /* Demo has no other people writing activity, so a teammate's task touched
     since the last visit stands in for it; live mode reads task_activity. */
  if (!supabase) {
    for (const t of tasks) {
      if (seenTask.has(t.id) || !t.updated_at || !after(t.updated_at) || !t.assignee_id || me.has(t.assignee_id)) continue;
      out.push({ group: "Team", text: `${opts.name(t.assignee_id)} updated "${t.title}"`, link: `/tasks?task=${t.id}`, at: t.updated_at });
    }
  }
  for (const m of opts.messages) {
    if (m.direction === "outbound" || !m.received_at || !after(m.received_at) || isAutomated(m)) continue;
    out.push({ group: "Inbox", text: `${m.sender_name || m.sender_email || "Someone"} emailed "${m.subject || "(no subject)"}"`, link: `/inbox?message=${m.id}`, at: m.received_at });
  }
  return out
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, 30)
    .map((c, i) => ({ ...c, ref: `C${i + 1}` }));
}

const GROUPS: CatchGroupName[] = ["Tasks", "Inbox", "Team"];

export function catchSummary(changes: CatchChange[], label: string): string {
  if (!changes.length) return `Nothing new since ${label}.`;
  const n = (g: CatchGroupName) => changes.filter((c) => c.group === g).length;
  const parts = [
    n("Tasks") && plural(n("Tasks"), "change") + " on your tasks",
    n("Inbox") && plural(n("Inbox"), "new email"),
    n("Team") && plural(n("Team"), "team update"),
  ].filter(Boolean);
  return `${plural(changes.length, "change")} since ${label}: ${parts.join(", ")}.`;
}

export function catchFacts(changes: CatchChange[], label: string): Record<string, string> {
  return {
    "Last visit": label,
    Changes: changes.length ? lines(changes.map((c) => `${c.ref} | ${c.group} | ${c.text} | ${shortDate(dayKey(new Date(c.at)))} ${hhmm(new Date(c.at))}`)) : "none",
    Counts: catchSummary(changes, label),
  };
}

export function demoCatchUp(changes: CatchChange[], label: string): CatchResult {
  const groups = GROUPS.map((g) => ({
    group: g,
    items: changes.filter((c) => c.group === g).slice(0, 3).map((c) => ({ text: words(c.text, 14), link: c.link })),
  })).filter((g) => g.items.length);
  return { summary: catchSummary(changes, label), groups };
}

export function checkCatchUp(v: unknown, changes: CatchChange[], label: string): CatchResult {
  const o = obj(v);
  const byRef = new Map(changes.map((c) => [c.ref, c]));
  const groups: CatchGroup[] = [];
  for (const g of arr(o.groups)) {
    const go = obj(g);
    const name = GROUPS.find((x) => x.toLowerCase() === str(go.group).toLowerCase());
    if (!name || groups.some((x) => x.group === name)) continue;
    const items = arr(go.items).flatMap((it) => {
      const io = obj(it);
      const c = byRef.get(str(io.ref).toUpperCase());
      return c ? [{ text: words(io.text, 16) || words(c.text, 14), link: c.link }] : [];
    }).slice(0, 3);
    if (items.length) groups.push({ group: name, items });
    if (groups.length >= 3) break;
  }
  if (changes.length && !groups.length) throw new Error("Madeline's answer didn't match your changes. Try again.");
  // The total is worked out here; the model's sentence is kept only if it repeats it.
  const s = str(o.summary, 300);
  const summary = s && (changes.length ? s.includes(String(changes.length)) : true) ? s : catchSummary(changes, label);
  return { summary: changes.length ? summary : `Nothing new since ${label}.`, groups };
}

/* ─────────────────────────── Draft follow-ups ─────────────────────────── */

export interface FollowItem {
  ref: string;
  flag: Flag;
  /** The contact's address as stored, or "" when there is none. */
  to: string;
  contact: string;
  subject: string;
  body: string;
  lastContact: string | null;
  channel: string;
  message?: Message;
  task?: Task;
}
export interface FollowResult { summary: string; items: FollowItem[] }

export interface FollowFacts { inputs: Record<string, string>; items: Map<string, Omit<FollowItem, "subject" | "body">>; me: string }

export function followFacts(opts: { flags: Flag[]; messages: Message[]; tasks: Task[]; clients: Client[]; myName: string; now: Date }): FollowFacts {
  const items = new Map<string, Omit<FollowItem, "subject" | "body">>();
  opts.flags.slice(0, 10).forEach((flag, i) => {
    const ref = `F${i + 1}`;
    if (flag.itemType === "message") {
      const m = opts.messages.find((x) => x.id === flag.itemId);
      // On mail we sent, the contact is who it went to.
      const to = m?.sender_email || m?.to_emails?.[0] || "";
      items.set(ref, { ref, flag, to, contact: m?.sender_name || flag.subtitle, lastContact: m?.received_at ?? null, channel: m?.source ?? "gmail", message: m });
    } else {
      const t = opts.tasks.find((x) => x.id === flag.itemId);
      const c = t?.client_id ? opts.clients.find((x) => x.id === t.client_id) : undefined;
      items.set(ref, { ref, flag, to: c?.email ?? "", contact: c?.name ?? flag.subtitle, lastContact: t?.updated_at ?? null, channel: "email", task: t });
    }
  });
  const line = (it: Omit<FollowItem, "subject" | "body">) => {
    const last = it.lastContact ? `${it.lastContact.slice(0, 10)} (${plural(daysAgo(it.lastContact, opts.now) ?? 0, "day")} ago)` : "unknown";
    const contact = it.to ? `${it.contact} <${it.to}>` : `${it.contact} (no email given)`;
    return it.message
      ? `${it.ref} | email we sent, no reply | subject: "${it.message.subject}" | to: ${contact} | channel: ${it.channel} | last contact: ${last} | what we sent: "${(it.message.body || it.message.preview || "").slice(0, 400)}"`
      : `${it.ref} | task with no update | "${it.flag.title}" | contact: ${contact} | last update: ${last}`;
  };
  return {
    inputs: {
      Today: dayKey(opts.now),
      "Sender first name": firstName(opts.myName) || "not given",
      "Items gone quiet": items.size ? lines([...items.values()].map(line)) : "none",
      Count: `${items.size} items.`,
    },
    items,
    me: firstName(opts.myName),
  };
}

const longDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }) : "earlier");
const capWords = (s: string, n: number) => { const w = s.split(/\s+/).filter(Boolean); return w.length > n ? w.slice(0, n).join(" ") + "…" : w.join(" "); };

export function demoFollowUps(f: FollowFacts, now: Date): FollowResult {
  if (!f.items.size) return { summary: "Nothing has gone quiet.", items: [] };
  const by = shortDate(nextWorkingDay(now));
  const sign = f.me ? `\n\nThanks,\n${f.me}` : "\n\nThanks";
  const items = [...f.items.values()].map((it): FollowItem => {
    const hi = `Hi ${firstName(it.contact) || "there"},`;
    if (it.message) {
      const subject = /^re:/i.test(it.message.subject) ? it.message.subject : `Re: ${it.message.subject}`;
      return { ...it, subject: capWords(subject, 8), body: `${hi}\n\nFollowing up on my email of ${longDate(it.lastContact)} about ${it.message.subject.replace(/^re:\s*/i, "")}. Could you let me know where things stand by ${by}?${sign}` };
    }
    return { ...it, subject: capWords(`Update on ${it.flag.title}`, 8), body: `${hi}\n\nA quick check on "${it.flag.title}", last updated on ${longDate(it.lastContact)}. Could you send me an update on where it stands by ${by}?${sign}` };
  });
  return { summary: `${plural(items.length, "item has", "items have")} gone quiet; a draft for each is below.`, items };
}

export function checkFollowUps(v: unknown, f: FollowFacts): FollowResult {
  const o = obj(v);
  const items: FollowItem[] = [];
  for (const x of arr(o.items)) {
    const r = obj(x);
    const base = f.items.get(str(r.ref).toUpperCase());
    if (!base || items.some((i) => i.ref === base.ref)) continue;
    const body = String(r.body ?? "").trim();
    if (!body) continue;
    // The address is always the stored one: the model may not invent or alter it.
    items.push({ ...base, subject: capWords(str(r.subject, 120), 10), body: capKeep(body, 80) });
    if (items.length >= 10) break;
  }
  if (f.items.size && !items.length) throw new Error("Madeline's drafts didn't match your follow-ups. Try again.");
  if (!f.items.size) return { summary: "Nothing has gone quiet.", items: [] };
  return { summary: str(o.summary, 300) || `${plural(items.length, "item has", "items have")} gone quiet; a draft for each is below.`, items };
}
