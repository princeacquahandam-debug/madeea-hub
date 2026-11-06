import type { Client, Message, Task } from "@/types/db";
import { arr, lines, obj, str } from "@/lib/quickAi";
import { clientForMessage } from "@/lib/clientMatch";
import { decodeEntities } from "@/lib/threads";

/**
 * The three ✦ actions on the Inbox (Abder's "AI quick actions and cost" deck,
 * 6 Nov 2026): Summarize unread, Draft replies, Find action items.
 *
 * They read only what is in view (the tab, source, client and search filters
 * the page already applied), so the answer matches the list beside it. Email
 * text goes to the model; analytics only ever get counts (rule 5 of the deck's
 * privacy note). Nothing is sent or created without a click.
 */

const pad = (n: number) => String(n).padStart(2, "0");
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const words = (v: unknown, n: number) => str(v).split(" ").filter(Boolean).slice(0, n).join(" ");
const firstName = (name: string | null | undefined) => (name ?? "").trim().split(/\s+/)[0] ?? "";
const clean = (v: string | null | undefined, max: number) => decodeEntities(String(v ?? "")).replace(/\s+/g, " ").trim().slice(0, max);

/** Cut text at `n` words, keeping its line breaks. */
export function capKeep(s: string, n: number): string {
  const re = /\S+/g;
  let count = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (++count === n) {
      const end = m.index + m[0].length;
      return end < s.trimEnd().length ? s.slice(0, end).trimEnd() + "…" : s.trim();
    }
  }
  return s.trim();
}

/**
 * Newsletters and automated mail are skipped (deck, slide on Summarize
 * unread). `is_bulk` is set by the sync from List-Unsubscribe / Precedence
 * headers; the sender pattern catches what slips through.
 */
const AUTOMATED_SENDER = /(^|[^a-z])(no-?reply|do-?not-?reply|notifications?|mailer-daemon|newsletters?|digest|alerts?|bounces?|updates)([^a-z]|$)/i;
export const isAutomated = (m: Message) => m.is_bulk === true || AUTOMATED_SENDER.test((m.sender_email ?? "").split("@")[0] ?? "");

/** Same rule as the Inbox list's bold rows. */
export const isUnread = (m: Message) =>
  m.direction !== "outbound" && (m.is_read === undefined ? !m.first_reply_at : !m.is_read);

/** Mail can be answered by email from here; chat channels have their own reply box. */
export const isEmailMessage = (m: Message) => !m.source || ["gmail", "outlook", "manual"].includes(m.source);

/** Waiting on us: incoming, triaged as needing a reply, not answered. */
export const needsReply = (m: Message) =>
  m.direction !== "outbound" && !m.first_reply_at && m.category !== "archive" && !isAutomated(m)
  && (m.category === "urgent" || m.category === "reply");

