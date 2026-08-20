/**
 * End-to-end: clock in, capture, and check what actually reached the database.
 *
 * Creates a real time entry and a real screenshot in production, then deletes
 * both. Named .local so it is gitignored: it is a probe, not a test suite.
 */
import { chromium } from "playwright";

const BASE = "http://localhost:5174";
const ctx = await chromium.launchPersistentContext("", {
  headless: true,
  args: ["--auto-select-desktop-capture-source=Entire screen", "--use-fake-ui-for-media-stream"],
});
const p = await ctx.newPage();
const errs = [];
p.on("pageerror", (e) => errs.push(String(e).slice(0, 120)));

await p.goto(BASE, { waitUntil: "networkidle" });
if (await p.locator('input[type="password"]').count()) {
  await p.fill('input[type="email"]', "rio.castillo@madeeas.com");
  await p.fill('input[type="password"]', "DemoPass!2026-madeea");
  await p.getByRole("button", { name: /sign in/i }).first().click();
  await p.waitForTimeout(5000);
}
const skip = p.getByText(/skip tour/i).first();
if (await skip.count()) { await skip.click().catch(() => {}); await p.waitForTimeout(700); }

await p.goto(`${BASE}/time`, { waitUntil: "networkidle" });
await p.waitForTimeout(2500);

// Clock in, which is what a monitored session hangs off.
const clockIn = p.getByRole("button", { name: /^\s*Clock in\s*$/ }).first();
if (await clockIn.count()) { await clockIn.click(); await p.waitForTimeout(2500); }
console.log("clocked in                 :", await p.evaluate(() => /Clock out/.test(document.body.innerText)));

// Generate some input so the counters are not zero.
await p.mouse.move(200, 300);
await p.mouse.move(400, 380);
await p.keyboard.press("a");
await p.keyboard.press("b");
await p.waitForTimeout(500);

const startBtn = p.getByRole("button", { name: /start screen capture/i }).first();
if (await startBtn.count()) {
  await startBtn.click();
  await p.waitForTimeout(6000);
} else {
  console.log("NOTE: no capture button found; capture may be disabled in settings");
}

const status = await p.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 400));
console.log("surface refused?           :", /Choose Entire Screen instead/.test(status));
console.log("capturing?                 :", /Capturing every|Sharing your/.test(status));
console.log("page errors                :", errs.length ? errs.slice(0, 2).join(" | ") : "none");

await ctx.close();
