/**
 * Email Helper — context assembly for a grounded reply.
 *
 * The Communication Center already drafts replies, but it sends the model three
 * fields: sender, subject, body. That produces a competent generic email, which is
 * exactly the problem — it reads like it was written by someone who has never met
 * the client.
 *
 * This file assembles what the app already knows and the draft was missing:
 *
 *   tone & preferences   the Vault records how each client likes to be written to.
 *                        Ignoring it while the data sits one table away is the
 *                        single biggest quality gap in the current draft.
 *   thread history       what was already said, so the reply doesn't repeat it or
 *                        contradict a commitment we made two emails ago.
 *   open items           what we owe them, so "I'll chase that" can name the thing.
 *   lateness             whether we are past the agreed response time. A reply that
 *                        is four days late and opens "Hope you're well!" is worse
 *                        than no reply. The draft has to know.
 *
 * Pure and synchronous, like lib/meetingPrep.ts. Only its output reaches the model,
 * so nothing leaves the browser that isn't already on screen.
 */
import type { Client, Message, Task } from "@/types/db";
import type { SlaConfig } from "@/store/slaSettings";
import { formatDuration, dayLength, thresholdsFor, waitingHours } from "@/lib/sla";
import { memoryPromptLines, recall, type MemoryEntry, type Recalled } from "@/lib/memory";

const MAX_THREAD = 6;
const MAX_OPEN_ITEMS = 6;
const BODY_CHARS = 1500;

/** What the EA wants this reply to do. Changes the whole shape of the email. */
export type ReplyIntent =
  | "Reply"
  | "Acknowledge & buy time"
  | "Decline politely"
  | "Reschedule"
  | "Chase for a response"
  | "Confirm & close out";

export const REPLY_INTENTS: ReplyIntent[] = [
  "Reply",
  "Acknowledge & buy time",
  "Decline politely",
  "Reschedule",
  "Chase for a response",
  "Confirm & close out",
];

export const REPLY_LENGTHS = ["Two lines", "Short", "Standard", "Detailed"] as const;
export type ReplyLength = (typeof REPLY_LENGTHS)[number];

export interface ThreadEntry {
  who: string;
  direction: "inbound" | "outbound";
  when: string;
  subject: string;
  excerpt: string;
}

export interface Lateness {
  /** Null when this isn't an inbound message we owe a reply to. */
  waitingLabel: string | null;
  breached: boolean;
  /** Plain-language instruction for the draft. Null when we're not late. */
  instruction: string | null;
}

export interface EmailContext {
  message: { from: string; subject: string; body: string; when: string };
  client: {
    name: string;
    title: string;
    company: string;
    tone: string;
    preferred_channel: string;
    preferences_notes: string;
    tags: string[];
  } | null;
  thread: ThreadEntry[];
  openItems: { title: string; due: string; status: string }[];
  lateness: Lateness;
  /** Curated facts about this client (lib/memory.ts). Empty when none recorded. */
  memories: Recalled[];
}

const relative = (iso: string | null | undefined): string => {
  if (!iso) return "recently";
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
};

const excerpt = (text: string, chars = 200): string => {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  return flat.length > chars ? `${flat.slice(0, chars)}…` : flat;
};

export interface EmailContextSources {
  message: Message;
  clients: Client[];
  messages: Message[];
  tasks: Task[];
  cfg: SlaConfig;
  /** Optional so existing callers and tests don't have to supply it. */
  memories?: MemoryEntry[];
}

export function assembleEmailContext(
  { message, clients, messages, tasks, cfg, memories = [] }: EmailContextSources,
  now = new Date(),
): EmailContext {
  const client =
    clients.find((c) => c.id === message.client_id) ??
    clients.find((c) => c.name === message.client_name) ??
    null;

  // Prefer the real thread id. Falling back to "everything from this client" is
  // deliberately second choice — it's a wider net and can pull in unrelated
  // subjects, so it only runs when the sync didn't give us a thread.
  const sameThread = message.thread_id
    ? messages.filter((m) => m.thread_id === message.thread_id && m.id !== message.id)
    : client
      ? messages.filter(
          (m) => m.id !== message.id && (m.client_id === client.id || m.client_name === client.name),
        )
      : [];

  const thread: ThreadEntry[] = sameThread
    .filter((m) => m.received_at)
    .sort((a, b) => new Date(b.received_at!).getTime() - new Date(a.received_at!).getTime())
    .slice(0, MAX_THREAD)
    .map((m) => ({
      who: m.direction === "outbound" ? "Us" : m.sender_name,
      direction: m.direction ?? "inbound",
      when: relative(m.received_at),
      subject: m.subject || "(no subject)",
      excerpt: excerpt(m.body || m.preview),
    }));

  const openItems = (
    client
      ? tasks.filter(
          (t) => t.status !== "done" && (t.client_id === client.id || t.client_name === client.name),
        )
      : []
  )
    .slice(0, MAX_OPEN_ITEMS)
    .map((t) => ({ title: t.title, due: t.due_label || "No due date", status: t.status }));

  return {
    message: {
      from: message.sender_name,
      subject: message.subject || "(no subject)",
      body: excerpt(message.body || message.preview, BODY_CHARS),
      when: relative(message.received_at),
    },
    client: client
      ? {
          name: client.name,
          title: client.title,
          company: client.company,
          tone: client.tone,
          preferred_channel: client.preferred_channel,
          preferences_notes: client.preferences_notes,
          tags: client.tags ?? [],
        }
      : null,
    thread,
    openItems,
    lateness: assessLateness(message, client, cfg, now),
    // Recall is scoped to this client, so one client's preferences can never leak
    // into another's draft. The subject and body are the match text.
    memories: recall(memories, {
      clientId: client?.id ?? null,
      text: `${message.subject} ${message.body}`,
      limit: 5,
    }),
  };
}

