/**
 * Turning a spoken sentence into a task.
 *
 * Two halves, deliberately separated:
 *  - `localParse` is deterministic code. It resolves relative dates ("Friday",
 *    "next week") against the real system clock, matches client names against the
 *    real Client Vault, and reads priority words. It needs no network and cannot
 *    hallucinate.
 *  - `validateParsed` is the gate every model response passes through.
 *
 * The model is good at reading intent out of rambling speech and writing a clean
 * title. It is NOT trusted for date arithmetic — LLMs routinely get "what date is
 * next Friday" wrong, and a task silently due on the wrong day is worse than one
 * with no date at all. So when the transcript contains a relative date expression,
 * the locally-computed date wins. The model's date is only used when local parsing
 * finds nothing, and even then it must survive the sanity checks below.
 */
import type { Client, Priority } from "@/types/db";

export interface ParsedTask {
  title: string;
  /** "YYYY-MM-DD", or "" for no due date — same shape the Tasks form uses. */
  due: string;
  client_id: string | null;
  priority: Priority;
}

export interface ParseResult extends ParsedTask {
  source: "claude" | "local";
  /** Anything we overrode or dropped, surfaced to the user rather than hidden. */
  notes: string[];
}

const PRIORITIES: Priority[] = ["urgent", "high", "normal", "low"];
const MAX_TITLE = 200;
const MAX_HORIZON_DAYS = 365;

const iso = (d: Date): string => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const startOfDay = (d: Date): Date => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** Next occurrence of a weekday. "Friday" on a Friday means next Friday, not today. */
function nextWeekday(from: Date, target: number, forceNextWeek = false): Date {
  const d = startOfDay(from);
  let delta = (target - d.getDay() + 7) % 7;
  if (delta === 0) delta = 7;
  if (forceNextWeek && delta < 7) delta += 7;
  d.setDate(d.getDate() + delta);
  return d;
}

/** Resolve a relative date expression against the real clock. Null if none found. */
export function parseDate(text: string, now = new Date()): string | null {
  const t = text.toLowerCase();

  if (/\btoday\b|\btonight\b|\bthis afternoon\b|\bthis morning\b/.test(t)) return iso(startOfDay(now));
  if (/\btomorrow\b/.test(t)) {
    const d = startOfDay(now);
    d.setDate(d.getDate() + 1);
    return iso(d);
  }

  const inDays = /\bin (\d+|a|two|three|four|five|six|seven) (day|week)s?\b/.exec(t);
  if (inDays) {
    const words: Record<string, number> = { a: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };
    const n = words[inDays[1]] ?? parseInt(inDays[1], 10);
    if (Number.isFinite(n)) {
      const d = startOfDay(now);
      d.setDate(d.getDate() + n * (inDays[2] === "week" ? 7 : 1));
      return iso(d);
    }
  }

  // "next Friday" resolves a week further out than a bare "Friday".
  const weekdayMatch = /\b(next |this )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/.exec(t);
  if (weekdayMatch) {
    const idx = WEEKDAYS.indexOf(weekdayMatch[2]);
    return iso(nextWeekday(now, idx, weekdayMatch[1]?.trim() === "next"));
  }

  if (/\bnext week\b/.test(t)) return iso(nextWeekday(now, 1)); // Monday
  if (/\bend of (the )?week\b/.test(t)) return iso(nextWeekday(now, 5)); // Friday
  if (/\bnext month\b/.test(t)) {
    const d = startOfDay(now);
    d.setMonth(d.getMonth() + 1);
    return iso(d);
  }
  return null;
}

export function parsePriority(text: string): Priority {
  const t = text.toLowerCase();
  if (/\burgent\b|\basap\b|\bright away\b|\bimmediately\b|\bcritical\b|\bfirst thing\b/.test(t)) return "urgent";
  if (/\bimportant\b|\bhigh priority\b|\bpriority\b/.test(t)) return "high";
  if (/\bwhenever\b|\bno rush\b|\blow priority\b|\bwhen you get a chance\b|\bsometime\b/.test(t)) return "low";
  return "normal";
}

/** Match a spoken name to a real client. Never invents one. */
export function matchClient(text: string, clients: Client[]): Client | null {
  const t = text.toLowerCase();
  // Prefer the longest match, so "Priya Raman" beats a stray "Priya".
  const hits = clients
    .filter((c) => {
      const full = c.name.toLowerCase();
      const first = full.split(" ")[0];
      const company = (c.company ?? "").toLowerCase();
      return (
        (full && t.includes(full)) ||
        (first.length > 2 && new RegExp(`\\b${first}\\b`).test(t)) ||
        (company.length > 3 && t.includes(company))
      );
    })
    .sort((a, b) => b.name.length - a.name.length);
  return hits[0] ?? null;
}

