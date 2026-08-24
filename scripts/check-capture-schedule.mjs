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
import { nextCaptureDelayMs } from "../src/lib/imaging.ts";

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

console.log(failed === 0 ? "\nSchedule is correct.\n" : `\n${failed} check(s) FAILED.\n`);
process.exit(failed ? 1 : 0);