const ageLabel = (iso: string | null, now: Date) => {
  const t = Date.parse(iso ?? "");
  if (!Number.isFinite(t)) return "unknown";
  const h = Math.max(0, Math.round((now.getTime() - t) / 3_600_000));
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)} days ago`;
};

function messageLine(ref: string, m: Message, now: Date, body = 600): string {
  return [
    ref,
    `from: ${clean(m.sender_name, 60)}${m.sender_email ? ` <${m.sender_email}>` : ""}`,
    `subject: "${clean(m.subject, 120)}"`,
    `received: ${m.received_at?.slice(0, 10) ?? "unknown"} (${ageLabel(m.received_at, now)})`,
    `triage: ${m.category}`,
    `answered: ${m.first_reply_at ? "yes" : "no"}`,
    `body: "${clean(m.body || m.preview, body)}"`,
  ].join(" | ");
}

/* ─────────────────────────── Summarize unread ─────────────────────────── */

export interface SummaryRow { message: Message; gist: string; needsReply: boolean }
export interface SummaryResult { summary: string; rows: SummaryRow[] }
export interface SummaryFacts { inputs: Record<string, string>; refs: Map<string, Message>; unread: number; skipped: number }

export function summaryFacts(inView: Message[], now: Date): SummaryFacts {
  // The view decides (Done included): the card must agree with the bold rows beside it.
  const unread = inView.filter(isUnread);
  const real = unread.filter((m) => !isAutomated(m));
  // Waiting longest first, so the 20 sent are the ones that matter.
  const sent = [...real].sort((a, b) => Number(needsReply(b)) - Number(needsReply(a)) || Date.parse(a.received_at ?? "") - Date.parse(b.received_at ?? "")).slice(0, 20);
  const refs = new Map(sent.map((m, i) => [`M${i + 1}`, m]));
  return {
    inputs: {
      "Unread count": String(real.length),
      "Unread messages": refs.size ? lines([...refs].map(([r, m]) => messageLine(r, m, now)), 12000) : "none",
      ...(real.length > sent.length ? { Note: `${real.length - sent.length} more unread not listed.` } : {}),
    },
    refs, unread: real.length, skipped: unread.length - real.length,
  };
}

const firstSentence = (s: string) => (s.match(/[^.!?]+[.!?]?/)?.[0] ?? s).trim();

export function demoSummary(f: SummaryFacts): SummaryResult {
  if (!f.unread) return { summary: "No unread messages.", rows: [] };
  const all = [...f.refs.values()];
  const reply = all.filter((m) => needsReply(m) || /\?/.test(m.body || m.preview || ""));
  const rows = all.slice(0, 5).map((m) => ({
    message: m,
    gist: words(firstSentence(clean(m.body || m.preview || m.subject, 300)), 15),
    needsReply: reply.includes(m),
  })).sort((a, b) => Number(b.needsReply) - Number(a.needsReply));
  return { summary: `${f.unread} unread, ${reply.length} need a reply.`, rows };
}

export function checkSummary(v: unknown, f: SummaryFacts): SummaryResult {
  const o = obj(v);
  const rows: SummaryRow[] = [];
  for (const x of arr(o.rows)) {
    const r = obj(x);
    const m = f.refs.get(str(r.ref).toUpperCase());
    if (!m || rows.some((y) => y.message.id === m.id)) continue;
    rows.push({ message: m, gist: words(r.gist, 16) || words(m.subject, 12), needsReply: r.needs_reply === true });
    if (rows.length >= 5) break;
  }
  if (!f.unread) return { summary: "No unread messages.", rows: [] };
  if (!rows.length) throw new Error("Madeline's summary didn't match your messages. Try again.");
  rows.sort((a, b) => Number(b.needsReply) - Number(a.needsReply));
  // The unread count is ours; the sentence is kept only if it repeats it.
  const s = str(o.summary, 200);
  const summary = s.startsWith(`${f.unread} unread`) ? s : `${f.unread} unread, ${rows.filter((r) => r.needsReply).length} need a reply.`;
  return { summary, rows };
}

/* ─────────────────────────── Draft replies ─────────────────────────── */

export interface ReplyItem { ref: string; message: Message; ask: string; draft: string }
export interface ReplyFacts { inputs: Record<string, string>; refs: Map<string, Message> }

export function replyCandidates(inView: Message[]): Message[] {
  return inView
    .filter((m) => needsReply(m) && isEmailMessage(m))
    .sort((a, b) => Number(b.category === "urgent") - Number(a.category === "urgent") || Date.parse(a.received_at ?? "") - Date.parse(b.received_at ?? ""))
    .slice(0, 5);
}

export function replyFacts(opts: {
  candidates: Message[]; all: Message[]; myName: string; now: Date;
  /** For "Shorter" / "More formal" on one item. */
  instruction?: { ref: string; text: string; draft: string };
}): ReplyFacts {
  const refs = new Map(opts.candidates.map((m, i) => [`M${i + 1}`, m]));
  const only = opts.instruction ? new Map([[opts.instruction.ref, refs.get(opts.instruction.ref)!]]) : refs;
  const thread = (m: Message) => opts.all
    .filter((x) => x.id !== m.id && m.thread_id && x.thread_id === m.thread_id)
    .sort((a, b) => Date.parse(a.received_at ?? "") - Date.parse(b.received_at ?? ""))
    .slice(-3)
    .map((x) => `    earlier, ${x.direction === "outbound" ? "from you" : `from ${clean(x.sender_name, 40)}`} on ${x.received_at?.slice(0, 10) ?? "?"}: "${clean(x.body || x.preview, 240)}"`);
  // A couple of the user's own sent messages, for tone.
  const mine = opts.all
    .filter((x) => x.direction === "outbound" && (x.body || x.preview))
    .sort((a, b) => Date.parse(b.received_at ?? "") - Date.parse(a.received_at ?? ""))
    .slice(0, 2)
    .map((x) => `"${clean(x.body || x.preview, 400)}"`);
  return {
    inputs: {
      "Your name": opts.myName || "not given",
      "Messages that need a reply": lines([...only].map(([r, m]) => [messageLine(r, m, opts.now), ...thread(m)].join("\n")), 12000),
      "Your past replies (for tone)": mine.length ? lines(mine) : "none available",
      ...(opts.instruction ? { Instruction: opts.instruction.text, "Current draft": opts.instruction.draft } : {}),
    },
    refs: only,
  };
}

export function demoReplies(f: ReplyFacts, myName: string): ReplyItem[] {
  const me = firstName(myName);
  return [...f.refs].map(([ref, m]) => {
    const text = clean(m.body || m.preview, 400);
    const q = text.match(/[^.!?]*\?/)?.[0]?.trim();
    const ask = words(q ?? firstSentence(text), 14) || `Reply on ${clean(m.subject, 60)}`;
    const answer = q
      ? `Thanks for asking. I'm checking now and will come back to you on this by [TBC].`
      : `Thanks for this; noted. I'll pick it up and let you know once it's done.`;
    return { ref, message: m, ask, draft: `Hi ${firstName(m.sender_name) || "there"},\n\n${answer}${me ? `\n\nBest,\n${me}` : ""}` };
  });
}

