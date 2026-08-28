/**
 * The clock gates let through exactly who they should.
 *
 *   npm run check:gates
 *
 * WHY THIS EXISTS. A gate has two failure modes and they are not equal. Letting
 * somebody through who should have been stopped costs a missing report. Stopping
 * somebody who should have been let through costs an EA standing at the end of a
 * ten hour shift, having already filed their EOD, unable to clock out — and the
 * only way past it is the recorded exception, so the record then says they
 * skipped a report they did not skip.
 *
 * The second is the one worth testing hard, and it is the one that comes from
 * the details: a name spelled differently, a shift that crossed midnight, a
 * second session after lunch. All of them are here.
 */
process.env.TZ = "Asia/Manila";

import { focusForDay, eodForDay } from "../src/lib/clockGates.ts";

let failed = 0;
const check = (name, passed, detail = "") => {
  console.log(`  ${passed ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!passed) failed++;
};

console.log("\nClock gates\n");

const entry = (work_date, focus) => ({ id: `e-${work_date}-${focus ?? "x"}`, work_date, focus, started_at: "", ended_at: null });

// ── the focus, asked once a day ──────────────────────────────────────────
check("a day with no sessions has no focus",
  focusForDay([], "2026-08-27") === null);

check("a day whose only session recorded no focus has none",
  focusForDay([entry("2026-08-27", null)], "2026-08-27") === null);

check("the focus is found from the day's first session",
  focusForDay([entry("2026-08-27", "Inbox zero for Rowena")], "2026-08-27") === "Inbox zero for Rowena",
  "so clocking back in after lunch does not ask again");

check("yesterday's focus does not answer for today",
  focusForDay([entry("2026-08-26", "Yesterday's thing")], "2026-08-27") === null,
  "every day is asked its own question");

check("whitespace is not a focus",
  focusForDay([entry("2026-08-27", "   ")], "2026-08-27") === null,
  "or one space would satisfy the gate forever");

check("a later session's focus counts when the first had none",
  focusForDay([entry("2026-08-27", null), entry("2026-08-27", "Client migration")], "2026-08-27") === "Client migration");

// ── the EOD, at the end of the day it belongs to ─────────────────────────
const report = (over) => ({
  id: "r1", owner_id: "uid-fj", report_date: "2026-08-27",
  person: "FJ Caballes", done: [], blockers: [], plans: [], ...over,
});

const FJ = { name: "FJ Caballes", userId: "uid-fj" };

check("the report filed for that day is found",
  eodForDay([report()], FJ, "2026-08-27") !== null);

check("a report for another day is not",
  eodForDay([report({ report_date: "2026-08-26" })], FJ, "2026-08-27") === null);

check("somebody else's report is not",
  eodForDay([report({ owner_id: "uid-rio", person: "Rio Castillo" })], FJ, "2026-08-27") === null,
  "or one EA filing would let the whole team clock out");

/* The name history from EodReports, as a gate rather than as a duplicate row.
   This is the case that would strand somebody who HAD filed. */
check("a differently spelled name still matches",
  eodForDay([report({ owner_id: null, person: "fj caballes" })], { name: "FJ Caballes" }, "2026-08-27") !== null,
  "'fj caballes' against 'FJ Caballes'");

check("the account id matches even when the name does not",
  eodForDay([report({ person: "F.J. Caballes" })], { name: "FJ Caballes", userId: "uid-fj" }, "2026-08-27") !== null,
  "owner_id is the strong key");

check("an imported July row belonging to nobody does not match on id alone",
  eodForDay([report({ owner_id: null, person: "Someone Else" })], { userId: "uid-fj" }, "2026-08-27") === null);

/* Blocks rather than waves through. The way past a gate that is wrong about
   you is the recorded exception, not a hole that opens while identity loads. */
check("an unknown person matches nothing",
  eodForDay([report()], { name: null, userId: null }, "2026-08-27") === null,
  "identity not loaded yet blocks, it does not pass");

check("an empty name is not a wildcard",
  eodForDay([report({ owner_id: null, person: "" })], { name: "" }, "2026-08-27") === null);

/* ── The midnight shift ───────────────────────────────────────────────────
 * A shift started at 22:00 on the 27th and ending at 06:00 on the 28th carries
 * work_date 2026-08-27. The gate must ask for the 27th's report: the 28th's
 * cannot exist yet, and demanding it would make a night shift impossible to
 * close. This is the same day-boundary reasoning as lib/workday. */
{
  const nightShift = { work_date: "2026-08-27" };
  check("a shift crossing midnight is gated on the day it started",
    eodForDay([report({ report_date: "2026-08-27" })], FJ, nightShift.work_date) !== null,
    "clocking out at 06:00 on the 28th needs the 27th's report");
  check("and not on the calendar date it ends",
    eodForDay([report({ report_date: "2026-08-27" })], FJ, "2026-08-28") === null,
    "which is why the entry's work_date is what gets passed");
}

console.log(failed === 0 ? "\nGates are correct.\n" : `\n${failed} check(s) FAILED.\n`);
process.exit(failed ? 1 : 0);
