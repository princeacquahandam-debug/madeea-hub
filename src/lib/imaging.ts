/**
 * Screenshot processing: blur, perceptual hashing, and encoding.
 *
 * All of it runs in the browser before anything is uploaded, and that ordering
 * is the privacy guarantee. If blurring happened on the server, an unblurred
 * frame would cross the network and sit in storage for however long the job
 * queue took. Blurring first means the readable image never leaves the machine
 * it was taken on.
 */

/** A perceptual hash. 64 bits, as 16 hex characters. */
export type PerceptualHash = string;

/**
 * dHash: 64 bits describing the SHAPE of an image rather than its pixels.
 *
 * WHY NOT A CHECKSUM. The spec wants "identical or substantially identical"
 * screenshots found, and wants it to keep working on blurred ones. A checksum
 * answers a different question: JPEG re-encoding alone changes every byte, so
 * two captures of a motionless screen hash differently, while blur changes
 * every byte again and would make every blurred screenshot unique. That is
 * exactly backwards, because blur makes images MORE alike, not less.
 *
 * dHash downscales to 9x8 greyscale and records, for each row, whether each
 * pixel is brighter than the one to its right. Sixty-three comparisons plus one
 * gives 64 bits. Scaling to 9x8 throws away everything except gross structure,
 * which is precisely what blur preserves and what JPEG noise does not touch.
 *
 * Chosen over pHash/DCT deliberately: DCT is more robust to rotation and scale,
 * neither of which happens to a screenshot of a stationary desktop, and it costs
 * a 32x32 cosine transform per capture on the user's machine for accuracy this
 * job does not need.
 */
export async function perceptualHash(source: CanvasImageSource): Promise<PerceptualHash> {
  const W = 9;
  const H = 8;

  /* THE DOWNSCALE IS THE HARD PART, and getting it wrong makes the whole
     detector useless rather than merely inaccurate.
     Drawing 1200px straight to 9x8 point-samples the image: whichever pixels
     happen to land on the 72 sample positions decide the hash. On a screenshot,
     which is mostly thin high-contrast lines and text, a three-pixel scroll
     lands on entirely different pixels and the hash changes completely.
     Measured before this fix: the SAME screen with the cursor moved 3px scored
     21 bits different, while a COMPLETELY different screen scored 18. The
     detector had no discriminating power at all, and it would have shipped
     looking like it worked, because hashes were produced and the filter simply
     returned nothing.
     So the image is averaged down in stages first. Each halving with
     imageSmoothing on is a box filter over the pixels being discarded, so the
     final 9x8 reflects the average brightness of whole regions rather than 72
     arbitrary samples. That is what makes it survive a scroll, a cursor, JPEG
     noise, and blur. */
  const smallW = 64;
  const smallH = Math.max(1, Math.round((64 * H) / W));
  const pre = document.createElement("canvas");
  pre.width = smallW;
  pre.height = smallH;
  const pctx = pre.getContext("2d", { willReadFrequently: true });
  if (!pctx) throw new Error("Canvas 2D is unavailable, so a screenshot cannot be hashed.");
  pctx.imageSmoothingEnabled = true;
  pctx.imageSmoothingQuality = "high";
  // A light blur before the final step, so even 64px of fine detail averages
  // out rather than aliasing again on the last hop.
  pctx.filter = "blur(1px)";
  pctx.drawImage(source, 0, 0, smallW, smallH);
  pctx.filter = "none";

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D is unavailable, so a screenshot cannot be hashed.");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(pre, 0, 0, W, H);

  const { data } = ctx.getImageData(0, 0, W, H);

  // Rec. 601 luma. Averaging the channels instead would let a colour change with
  // no brightness change read as a different screen.
  const grey = new Array<number>(W * H);
  for (let i = 0; i < W * H; i++) {
    const p = i * 4;
    grey[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  }

  let bits = "";
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W - 1; x++) {
      bits += grey[y * W + x] > grey[y * W + x + 1] ? "1" : "0";
    }
  }

  // 64 bits -> 16 hex chars, in nibbles so the string is comparable by eye.
  let hex = "";
  for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

/**
 * How many of the 64 bits differ. 0 is identical; under about 5 is the same
 * screen with a cursor moved or a clock ticking.
 */
export function hammingDistance(a: PerceptualHash, b: PerceptualHash): number {
  if (!a || !b || a.length !== b.length) return 64;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) { d += x & 1; x >>= 1; }
  }
  return d;
}

/**
 * The threshold for "substantially identical". 6 of 64 bits.
 *
 * Not picked by feel. Measured against rendered screens by
 * scripts/verify-imaging.mjs, in bits differing:
 *
 *                      cursor moved   scrolled 3px   different screen
 *   sharp                     1            10               32
 *   blurred                   3             5               26
 *
 * 6 sits in the gap. It calls a moved cursor the same screen, which is the
 * common case and the whole point, and leaves a wide margin before a genuinely
 * different screen. Too low and nothing is ever flagged; too high and two
 * different documents in the same editor start matching, which is the worse
 * error, because a false "identical" is harder for someone to argue with than
 * a missed one.
 *
 * ONE ASYMMETRY WORTH KNOWING. Blur compresses differences, so a 3px scroll
 * reads as identical when blurred (5) but not when sharp (10). The duplicate
 * detector is therefore slightly more eager on blurred screenshots. That is
 * inherent to blurring rather than a bug, but it means a run of "identical"
 * flags on a blurred account deserves more scepticism than the same run on a
 * sharp one.
 */
