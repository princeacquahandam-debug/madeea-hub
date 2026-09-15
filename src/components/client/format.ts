/**
 * Formatting shared by the client-portal panes.
 *
 * Here rather than repeated in four files because the portal shows the same
 * duration in three places, and three copies of a rounding rule is three
 * chances for the Overview to say 2h 40m while Activity says 2h 39m for the
 * same day.
 */

/** Minutes as "2h 40m", or "40m" under the hour. Never "0h 40m". */
export function hm(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  return h ? `${h}h ${m % 60}m` : `${m}m`;
}

/**
 * A `date` column from Postgres, as a local Date.
 *
 * new Date("2025-09-14") parses as UTC MIDNIGHT, so anybody west of Greenwich
 * renders it as the 13th. Appending the time forces local parsing. work_date is
 * already the assistant's own working day (0027), so local is the right frame.
 */
export function dateOnly(workDate: string): Date {
  return new Date(`${workDate}T00:00:00`);
}

/** "Today" / "Yesterday" / "Mon 14 Sep" — a client reads their week, not dates. */
export function dayLabel(d: Date): string {
  const today = new Date();
  const diff = Math.round(
    (startOfDay(today).getTime() - startOfDay(d).getTime()) / 86_400_000,
  );
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** The local calendar day a timestamp falls on, as the key the panes group by. */
export function localDayKey(iso: string): string {
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** "09:02", in the reader's own zone. */
export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