/**
 * How late we are, and what the draft should do about it.
 *
 * Three bands rather than a boolean, because the right opening line differs: on
 * time needs no reference to timing at all, mildly late warrants a light
 * acknowledgement, and a breach needs a real apology up front. Getting this wrong
 * in either direction is conspicuous — apologising for a same-day reply looks
 * anxious; breezing past a four-day delay looks careless.
 */
export function assessLateness(
  message: Message,
  client: Client | null,
  cfg: SlaConfig,
  now = new Date(),
): Lateness {
  if (message.direction === "outbound" || message.first_reply_at) {
    return { waitingLabel: null, breached: false, instruction: null };
  }
  const hours = waitingHours(message, cfg, now);
  if (hours === null) return { waitingLabel: null, breached: false, instruction: null };

  const t = thresholdsFor(client, cfg);
  const label = formatDuration(hours, dayLength(cfg));

  if (hours > t.risk) {
    return {
      waitingLabel: label,
      breached: true,
      instruction: `This reply is ${label} late against the agreed response time. Open with a short, genuine apology for the delay — one sentence, no excuses, then get straight to the substance.`,
    };
  }
  if (hours > t.ok) {
    return {
      waitingLabel: label,
      breached: false,
      instruction: `They have been waiting ${label}. Acknowledge the wait briefly and lightly ("sorry for the slow reply") — do not over-apologise.`,
    };
  }
  return { waitingLabel: label, breached: false, instruction: null };
}

/** True when there's nothing beyond the message itself — no client, no history. */
export function isThinEmailContext(ctx: EmailContext): boolean {
  return !ctx.client && !ctx.thread.length && !ctx.openItems.length;
}

export interface ReplyOptions {
  intent: ReplyIntent;
  length: ReplyLength;
  /** Anything the EA wants included that isn't derivable from the data. */
  points: string;
  /** Overrides the client's recorded tone when set. */
  toneOverride: string;
}

export const EMPTY_REPLY_OPTIONS: ReplyOptions = {
  intent: "Reply",
  length: "Standard",
  points: "",
  toneOverride: "",
};

/** Flattens the context into the `inputs` map the generate function accepts. */
export function replyPromptInputs(ctx: EmailContext, opts: ReplyOptions): Record<string, string> {
  const thread = ctx.thread.length
    ? ctx.thread
        .map((t) => `- ${t.who} (${t.direction}, ${t.when}) re "${t.subject}": ${t.excerpt}`)
        .join("\n")
    : "(no earlier messages on this thread)";

  const open = ctx.openItems.length
    ? ctx.openItems.map((o) => `- ${o.title} (${o.status}, due ${o.due})`).join("\n")
    : "(none)";

  return {
    intent: opts.intent,
    length: opts.length,
    reply_to_sender: ctx.message.from,
    reply_to_subject: ctx.message.subject,
    reply_to_body: ctx.message.body,
    received: ctx.message.when,
    client: ctx.client
      ? `${ctx.client.name} — ${ctx.client.title}, ${ctx.client.company}`
      : "(sender is not in the Client Vault — keep it professionally neutral)",
    tone: opts.toneOverride || ctx.client?.tone || "Professional",
    their_preferences: ctx.client?.preferences_notes || "(none recorded)",
    remembered_about_them: memoryPromptLines(ctx.memories),
    earlier_on_this_thread: thread,
    what_we_owe_them: open,
    timing_instruction: ctx.lateness.instruction ?? "Replied within the agreed time — do not mention timing at all.",
    extra_points_from_the_ea: opts.points || "(none)",
  };
}