export const IDENTICAL_THRESHOLD = 6;

export const isSubstantiallyIdentical = (a: PerceptualHash, b: PerceptualHash) =>
  hammingDistance(a, b) <= IDENTICAL_THRESHOLD;

/**
 * Draw a frame to a canvas, downscaled, optionally blurred.
 *
 * BLUR IS DESTRUCTIVE HERE ON PURPOSE. The blurred pixels are what get encoded;
 * no original is kept anywhere, in memory or in storage. §6 requires the
 * original be unrecoverable, and the only way to mean that is never to have one.
 *
 * The radius scales with the output width so a blur looks the same on a 4K
 * monitor and a laptop. A fixed pixel radius would leave a 4K screenshot
 * readable.
 */
export function renderFrame(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  opts: { maxWidth?: number; blur?: boolean } = {},
): HTMLCanvasElement {
  const maxWidth = opts.maxWidth ?? 1280;
  const scale = Math.min(1, maxWidth / sourceWidth);
  const w = Math.max(1, Math.round(sourceWidth * scale));
  const h = Math.max(1, Math.round(sourceHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D is unavailable, so a screenshot cannot be processed.");

  if (opts.blur) {
    /* Proportional, and heavy enough to be a privacy control rather than a
       soft-focus effect: at 1280px this is a 16px radius, which destroys text
       at any size while leaving the shape of the screen legible enough to tell
       a spreadsheet from a video call. That distinction is the entire point of
       blurring rather than not capturing at all. */
    ctx.filter = `blur(${Math.max(6, Math.round(w / 80))}px)`;
  }
  ctx.drawImage(source, 0, 0, w, h);
  ctx.filter = "none";
  return canvas;
}

/** JPEG, because a screenshot is a photograph of a screen, not line art. */
export function toJpegBlob(canvas: HTMLCanvasElement, quality = 0.6): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

/**
 * When to take the next capture: unpredictable, but averaging the configured
 * interval.
 *
 * §1 asks for randomisation, and the reason is behavioural: a capture that
 * always lands on the minute is one anyone can work around, and a predictable
 * monitor measures compliance with the schedule instead of work.
 *
 * THE FIRST VERSION GOT THE ARITHMETIC WRONG, and the error was invisible
 * because the output looked random. It picked a delay between roughly 0 and the
 * interval, which is uniformly distributed around HALF of it: a setting of ten
 * minutes captured every five on average, doubling both the screenshot count
 * and the storage bill. It was caught by reading real capture timestamps out of
 * the database, 3:50 and 1:57 and 6:03 apart, not by the test, which had checked
 * that the delays varied and never that they were right.
 *
 * Randomising AROUND the interval keeps the unpredictability and fixes the rate.
 * Ten minutes gives a delay somewhere between eight and twelve, so no capture
 * time can be anticipated and the long-run average is exactly what was asked
 * for.
 */
export function nextCaptureDelayMs(intervalMinutes: number, randomize: boolean): number {
  const interval = Math.max(1, intervalMinutes) * 60_000;
  if (!randomize) return interval;
  // ±20%: wide enough that the next capture cannot be timed, narrow enough that
  // two consecutive gaps never look like a fault in the recording.
  const jitter = 0.4;
  return Math.round(interval * (1 - jitter / 2 + Math.random() * jitter));
}

/**
 * Is a screenshot due, and has the rhythm stopped?
 *
 * WHY THESE ARE HERE AND NOT INSIDE THE HOOK. They were inside it, as two
 * comparisons buried in a heartbeat, and that is the part of the tracker that
 * has been wrong twice: once because a failed capture never rescheduled, once
 * because the interval arithmetic averaged half of what it claimed. Neither
 * could be tested where it sat, because reaching it meant a real browser, a
 * real screen share and a real ten-minute wait.
 *
 * Out here they are two pure functions over numbers, and check:schedule runs a
 * simulated eight-hour shift through them — including captures that fail — in
 * a few milliseconds.
 */

/** Whether this beat should take a screenshot. */
export function shouldCapture(now: number, nextDueAt: number, opts: {
  /** A capture already running. Two at once would double-count a period. */
  busy: boolean;
  /** The account's switch. Checked every beat so turning it off stops the next. */
  enabled: boolean;
  /** No stream means the share ended; there is nothing to photograph. */
  hasStream: boolean;
}): boolean {
  if (!opts.hasStream || opts.busy || !opts.enabled) return false;
  return now >= nextDueAt;
}

/**
 * Minutes since a screenshot last landed, once that is long enough to be a
 * fault rather than a wait. Null while the rhythm is healthy.
 *
 * 1.8 intervals: late enough that a slow upload or one missed beat cannot raise
 * it, early enough to catch the problem inside a second cycle rather than at
 * the end of a shift.
 */
export function stalledMinutes(now: number, lastOkAt: number, intervalMinutes: number): number | null {
  if (!lastOkAt) return null;
  const overdue = now - lastOkAt;
  const limit = Math.max(1, intervalMinutes) * 60_000 * 1.8;
  return overdue > limit ? Math.round(overdue / 60_000) : null;
}
