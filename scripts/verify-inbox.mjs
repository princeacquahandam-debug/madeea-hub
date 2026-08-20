/**
 * Browser checks for the Inbox rebuild.
 *
 * Not a test suite. A way to answer, against the running app, the specific
 * questions the critique raised, so a fix is confirmed rather than assumed.
 *
 *   node scripts/verify-inbox.mjs [width] [theme]
 */
import { chromium } from "playwright";

const WIDTH = Number(process.argv[2] ?? 1440);
const THEME = process.argv[3] ?? "dark";
const BASE = "http://localhost:5174";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: WIDTH, height: 900 } });

await page.goto(BASE, { waitUntil: "networkidle" });
if (await page.locator('input[type="password"]').count()) {
  await page.fill('input[type="email"]', "rio.castillo@madeeas.com");
  await page.fill('input[type="password"]', "DemoPass!2026-madeea");
  await page.getByRole("button", { name: /sign in/i }).first().click();
  await page.waitForTimeout(4500);
}
const skip = page.getByText(/skip tour/i).first();
if (await skip.count()) { await skip.click().catch(() => {}); await page.waitForTimeout(800); }

await page.goto(`${BASE}/communication`, { waitUntil: "networkidle" });
await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), THEME);
await page.waitForTimeout(2600);

const rowsOf = () =>
  page.evaluate(() =>
    [...document.querySelectorAll("button")]
      .filter((b) => b.querySelector("span[aria-hidden]") && b.textContent.trim().length > 20)
      .map((b) => b.textContent.replace(/\s+/g, " ").trim()),
  );

// The grid that holds rail + list + reader is the one with three element children.
const cols = await page.evaluate(() => {
  const grid = [...document.querySelectorAll("div")].find(
    (d) => getComputedStyle(d).display === "grid" && d.children.length === 3,
  );
  if (!grid) return null;
  return [...grid.children].map((c) => Math.round(c.getBoundingClientRect().width));
});

const firstRows = (await rowsOf()).slice(0, 3);

// Does the reader show something the filters exclude?
await page.fill("#inbox-search", "zzzqqqxxx");
await page.waitForTimeout(1000);
const afterSearch = await page.evaluate(() => ({
  emptyState: /Nothing matches/i.test(document.body.innerText),
  readerShowsMessage: /Original Message/i.test(document.body.innerText),
}));
await page.fill("#inbox-search", "");
await page.waitForTimeout(700);

// Is the reader reachable after scrolling the list?
await page.mouse.wheel(0, 4000);
await page.waitForTimeout(600);
const readerTop = await page.evaluate(() => {
  const h = [...document.querySelectorAll("p")].find((p) => /Original Message/i.test(p.textContent));
  return h ? Math.round(h.getBoundingClientRect().top) : null;
});

console.log(`--- ${WIDTH}px / ${THEME} ---`);
console.log("grid columns [rail, list, reader]:", cols ? cols.join(" | ") : "(no 3-child grid)");
console.log("first rows:", firstRows.map((r) => r.slice(0, 46)).join("  //  "));
console.log(`search nonsense -> empty state: ${afterSearch.emptyState}, reader still showing a message: ${afterSearch.readerShowsMessage}`);
console.log(`reader 'Original Message' top after scrolling 4000px: ${readerTop}px (must be on screen, 0..900)`);

await browser.close();
