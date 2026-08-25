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
import { nextCaptureDelayMs, shouldCapture, stalledMinutes } from "../src/lib/imaging.ts";

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

console.log(failed === 0 ? "\nSchedule is correct.\n" : `\n${failed} check(s) FAILED.\n`);
process.exit(failed ? 1 : 0);
