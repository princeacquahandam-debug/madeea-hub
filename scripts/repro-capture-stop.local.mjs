/**
 * Why does screen capture stop?
 *
 * Two candidate causes and they need different fixes, so this distinguishes
 * them rather than assuming:
 *   A) navigating to another page inside the app
 *   B) switching to a different browser tab
 */
import { chromium } from "playwright";

const BASE = "http://localhost:5174";
const ctx = await chromium.launchPersistentContext("", {
  headless: true,
  args: ["--auto-select-desktop-capture-source=Entire screen", "--use-fake-ui-for-media-stream"],
});
const p = await ctx.newPage();

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
await p.waitForTimeout(2200);

const clockIn = p.getByRole("button", { name: /^\s*Clock in\s*$/ }).first();
if (await clockIn.count()) { await clockIn.click(); await p.waitForTimeout(2500); }

// Track every live MediaStream track the page creates, so "is it still running"
// is answered by the browser rather than by what the UI claims.
await p.evaluate(() => {
  window.__tracks = [];
  const orig = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getDisplayMedia = async (...a) => {
    const s = await orig(...a);
    window.__tracks.push(...s.getVideoTracks());
    return s;
  };
});

const startBtn = p.getByRole("button", { name: /start screen capture/i }).first();
if (await startBtn.count()) { await startBtn.click(); await p.waitForTimeout(3500); }

const liveCount = () => p.evaluate(() => (window.__tracks ?? []).filter((t) => t.readyState === "live").length);
const uiSays = () => p.evaluate(() => /Sharing your|Capturing every/.test(document.body.innerText));

console.log("after starting        : live tracks =", await liveCount(), "| UI says capturing =", await uiSays());

// A) navigate inside the app
await p.locator('a[href="/tasks"]').first().click().catch(() => {});
await p.waitForTimeout(2200);
console.log("A) navigated to Tasks : live tracks =", await liveCount());

await p.locator('a[href="/time"]').first().click().catch(() => {});
await p.waitForTimeout(2200);
console.log("   back on Time       : live tracks =", await liveCount(), "| UI says capturing =", await uiSays());

// B) switch to a different browser tab
const other = await ctx.newPage();
await other.goto("about:blank");
await other.bringToFront();
await p.waitForTimeout(2500);
await p.bringToFront();
await p.waitForTimeout(1200);
console.log("B) switched browser tab: live tracks =", await liveCount(), "| UI says capturing =", await uiSays());

/* D) THE ACTUAL REPORTED CASE.
   refetchOnWindowFocus is on, so returning to the tab refetches the session
   list. Previously one failed refetch returned an empty array, the provider
   concluded the shift was over, and the recording was torn down mid-session.
   Simulated here by failing that request outright while capture is running. */
await p.route("**/rest/v1/time_entries*", (route) =>
  route.fulfill({ status: 500, body: '{"message":"simulated transient failure"}' }));
await p.evaluate(() => window.dispatchEvent(new Event("focus")));
await p.waitForTimeout(4000);
console.log("D) session refetch FAILS: live tracks =", await liveCount(), "| UI says capturing =", await uiSays());
await p.unroute("**/rest/v1/time_entries*");
await p.waitForTimeout(2500);
console.log("   after it recovers   : live tracks =", await liveCount());

// C) clocking out must END it. Capture that outlives the session would be
// worse than capture that dies too early.
await p.locator('a[href="/time"]').first().click().catch(() => {});
await p.waitForTimeout(2000);
const clockOut = p.getByRole("button", { name: /clock out/i }).first();
if (await clockOut.count()) {
  await clockOut.click();
  await p.waitForTimeout(1200);
  // An early clock-out asks for a reason before it commits.
  const reason = p.locator("#early-reason");
  if (await reason.count()) {
    await reason.fill("automated check");
    await p.getByRole("button", { name: /^\s*Clock out\s*$/ }).last().click();
  }
  await p.waitForTimeout(3000);
}
console.log("C) clocked out        : live tracks =", await liveCount(), "(must be 0)");

await ctx.close();