/** Rules for the two rewrite buttons in demo mode. */
export function demoRewrite(draft: string, how: "Shorter" | "More formal", m: Message): string {
  if (how === "Shorter") {
    // Keep the greeting and sign-off; cut the middle to its first sentence.
    const parts = draft.split(/\n{2,}/);
    if (parts.length < 3) return firstSentence(draft) || draft;
    return [parts[0], firstSentence(parts.slice(1, -1).join(" ")), parts[parts.length - 1]].join("\n\n");
  }
  return draft
    .replace(/^Hi\s+([^,\n]+),/, `Dear ${clean(m.sender_name, 60) || "$1"},`)
    .replace(/\bThanks\b/, "Thank you")
    .replace(/\bI'm\b/g, "I am").replace(/\bI'll\b/g, "I will").replace(/\bit's\b/g, "it is")
    .replace(/\n\nBest,/, "\n\nKind regards,");
}

export function checkReplies(v: unknown, f: ReplyFacts): ReplyItem[] {
  const o = obj(v);
  const items: ReplyItem[] = [];
  for (const x of arr(o.items)) {
    const r = obj(x);
    const ref = str(r.ref).toUpperCase();
    const m = f.refs.get(ref);
    const draft = String(r.draft ?? "").trim();
    if (!m || !draft || items.some((i) => i.ref === ref)) continue;
    items.push({ ref, message: m, ask: words(r.ask, 20), draft: capKeep(draft, 100) });
    if (items.length >= 5) break;
  }
  if (f.refs.size && !items.length) throw new Error("Madeline's drafts didn't match your messages. Try again.");
  return items;
}

/* ─────────────────────────── Find action items ─────────────────────────── */

export interface ProposedTask { ref: string; message: Message; title: string; client: Client | null; due: string | null }
export interface ActionFacts { inputs: Record<string, string>; refs: Map<string, Message>; existing: string[] }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
/** Already a task if the titles match or one contains the other. */
const duplicate = (title: string, existing: string[]) => {
  const n = norm(title);
  return existing.some((e) => { const x = norm(e); return x === n || (x.length > 12 && n.includes(x)) || (n.length > 12 && x.includes(n)); });
};

export function actionFacts(opts: { inView: Message[]; tasks: Task[]; clients: Client[]; now: Date }): ActionFacts {
  const msgs = opts.inView
    // Whatever tab is open, Done included: the view is the scope (deck rule 6).
    .filter((m) => m.direction !== "outbound" && !isAutomated(m))
    .sort((a, b) => Date.parse(b.received_at ?? "") - Date.parse(a.received_at ?? ""))
    .slice(0, 20);
  const refs = new Map(msgs.map((m, i) => [`M${i + 1}`, m]));
  const existing = opts.tasks.filter((t) => t.status !== "done").map((t) => t.title);
  return {
    inputs: {
      Today: `${dayKey(opts.now)} (${opts.now.toLocaleDateString("en-GB", { weekday: "long" })})`,
      Messages: refs.size ? lines([...refs].map(([r, m]) => messageLine(r, m, opts.now, 700)), 12000) : "none",
      "Existing tasks (skip anything already here)": existing.length ? lines(existing.slice(0, 60).map((t) => `- ${t}`), 3000) : "none",
      Clients: opts.clients.map((c) => c.name).join(", ") || "none",
    },
    refs, existing,
  };
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
/** A date the email itself states ("by Friday", "before 14 Nov", "2026-11-20"), resolved from when it arrived. */
function statedDue(text: string, received: Date): string | null {
  const iso = text.match(/\b(20\d\d-\d\d-\d\d)\b/)?.[1];
  if (iso) return iso;
  const wd = text.toLowerCase().match(/\b(?:by|before|on|until)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/)?.[1];
  if (wd) {
    const d = new Date(received);
    const diff = (WEEKDAYS.indexOf(wd) - d.getDay() + 7) % 7 || 7;
    d.setDate(d.getDate() + diff);
    return dayKey(d);
  }
  return null;
}

const REQUEST = /^(?:hi[^,]*,\s*)?(?:can|could|would|will) (?:you|we)(?: please)?\s+|^please\s+|^(?:i|we) need you to\s+|^need you to\s+/i;
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Rules in demo: a request ("can you…", "please…") or a question becomes a task. */
export function demoActions(f: ActionFacts, clients: Client[]): ProposedTask[] {
  const out: ProposedTask[] = [];
  for (const [ref, m] of f.refs) {
    const text = clean(m.body || m.preview, 600);
    for (const s of text.match(/[^.!?]+[.!?]?/g) ?? []) {
      const sentence = s.trim();
      let title = "";
      if (REQUEST.test(sentence)) title = capital(sentence.replace(REQUEST, "").replace(/[?.!]+$/, ""));
      else if (sentence.endsWith("?")) title = `Reply to ${firstName(m.sender_name) || "the sender"}: ${sentence.replace(/\?$/, "")}`;
      if (!title) continue;
      title = words(title, 10);
      if (duplicate(title, f.existing) || out.some((o) => norm(o.title) === norm(title))) continue;
      const received = m.received_at ? new Date(m.received_at) : new Date();
      out.push({ ref, message: m, title, client: clientForMessage(m, clients), due: statedDue(sentence, received) });
      break; // one task per email keeps the list to what matters
    }
    if (out.length >= 10) break;
  }
  return out;
}

export function checkActions(v: unknown, f: ActionFacts, clients: Client[]): ProposedTask[] {
  const o = obj(v);
  const out: ProposedTask[] = [];
  for (const x of arr(o.tasks)) {
    const r = obj(x);
    const m = f.refs.get(str(r.ref).toUpperCase());
    const title = capital(words(r.title, 12).replace(/[.]+$/, ""));
    if (!m || !title || duplicate(title, f.existing) || out.some((p) => norm(p.title) === norm(title))) continue;
    const cname = str(r.client).toLowerCase();
    // Only a client from the list; otherwise the email's own match, if any.
    const client = clients.find((c) => c.name.toLowerCase() === cname) ?? (cname ? null : clientForMessage(m, clients));
    const due = /^\d{4}-\d{2}-\d{2}$/.test(str(r.due)) && Number.isFinite(Date.parse(str(r.due))) ? str(r.due) : null;
    out.push({ ref: str(r.ref).toUpperCase(), message: m, title, client, due });
    if (out.length >= 10) break;
  }
  return out;
}

