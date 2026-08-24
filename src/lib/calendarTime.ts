/**
 * Dates in the calendar's timezone, not the laptop's.
 *
 * WHY THIS FILE EXISTS. An event is stored as an instant, which is correct and
 * unambiguous. A calendar is not made of instants: it is made of days and rows,
 * and which day something falls on depends entirely on the zone you ask in.
 * The first version rendered with plain Date methods, which silently means "the
 * zone this browser happens to be set to". A team in Manila looking at a laptop
 * on Mountain time saw an 8pm meeting listed at 5am, and anything within eight
 * hours of midnight appeared on the wrong DAY.
 *
 * Google shows the calendar's own zone and labels it. So does this now.
 *
 * HOW. A day is a `YYYY-MM-DD` string, and arithmetic on days is done on a Date
 * anchored at UTC noon. Noon rather than midnight because adding days to a
 * midnight UTC date can cross a DST boundary and land on the previous day; noon
 * is twelve hours from either edge and cannot.
 */

export type DayKey = string; // YYYY-MM-DD

const partsCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const k = `${tz}|${JSON.stringify(opts)}`;
  let f = partsCache.get(k);
  if (!f) { f = new Intl.DateTimeFormat("en-US", { ...opts, timeZone: tz }); partsCache.set(k, f); }
  return f;
}

/** The wall-clock fields an instant has in a given zone. */
export function zoned(iso: string | Date, tz: string) {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const p = Object.fromEntries(
    fmt(tz, {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(d).map((x) => [x.type, x.value]),
  ) as Record<string, string>;
  // Hour comes back as "24" at midnight in some environments.
  const hour = Number(p.hour) % 24;
  return { year: +p.year, month: +p.month, day: +p.day, hour, minute: +p.minute };
}

export function dayKeyOf(iso: string | Date, tz: string): DayKey {
  const z = zoned(iso, tz);
  return `${z.year}-${String(z.month).padStart(2, "0")}-${String(z.day).padStart(2, "0")}`;
}

/** Minutes since midnight, in the calendar's zone. Drives every time grid. */
export function minutesOf(iso: string | Date, tz: string): number {
  const z = zoned(iso, tz);
  return z.hour * 60 + z.minute;
}

/** Today, as the calendar's zone sees it. Not as this machine sees it. */
export function todayKey(tz: string): DayKey {
  return dayKeyOf(new Date(), tz);
}

/** A day key to a Date anchored at UTC noon, safe for arithmetic. */
export function dayToDate(key: DayKey): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

export function dateToDay(d: Date): DayKey {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function addDays(key: DayKey, n: number): DayKey {
  const d = dayToDate(key);
  d.setUTCDate(d.getUTCDate() + n);
  return dateToDay(d);
}

export function addMonths(key: DayKey, n: number): DayKey {
  const d = dayToDate(key);
  const targetMonth = d.getUTCMonth() + n;
  const probe = new Date(Date.UTC(d.getUTCFullYear(), targetMonth, 1, 12));
  // Clamp: 31 January plus one month is the end of February, not 3 March.
  const lastDay = new Date(Date.UTC(probe.getUTCFullYear(), probe.getUTCMonth() + 1, 0, 12)).getUTCDate();
  probe.setUTCDate(Math.min(d.getUTCDate(), lastDay));
  return dateToDay(probe);
}

/** 0 for Sunday, matching the grid's first column. */
export const weekdayOf = (key: DayKey): number => dayToDate(key).getUTCDay();

export const startOfWeek = (key: DayKey): DayKey => addDays(key, -weekdayOf(key));
export const startOfMonthKey = (key: DayKey): DayKey => `${key.slice(0, 7)}-01`;

export function daysInMonth(key: DayKey): number {
  const d = dayToDate(key);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 12)).getUTCDate();
}

export function rangeOfDays(from: DayKey, count: number): DayKey[] {
  return Array.from({ length: count }, (_, i) => addDays(from, i));
}

/* Labels. All formatted from the UTC-noon anchor, so they never disagree with
   the key they came from. */
const labelFmt = (opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(undefined, { ...opts, timeZone: "UTC" });

export const dayLabel = (key: DayKey, opts: Intl.DateTimeFormatOptions) =>
  labelFmt(opts).format(dayToDate(key));

/** The instant a day starts and ends, in the calendar's zone, as ISO. */
export function dayBounds(key: DayKey, tz: string): { from: string; to: string } {
  // Find the offset at that date by comparing the same instant read both ways.
  const noonUtc = dayToDate(key);
  const z = zoned(noonUtc, tz);
  const asUtc = Date.UTC(z.year, z.month - 1, z.day, z.hour, z.minute);
  const offsetMs = asUtc - noonUtc.getTime();
  const [y, m, d] = key.split("-").map(Number);
  const startUtc = Date.UTC(y, m - 1, d, 0, 0, 0) - offsetMs;
  return {
    from: new Date(startUtc).toISOString(),
    to: new Date(startUtc + 24 * 3600_000 - 1).toISOString(),
  };
}

/** "GMT+08", the way Google labels the column. */
export function zoneLabel(tz: string, on: DayKey): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" })
    .formatToParts(dayToDate(on));
  return parts.find((p) => p.type === "timeZoneName")?.value ?? tz;
}

export function timeLabel(iso: string, tz: string): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: tz, hour: "numeric", minute: "2-digit",
  }).format(new Date(iso));
}

/** "5a", "1:30p". For grids too narrow to spend seven characters on a time. */
export function compactTime(iso: string, tz: string): string {
  const { hour, minute } = zoned(iso, tz);
  const suffix = hour < 12 ? "a" : "p";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return minute === 0 ? `${h12}${suffix}` : `${h12}:${String(minute).padStart(2, "0")}${suffix}`;
}