const FILLERS = [
  /^(um|uh|ok|okay|so|right)[,\s]+/i,
  /^(hey )?(remind me to|reminder to|note to self,?|make a note to|add a task to|task to|i need to|don'?t forget to|remember to)\s+/i,
];

/**
 * Phrases that carry the date/priority — already captured as structured fields, so
 * leaving them in the title just duplicates them ("Send the pack by friday, it's
 * urgent" when due=Friday and priority=urgent are right there in the form).
 */
const META_PHRASES = [
  /\b(by|on|before|due|for)?\s*\b(today|tonight|tomorrow|this (morning|afternoon)|next week|next month|end of (the )?week|(next |this )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday))\b/gi,
  /\bin (\d+|a|two|three|four|five|six|seven) (day|week)s?\b/gi,
  /,?\s*\b(and )?(it'?s |it is |this is |that'?s )?(urgent|asap|critical|high priority|low priority|important|no rush|whenever|right away|immediately|first thing|when you get a chance)\b/gi,
];

/** Strip the "remind me to…" scaffolding and the date/priority chatter. */
export function cleanTitle(text: string): string {
  let s = text.trim();
  for (const f of FILLERS) s = s.replace(f, "");
  for (const m of META_PHRASES) s = s.replace(m, " ");
  s = s
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/[,;:\s]+$/, "")
    .replace(/^[,;:\s]+/, "")
    .trim();
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Full deterministic parse — the fallback, and the source of truth for dates. */
export function localParse(transcript: string, clients: Client[], now = new Date()): ParseResult {
  const client = matchClient(transcript, clients);
  // If the note was nothing but date/priority words, cleaning strips it to nothing —
  // keep the raw transcript rather than handing back an empty title.
  const title = cleanTitle(transcript) || transcript.trim();
  return {
    title: title.slice(0, MAX_TITLE),
    due: parseDate(transcript, now) ?? "",
    client_id: client?.id ?? null,
    priority: parsePriority(transcript),
    source: "local",
    notes: [],
  };
}

/** Whatever shape the model returns — assume nothing. */
export interface RawParsed {
  title?: unknown;
  due_date?: unknown;
  client_tag?: unknown;
  priority?: unknown;
}

/**
 * Gate the model's output. Anything unverifiable is dropped, not guessed at:
 * a bad date becomes no date, an unknown client becomes no client.
 */
export function validateParsed(
  raw: RawParsed,
  transcript: string,
  clients: Client[],
  now = new Date(),
): ParseResult {
  const local = localParse(transcript, clients, now);
  const notes: string[] = [];

  // --- title: fall back to the local clean-up if the model gave us nothing usable
  const title =
    typeof raw.title === "string" && raw.title.trim()
      ? raw.title.trim().slice(0, MAX_TITLE)
      : local.title;

  // --- date: local wins whenever the transcript actually contains a date phrase
  let due = "";
  const localDate = parseDate(transcript, now);
  if (localDate) {
    due = localDate;
    if (typeof raw.due_date === "string" && raw.due_date.slice(0, 10) !== localDate) {
      // Don't silently discard the disagreement — the user should know we overrode it.
      notes.push(`Used ${localDate} from "${transcript.match(/\b(today|tomorrow|next week|next month|end of (the )?week|(next |this )?(mon|tues|wednes|thurs|fri|satur|sun)day)\b/i)?.[0] ?? "the date you said"}" rather than the model's ${String(raw.due_date).slice(0, 10)}.`);
    }
  } else if (typeof raw.due_date === "string" && raw.due_date.trim()) {
    const candidate = raw.due_date.slice(0, 10);
    const d = new Date(`${candidate}T12:00:00`);
    const valid = /^\d{4}-\d{2}-\d{2}$/.test(candidate) && !Number.isNaN(d.getTime());
    const today = startOfDay(now);
    const horizon = new Date(today);
    horizon.setDate(horizon.getDate() + MAX_HORIZON_DAYS);

    if (!valid) {
      notes.push("Ignored an unreadable due date from the parser.");
    } else if (startOfDay(d) < today) {
      notes.push(`Ignored a due date in the past (${candidate}).`);
    } else if (d > horizon) {
      notes.push(`Ignored a due date over a year away (${candidate}).`);
    } else {
      due = candidate;
    }
  }

  // --- client: must resolve to a real Vault record, or it's dropped
  let client_id: string | null = local.client_id;
  if (!client_id && typeof raw.client_tag === "string" && raw.client_tag.trim()) {
    const matched = matchClient(raw.client_tag, clients);
    if (matched) client_id = matched.id;
    else notes.push(`No client named "${raw.client_tag}" in the Vault — left unassigned.`);
  }

  const priority = PRIORITIES.includes(raw.priority as Priority)
    ? (raw.priority as Priority)
    : local.priority;

  return { title, due, client_id, priority, source: "claude", notes };
}
