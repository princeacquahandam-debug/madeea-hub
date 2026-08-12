/**
 * A small, deliberate subset of RFC 5545 recurrence.
 *
 * There is no rrule library in this project and adding one to schedule "every
 * Monday" is not a trade worth making. What IS worth doing is storing the
 * standard string, so the day a real library is warranted it reads the existing
 * rows without a data migration.
 *
 * ── Supported ─────────────────────────────────────────────────────────────
 *   FREQ=DAILY   [;INTERVAL=n]
 *   FREQ=WEEKLY  [;INTERVAL=n][;BYDAY=MO,TU,...]
 *   FREQ=MONTHLY [;INTERVAL=n][;BYMONTHDAY=n]
 *
 * Not supported, and the UI does not offer them: BYSETPOS, BYMONTH, COUNT,
 * UNTIL, yearly, "last Friday of the month". If one of those turns up in the
 * data it is treated as unparseable and reported rather than guessed at.
 *
 * ── Why dates and not timestamps ──────────────────────────────────────────
 * Occurrences are DATES. A routine says "this is due on Monday", not "at
 * 09:00:00+08". That sidesteps the whole DST problem. There is no hour to
 * shift, and matches how the board works, where a task has a due date.
 */

export type Freq = "DAILY" | "WEEKLY" | "MONTHLY";

export interface Recurrence {
  freq: Freq;
  interval: number;
  /** 0=Sunday … 6=Saturday. WEEKLY only. */
  byDay: number[];
  /** 1–31. MONTHLY only. */
  byMonthDay?: number;
}

const DAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;
export const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function toRRule(r: Recurrence): string {
  const parts = [`FREQ=${r.freq}`];
  if (r.interval > 1) parts.push(`INTERVAL=${r.interval}`);
  if (r.freq === "WEEKLY" && r.byDay.length) {
    parts.push(`BYDAY=${[...r.byDay].sort((a, b) => a - b).map((d) => DAY_CODES[d]).join(",")}`);
  }
  if (r.freq === "MONTHLY" && r.byMonthDay) parts.push(`BYMONTHDAY=${r.byMonthDay}`);
  return parts.join(";");
}

/** Null when the rule uses anything outside the subset above. */
export function parseRRule(rule: string): Recurrence | null {
  const bits = new Map<string, string>();
  for (const part of rule.split(";")) {
    const [k, v] = part.split("=");
    if (k && v) bits.set(k.toUpperCase().trim(), v.toUpperCase().trim());
  }
  const freq = bits.get("FREQ");
  if (freq !== "DAILY" && freq !== "WEEKLY" && freq !== "MONTHLY") return null;
  // Anything we do not implement must fail loudly rather than be ignored,
  // silently dropping UNTIL would run a routine forever.
  for (const k of bits.keys()) {
    if (!["FREQ", "INTERVAL", "BYDAY", "BYMONTHDAY"].includes(k)) return null;
  }
  const interval = Math.max(1, Number(bits.get("INTERVAL") ?? 1) || 1);
  const byDay = (bits.get("BYDAY") ?? "")
    .split(",")
    .map((c) => DAY_CODES.indexOf(c.trim() as (typeof DAY_CODES)[number]))
    .filter((i) => i >= 0);
  const byMonthDay = bits.get("BYMONTHDAY") ? Number(bits.get("BYMONTHDAY")) : undefined;
  return { freq, interval, byDay, byMonthDay };
}

/** YYYY-MM-DD, built from local parts so no timezone can shift the day. */
export function isoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * The next `count` occurrences on or after `from`.
 *
 * Walks day by day. That is not clever, and for a horizon of a handful of
 * occurrences it does not need to be, a WEEKLY rule scans at most a few dozen
 * days, and the alternative is date arithmetic with an off-by-one in every
 * branch. Capped so a rule that never matches cannot spin.
 */
export function nextOccurrences(rule: string, from: Date, count = 5): string[] {
  const r = parseRRule(rule);
  if (!r) return [];

  const out: string[] = [];
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const anchor = new Date(cursor);
  const MAX_DAYS = 366 * 3;

  for (let i = 0; i < MAX_DAYS && out.length < count; i++) {
    let hit = false;

    if (r.freq === "DAILY") {
      const days = Math.round((cursor.getTime() - anchor.getTime()) / 864e5);
      hit = days % r.interval === 0;
    } else if (r.freq === "WEEKLY") {
      const wanted = r.byDay.length ? r.byDay : [anchor.getDay()];
      if (wanted.includes(cursor.getDay())) {
        // Whole weeks since the anchor's week, so INTERVAL=2 means every other
        // week rather than every other matching day.
        const weeks = Math.floor((cursor.getTime() - startOfWeek(anchor).getTime()) / (7 * 864e5));
        hit = weeks % r.interval === 0;
      }
    } else {
      const wantDay = r.byMonthDay ?? anchor.getDate();
      const months = (cursor.getFullYear() - anchor.getFullYear()) * 12 + (cursor.getMonth() - anchor.getMonth());
      // Clamp to the month's length, so BYMONTHDAY=31 still fires in February
      // instead of skipping the month entirely.
      const lastDay = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
      hit = months % r.interval === 0 && cursor.getDate() === Math.min(wantDay, lastDay);
    }

    if (hit) out.push(isoDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return out;
}

function startOfWeek(d: Date): Date {
  const s = new Date(d);
  s.setDate(s.getDate() - s.getDay());
  return s;
}

/** "Every Monday and Wednesday", the rule as a person would say it. */
export function describe(rule: string): string {
  const r = parseRRule(rule);
  if (!r) return "Custom schedule";
  const every = r.interval > 1 ? `Every ${r.interval} ` : "Every ";

  if (r.freq === "DAILY") return r.interval > 1 ? `${every}days` : "Every day";
  if (r.freq === "WEEKLY") {
    if (!r.byDay.length) return r.interval > 1 ? `${every}weeks` : "Every week";
    const names = [...r.byDay].sort((a, b) => a - b).map((d) => DAY_LABELS[d]);
    const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
    return `${r.interval > 1 ? `${every}weeks on ` : "Every "}${list}`;
  }
  const d = r.byMonthDay;
  return `${r.interval > 1 ? `${every}months` : "Every month"}${d ? ` on the ${ordinal(d)}` : ""}`;
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}
