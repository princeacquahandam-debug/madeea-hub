/**
 * Which day a moment belongs to, from where the person actually is.
 *
 * WHY THESE TWO LIVE TOGETHER, AND NOT IN hooks.ts. They are pure arithmetic
 * over dates, they are the arithmetic this app has now got wrong twice, and
 * hooks.ts cannot be imported by a test — it pulls in Supabase and React Query.
 * Here they can be checked directly (npm run check:schedule) in a fixed
 * timezone, which is the only way to see either bug: both are invisible in UTC
 * and wrong everywhere else.
 */

/**
 * The EA's own local date as YYYY-MM-DD.
 *
 * Not toISOString(), which shifts the day for anyone west of UTC, and an EA in
 * Manila finishing at 01:00 is still working the previous day.
 */
export function workDate(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/**
 * The two instants that bound one LOCAL day, as absolute UTC timestamps.
 *
 * WHY THIS IS NOT `${day}T00:00:00`. A timestamp string with no offset is not
 * an instant: it is a wall-clock reading, and the database resolves it in ITS
 * timezone, which is UTC. So asking a timestamptz column for
 * "2026-08-26T00:00:00" from Manila asks for 8am Manila, and the eight hours
 * before that — a shift worked from midnight to 8am — answer to the PREVIOUS
 * day's query instead. That is exactly how it looked on the Screenshots page:
 * work captured at 4am on the 26th could only be found by selecting the 25th.
 *
 * Building the bounds through Date() fixes it, because a date-time string with
 * no offset is parsed as LOCAL time, and toISOString() then states the instant
 * in the one form Postgres cannot misread.
 *
 * The end is midnight of the NEXT day, exclusive, rather than 23:59:59.999.
 * Days are not all 24 hours long — a DST transition makes one 23 and another 25
 * — and "the next day starts here" stays true through both, where "add
 * 86,399,999 milliseconds" does not.
 */
export function localDayRange(day: string): { from: string; to: string } {
  const start = new Date(`${day}T00:00:00`);
  const next = new Date(start);
  next.setDate(next.getDate() + 1);
  return { from: start.toISOString(), to: next.toISOString() };
}

/**
 * A wall-clock time on a date, in a named zone, as an absolute instant.
 *
 * WHY THIS IS NOT `new Date(`${date}T${hhmm}`)`. That reads the string in the
 * BROWSER's zone. An EA in Manila booking 09:30 into a calendar kept in London
 * would book 01:30, and the event would look perfectly normal in the response —
 * a confident ISO timestamp in the wrong zone books the middle of the night.
 *
 * The trick is to guess the instant as if the wall clock were UTC, ask the
 * target zone what wall clock that instant actually shows, and shift by the
 * difference. One round trip through Intl handles every offset and both DST
 * directions without a table of rules to maintain.
 *
 * Lifted out of components/calendar/PlanProposals when meeting prep started
 * booking events too. Two copies of a timezone conversion is two chances to fix
 * only one of them, and this file exists precisely because date arithmetic here
 * has been wrong in production twice.
 */
export function instantFor(date: string, hhmm: string, tz: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const [y, mo, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, m);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(guess));
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value])) as Record<string, string>;
  const asZone = Date.UTC(+p.year, +p.month - 1, +p.day, Number(p.hour) % 24, +p.minute);
  return new Date(guess - (asZone - guess)).toISOString();
}

/** `instantFor` plus a length in minutes, for booking a block of known duration. */
export function endInstant(startIso: string, minutes: number): string {
  return new Date(Date.parse(startIso) + minutes * 60_000).toISOString();
}
