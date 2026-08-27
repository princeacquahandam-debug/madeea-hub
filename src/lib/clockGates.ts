/**
 * The two rules that stand between an EA and their own clock.
 *
 *   Clocking IN  needs a focus for the day.
 *   Clocking OUT needs that day's EOD report.
 *
 * WHY THESE LIVE HERE. Both are one-line questions with several ways to be
 * subtly wrong, and every one of those ways is silent. A focus matched against
 * the wrong day lets a shift start with nothing recorded. An EOD matched
 * against the wrong spelling of a name tells somebody who has just filed their
 * report that they cannot go home. A gate is only ever noticed when it wrongly
 * lets somebody through, which is the worst possible moment to find out.
 *
 * Out here they are pure functions over arrays, and `npm run check:gates` runs
 * the edges past them: a second session on the same day, a shift crossing
 * midnight, two spellings of one person, the imported July reports that belong
 * to no account.
 *
 * ── NEITHER IS A SECURITY BOUNDARY, AND THAT IS DELIBERATE ────────────────
 * These gate the buttons, not the database. time_entries still accepts an
 * insert with no focus and an update with no report, because the alternative —
 * a trigger that refuses — strands somebody mid-shift the first time anything
 * else goes wrong, and a shift that cannot be closed is a wrong timesheet plus
 * a blocked clock-in the next morning.
 *
 * This is workflow, not access control. It is written down here so that nobody
 * later reads the gates as the second thing and relies on them for it.
 */
import type { EodReport, TimeEntry } from "@/types/db";

/** Who is asking. Either half identifies a person; both are checked. */
export interface Whoami {
  name?: string | null;
  userId?: string | null;
}

/**
 * The focus already recorded for a working day, or null if it has none yet.
 *
 * ONCE PER DAY, NOT ONCE PER SESSION. An EA who clocks out for lunch and back
 * in at one o'clock has already said what the day is for. Asking again teaches
 * people to type one character and move on, which collects worse than nothing:
 * a field full of "asdf" looks like compliance in the record.
 *
 * Whitespace is not an answer. A focus of " " would otherwise satisfy the gate
 * forever, because it is stored and non-null.
 */
export function focusForDay(entries: TimeEntry[], day: string): string | null {
  for (const e of entries) {
    if (e.work_date !== day) continue;
    const focus = e.focus?.trim();
    if (focus) return focus;
  }
  return null;
}

/**
 * That person's EOD for a working day, or null.
 *
 * MATCHED ON THE WORK DATE, NOT ON TODAY. A shift that starts at 22:00 and ends
 * at 06:00 belongs to the day it started (see lib/workday), so that is the
 * report it needs. Asking for the calendar date at the moment of clocking out
 * would demand a report for a day that has barely begun.
 *
 * MATCHED ON EITHER HALF OF AN IDENTITY. owner_id is the strong key and is
 * checked first. The name is checked too, and case-insensitively, for the
 * reason set out at length in pages/EodReports: "FJ Caballes" and "fj.caballes"
 * were one human filing under two spellings. Here that history has teeth — a
 * gate that misses the report refuses to let somebody go home.
 *
 * AN UNKNOWN PERSON MATCHES NOTHING, which blocks rather than waves through.
 * That is the safe direction: the way past a gate that is wrong about you is
 * the recorded exception, not a hole that opens whenever identity is slow to
 * load.
 */
export function eodForDay(reports: EodReport[], me: Whoami, day: string): EodReport | null {
  const name = (me.name ?? "").trim().toLowerCase();
  const uid = (me.userId ?? "").trim();
  if (!name && !uid) return null;

  return (
    reports.find((r) => {
      if (r.report_date !== day) return false;
      if (uid && r.owner_id === uid) return true;
      return Boolean(name) && (r.person ?? "").trim().toLowerCase() === name;
    }) ?? null
  );
}
