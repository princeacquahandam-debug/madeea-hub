/**
 * Does the identical-screenshot detector actually work, including on blurred
 * images?
 *
 * This is the claim most likely to be wrong in a way nobody notices: the code
 * runs, hashes get written, the filter returns nothing, and everyone assumes
 * there were no duplicates. So it is checked against rendered images rather
 * than asserted in a comment.
 *
 *   node scripts/verify-imaging.mjs
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const lib = readFileSync("src/lib/imaging.ts", "utf8")
  // Strip TypeScript that the browser cannot parse. The logic is plain JS.
  .replace(/^import[^\n]*\n/gm, "")
  .replace(/export (async )?function/g, "$1function")
  .replace(/export const/g, "const")
  .replace(/export type[^\n]*\n/g, "")
  .replace(/: (CanvasImageSource|HTMLCanvasElement|PerceptualHash|number|boolean|string|Blob \| null|Promise<[^>]*>)/g, "")
  .replace(/opts: \{[^}]*\} = \{\}/g, "opts = {}")
  .replace(/new Array<number>/g, "new Array");

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent("<canvas id=c></canvas>");
await page.addScriptTag({ content: lib });

const result = await page.evaluate(async () => {
  // Three synthetic "screens": two nearly identical, one clearly different.
  const draw = (fn) => {
    const c = document.createElement("canvas");
    c.width = 1200; c.height = 800;
    const x = c.getContext("2d");
    x.fillStyle = "#101520"; x.fillRect(0, 0, 1200, 800);
    fn(x);
    return c;
  };

  const spreadsheet = (x, shiftPx = 0) => {
    x.fillStyle = "#e9f0f7";
    for (let r = 0; r < 18; r++) x.fillRect(60 + shiftPx, 60 + r * 40, 1080, 2);
    for (let col = 0; col < 8; col++) x.fillRect(60 + col * 135 + shiftPx, 60, 2, 700);
    x.fillStyle = "#fd5811"; x.fillRect(200 + shiftPx, 300, 120, 30);
  };
  const videoCall = (x) => {
    x.fillStyle = "#2a2520"; x.fillRect(100, 80, 1000, 560);
    x.fillStyle = "#8ea1b5";
    x.beginPath(); x.arc(600, 340, 150, 0, Math.PI * 2); x.fill();
  };

  const a = draw((x) => spreadsheet(x, 0));
  /* Two grades of "same screen", because they are genuinely different
     situations and one threshold has to cover both:
       b = a cursor moved. A tiny local change; the overwhelmingly common case.
       s = the view scrolled 3px. Every line lands somewhere new. This is the
           hardest case a duplicate detector faces and arguably should NOT be
           called identical, since the content did move. */
  const b = draw((x) => { spreadsheet(x, 0); x.fillStyle = "#fff"; x.fillRect(640, 402, 10, 18); });
  const s = draw((x) => spreadsheet(x, 3));
  const c = draw(videoCall);

  const ha = await perceptualHash(a);
  const hb = await perceptualHash(b);
  const hs = await perceptualHash(s);
  const hc = await perceptualHash(c);

  // Now the part that matters: the same comparisons AFTER blurring.
  const blur = (src) => renderFrame(src, 1200, 800, { blur: true, maxWidth: 1280 });
  const hba = await perceptualHash(blur(a));
  const hbb = await perceptualHash(blur(b));
  const hbs = await perceptualHash(blur(s));
  const hbc = await perceptualHash(blur(c));

  const delays = [];
  for (let i = 0; i < 5000; i++) delays.push(nextCaptureDelayMs(10, true));
  const fixed = nextCaptureDelayMs(10, false);

  return {
    sharp: {
      cursorMoved: hammingDistance(ha, hb),
      scrolled: hammingDistance(ha, hs),
      differentScreen: hammingDistance(ha, hc),
    },
    blurred: {
      cursorMoved: hammingDistance(hba, hbb),
      scrolled: hammingDistance(hba, hbs),
      differentScreen: hammingDistance(hba, hbc),
    },
    threshold: IDENTICAL_THRESHOLD,
    hashLength: ha.length,
    randomisation: {
      fixedMs: fixed,
      min: Math.min(...delays),
      max: Math.max(...delays),
      // The mean is the assertion that matters. The first version of this test
      // checked only that the values varied, so a generator averaging half the
      // configured interval passed it.
      meanMinutes: +(delays.reduce((a, b) => a + b, 0) / delays.length / 60000).toFixed(2),
      distinctValues: new Set(delays).size,
    },
  };
});

const ok = (b) => (b ? "PASS" : "FAIL");
console.log("hash length (16 hex = 64 bits):", result.hashLength, ok(result.hashLength === 16));
console.log("");
for (const [label, r] of [["SHARP  ", result.sharp], ["BLURRED", result.blurred]]) {
  console.log(label + "  cursor moved     :", String(r.cursorMoved).padStart(2), "bits ->", ok(r.cursorMoved <= result.threshold), "(want <= " + result.threshold + ")");
  console.log(label + "  scrolled 3px     :", String(r.scrolled).padStart(2), "bits");
  console.log(label + "  different screen :", String(r.differentScreen).padStart(2), "bits ->", ok(r.differentScreen > result.threshold), "(want >  " + result.threshold + ")");
  console.log("");
}
console.log("");
console.log("randomised interval, 10 min set    :",
  (result.randomisation.min / 60000).toFixed(1) + " .. " + (result.randomisation.max / 60000).toFixed(1) + " min,",
  result.randomisation.distinctValues, "distinct over 5000 draws");
console.log("  mean must equal the setting      :", result.randomisation.meanMinutes, "min ->",
  ok(Math.abs(result.randomisation.meanMinutes - 10) < 0.15));
console.log("randomisation off                  :", result.randomisation.fixedMs / 60000 + " min exactly",
  ok(result.randomisation.fixedMs === 600000));

await browser.close();
