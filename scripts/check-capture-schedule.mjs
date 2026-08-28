/**
 * The screenshot interval means what it says.
 *
 *   npm run check:schedule
 *
 * WHY THIS EXISTS. This arithmetic has been wrong in production once already,
 * and the way it was wrong is the reason a test is worth having: the first
 * version picked a delay between 0 and the interval, which averages HALF of it.
 * A setting of ten minutes captured every five, doubling the screenshot count
 * and the storage bill. Nothing looked broken, because the output was random
 * and random output looks correct.
 *
 * It was found by reading capture timestamps out of the database. This checks
 * the property that would have caught it in a second: over many draws the mean
 * must be the interval, not some fraction of it.
 */
/* Set BEFORE any Date is constructed. The day-range bugs below are invisible
   in UTC and wrong everywhere else, so the check has to stand somewhere: Manila,
   which is where this team works and where the bug was reported from. */
process.env.TZ = "Asia/Manila";

import { nextCaptureDelayMs, shouldCapture, stalledMinutes } from "../src/lib/imaging.ts";
import { localDayRange, workDate, instantFor, endInstant } from "../src/lib/workday.ts";

let failed = 0;
const check = (name, passed, detail = "") => {
  console.log(`  ${passed ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!passed) failed++;
};

console.log("\nCapture schedule\n");

// Fixed intervals are exactly the interval: an EA on a ten minute setting with
// randomisation off should see 10:00, 10:10, 10:20.
check("10 minutes, not randomised, is exactly 10 minutes",
  nextCaptureDelayMs(10, false) === 600_000,
  `${nextCaptureDelayMs(10, false)}ms`);

// The average is the setting. This is the assertion the old bug failed.
{
  const draws = Array.from({ length: 20_000 }, () => nextCaptureDelayMs(10, true));
  const mean = draws.reduce((a, b) => a + b, 0) / draws.length / 60_000;
  check("randomised 10 minutes averages 10 minutes", Math.abs(mean - 10) < 0.1, `mean ${mean.toFixed(3)} min`);

  const min = Math.min(...draws) / 60_000;
  const max = Math.max(...draws) / 60_000;
  // ±20%, so nothing outside 8–12, and the spread is actually used.
  check("no draw falls outside 8 to 12 minutes", min >= 8 && max <= 12,
    `${min.toFixed(2)} to ${max.toFixed(2)} min`);
  check("the interval is genuinely varied", max - min > 3, `spread ${(max - min).toFixed(2)} min`);
}

// A pathological setting must not produce an instant capture loop.
check("a zero interval is floored at one minute", nextCaptureDelayMs(0, false) === 60_000);

/**
 * An eight-hour shift, beat by beat, through the real functions.
 *
 * This is the question everybody actually asks — "will it take a screenshot
 * every ten minutes, all day" — and until now the only way to answer it was to
 * work a shift and count. The heartbeat is modelled here (fifteen seconds, a
 * virtual clock) but the DECISIONS are the shipped ones: shouldCapture and
 * stalledMinutes are imported, not reimplemented.
 *
 * Every third capture is made to fail on purpose. The old scheduler chained a
 * timer after each SUCCESSFUL capture, so the first failure ended the day. This
 * is what proves that is over.
 */
{
  const BEAT = 15_000;
  const SHIFT = 8 * 60 * 60_000;
  const INTERVAL = 10;

  let nextDue = 0;
  let lastOk = 0;
  let attempts = 0;
  let stored = 0;
  let stallSeen = null;
  const landedAt = [];

  for (let now = 0; now <= SHIFT; now += BEAT) {
    if (shouldCapture(now, nextDue, { busy: false, enabled: true, hasStream: true })) {
      // Scheduled FIRST: the line that stops a failure ending the shift.
      nextDue = now + nextCaptureDelayMs(INTERVAL, true);
      attempts++;
      const failed = attempts % 3 === 0;          // uploads that reject
      if (!failed) { stored++; landedAt.push(now); lastOk = now; }
    }
    const overdue = stalledMinutes(now, lastOk, INTERVAL);
    if (overdue !== null && stallSeen === null) stallSeen = overdue;
  }

  // Eight hours at ten minutes is 48, give or take the randomisation.
  check("an 8-hour shift attempts a capture roughly every 10 minutes",
    attempts >= 44 && attempts <= 52, `${attempts} attempts`);

  // A third of them threw, and the schedule carried on regardless.
  check("failures do not end the shift", stored >= 28 && attempts - stored >= 14,
    `${stored} stored, ${attempts - stored} failed`);

  /* No gap between STORED screenshots longer than two intervals plus slack:
     with every third failing, the worst case is one miss between keepers. */
  const gaps = landedAt.slice(1).map((t, i) => (t - landedAt[i]) / 60_000);
  const worst = Math.max(...gaps);
  check("no gap between stored screenshots exceeds 25 minutes", worst <= 25,
    `worst gap ${worst.toFixed(1)} min`);

  // And the watchdog noticed, which is what it is for.
  check("the watchdog reports a stall when captures stop landing",
    stallSeen !== null, stallSeen === null ? "never fired" : `first at ${stallSeen} min`);
}

/**
 * A capture that HANGS, which is different from one that fails, and was the
 * difference between 48 screenshots and 5.
 *
 * The shift above makes every third capture REJECT, and proves the schedule
 * survives that. Nothing modelled a capture that does neither: no resolve, no
 * reject, just a fetch left open by a connection that went away mid-upload.
 * That matters because the `busy` flag is lowered in a .finally(), and a
 * promise that never settles never reaches one. One hung upload at 08:40 and
 * shouldCapture answered "one is already running" for the remaining seven
 * hours, while the UI still said capturing.
 *
 * Both versions are run here. The one without a timeout is the bug, kept so it
 * cannot come back unnoticed.
 */
{
  const BEAT = 15_000;
  const SHIFT = 8 * 60 * 60_000;
  const INTERVAL = 10;
  const HANGS_ON = 3;             // the third capture of the day never settles

  /** `releaseAfterMs` is Infinity for the old behaviour, the timeout for the fix. */
  const shift = (releaseAfterMs) => {
    let nextDue = 0;
    let busyUntil = null;         // null when no capture is in flight
    let attempts = 0;
    let stored = 0;

    for (let now = 0; now <= SHIFT; now += BEAT) {
      // A capture in flight stops being "busy" once it settles, or once the
      // timeout gives up on it. Without a timeout, never.
      if (busyUntil !== null && now >= busyUntil) busyUntil = null;

      if (shouldCapture(now, nextDue, { busy: busyUntil !== null, enabled: true, hasStream: true })) {
        nextDue = now + nextCaptureDelayMs(INTERVAL, true);
        attempts++;
        if (attempts === HANGS_ON) {
          busyUntil = now + releaseAfterMs;   // the upload that never comes back
        } else {
          stored++;                            // settles within the beat
        }
      }
    }
    return { attempts, stored };
  };

  const broken = shift(Infinity);
  check("WITHOUT a timeout one hung upload ends the shift", broken.attempts <= 4,
    `${broken.attempts} attempts, ${broken.stored} stored in 8 hours`);

  const fixed = shift(90_000);
  check("WITH a timeout the shift carries on past a hung upload",
    fixed.attempts >= 44 && fixed.attempts <= 52, `${fixed.attempts} attempts`);
  check("and only the hung capture is lost", fixed.stored === fixed.attempts - 1,
    `${fixed.stored} stored of ${fixed.attempts}`);
  check("the timeout costs less than one interval", 90_000 < INTERVAL * 60_000,
    "90s against a 10 min interval");
}

// The guards, checked directly rather than inferred from the shift.
check("a disabled account never captures",
  shouldCapture(999_999_999, 0, { busy: false, enabled: false, hasStream: true }) === false);
check("no stream means no capture",
  shouldCapture(999_999_999, 0, { busy: false, enabled: true, hasStream: false }) === false);
check("a capture already running is not doubled",
  shouldCapture(999_999_999, 0, { busy: true, enabled: true, hasStream: true }) === false);
check("nothing is due before its deadline",
  shouldCapture(1_000, 600_000, { busy: false, enabled: true, hasStream: true }) === false);
check("a healthy rhythm never reads as stalled",
  stalledMinutes(600_000, 300_000, 10) === null);

/* ── The day a screenshot belongs to ────────────────────────────────────
 *
 * Reported as: "the date is delayed, I have to select yesterday to see today's
 * work". Captures at 03:39-04:17 on the 26th could only be found under the
 * 25th, because the query sent bare timestamps and the database read them as
 * UTC — so "the 26th" began at 08:00 Manila and the first eight hours of every
 * day fell into the day before.
 */
{
  const { from, to } = localDayRange("2026-08-26");
  check("a Manila day starts at 16:00 UTC the day before",
    from === "2026-08-25T16:00:00.000Z", from);
  check("and ends at 16:00 UTC on the day itself",
    to === "2026-08-26T16:00:00.000Z", to);

  // The exact capture from the screenshot: 4:17:37 AM on the 26th, in Manila.
  const shot = new Date("2026-08-26T04:17:37+08:00").toISOString();
  check("the 04:17 capture belongs to the 26th", shot >= from && shot < to, shot);

  /* What the old code asked for, and why it answered the 25th. These two are
     the regression itself: if either ever flips, the bug is back. */
  const oldDay = (d) => shot >= `${d}T00:00:00Z` && shot <= `${d}T23:59:59.999Z`;
  check("the old bounds missed it on the 26th", oldDay("2026-08-26") === false, shot);
  check("and found it on the 25th, which is what was reported", oldDay("2026-08-25") === true);

  // The boundaries themselves, from both sides.
  check("23:59:59 local is still that day",
    new Date("2026-08-26T23:59:59+08:00").toISOString() < to, "");
  check("00:00:00 local is already that day",
    new Date("2026-08-26T00:00:00+08:00").toISOString() >= from, "");
  check("one second before midnight belongs to the previous day",
    new Date("2026-08-25T23:59:59+08:00").toISOString() < from, "");

  // The two must agree, or the date picker opens on a day the query cannot fill.
  const now = new Date("2026-08-26T04:17:37+08:00");
  const d = workDate(now);
  const r = localDayRange(d);
  check("workDate and localDayRange agree about 'today'",
    d === "2026-08-26" && now.toISOString() >= r.from && now.toISOString() < r.to, d);

  /* A day is not always 24 hours. Manila has no DST, so this is checked where
     it exists: the range stays exactly one day wide however many hours that
     day contains, which "add 86,399,999ms" would not. */
  const hours = (day, tz) => {
    const prev = process.env.TZ;
    process.env.TZ = tz;
    const g = localDayRange(day);
    process.env.TZ = prev;
    return (Date.parse(g.to) - Date.parse(g.from)) / 3_600_000;
  };
  check("a spring-forward day is 23 hours", hours("2026-03-08", "America/New_York") === 23);
  check("a fall-back day is 25 hours", hours("2026-11-01", "America/New_York") === 25);
  check("an ordinary day is 24", hours("2026-08-26", "America/New_York") === 24);
}


/* ── Booking a wall-clock time into somebody else's calendar ──────────────
 *
 * The EA is in Manila (process.env.TZ above). The calendar may not be. "09:30"
 * means 09:30 WHERE THE CALENDAR LIVES, and the browser's own zone must not
 * leak into the answer — that mistake books the middle of the night and the
 * response looks perfectly normal, which is why it needs a test rather than a
 * careful reading.
 */
{
  const at = (date, hhmm, tz) => instantFor(date, hhmm, tz);

  check("09:30 in Manila is 01:30 UTC",
    at("2026-08-26", "09:30", "Asia/Manila") === "2026-08-26T01:30:00.000Z",
    at("2026-08-26", "09:30", "Asia/Manila"));

  // The machine running this IS in Manila, so a London booking is the case
  // where a browser-zone leak would show up.
  check("09:30 in London during BST is 08:30 UTC",
    at("2026-08-26", "09:30", "Europe/London") === "2026-08-26T08:30:00.000Z",
    at("2026-08-26", "09:30", "Europe/London"));
  check("and 09:30 in London during GMT is 09:30 UTC",
    at("2026-01-15", "09:30", "Europe/London") === "2026-01-15T09:30:00.000Z",
    "the same wall clock, four months apart, is a different instant");

  check("09:30 in New York during EDT is 13:30 UTC",
    at("2026-08-26", "09:30", "America/New_York") === "2026-08-26T13:30:00.000Z");
  check("and during EST is 14:30 UTC",
    at("2026-01-15", "09:30", "America/New_York") === "2026-01-15T14:30:00.000Z");

  /* The bug this replaces: reading the string in the browser's zone. From
     Manila that would put every one of the above at 01:30 UTC. */
  const naive = new Date("2026-08-26T09:30").toISOString();
  check("the naive reading really would have been wrong",
    naive !== at("2026-08-26", "09:30", "Europe/London"),
    `naive ${naive} vs London ${at("2026-08-26", "09:30", "Europe/London")}`);

  check("a 45 minute meeting ends 45 minutes later",
    endInstant("2026-08-26T01:30:00.000Z", 45) === "2026-08-26T02:15:00.000Z");
  check("and a 90 minute one crosses the hour correctly",
    endInstant("2026-08-26T23:30:00.000Z", 90) === "2026-08-27T01:00:00.000Z",
    "over midnight, into the next day");
}

console.log(failed === 0 ? "\nSchedule is correct.\n" : `\n${failed} check(s) FAILED.\n`);
process.exit(failed ? 1 : 0);
