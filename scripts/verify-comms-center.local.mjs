/**
 * Does the Communication Center show every channel, and do the ones that do
 * not work read as not working?
 *
 * The failure this guards against is a locked chip that behaves like a filter:
 * you would click LinkedIn, get an empty list, and conclude there were no
 * LinkedIn messages rather than that LinkedIn cannot be read at all.
 */
import { chromium } from "playwright";

const BASE = "http://localhost:5174";
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();

await p.goto(BASE, { waitUntil: "domcontentloaded" });
await p.fill('input[type="email"]', "rio.castillo@madeeas.com");
await p.fill('input[type="password"]', "DemoPass!2026-madeea");
await p.getByRole("button", { name: /sign in/i }).first().click();
await p.waitForTimeout(5000);
const skip = p.getByText(/skip tour/i).first();
if (await skip.count()) { await skip.click().catch(() => {}); await p.waitForTimeout(600); }

await p.goto(`${BASE}/inbox`, { waitUntil: "networkidle" });
await p.waitForTimeout(3000);

console.log("page heading        :", await p.locator("h1").first().textContent());

// Sidebar: does the longer name fit, or is it clipped?
const nav = p.locator('a[href="/inbox"]').first();
console.log("sidebar label       :", (await nav.textContent())?.trim());
const clipped = await nav.evaluate((el) => {
  const t = [...el.querySelectorAll("*")].find((n) => n.textContent?.includes("Communication")) ?? el;
  return { scroll: t.scrollWidth, client: t.clientWidth, overflowing: t.scrollWidth > t.clientWidth + 1 };
});
console.log("sidebar truncated?  :", clipped.overflowing, `(${clipped.scroll}px into ${clipped.client}px)`);

const group = p.locator('[aria-label="Filter by source"]');
const filters = await group.locator("button").allTextContents();
const lockedLinks = group.locator('a[aria-label*="not connected"]');
const lockedNames = await lockedLinks.evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")?.split(":")[0]));

console.log("");
console.log("real filters        :", filters.map((t) => t.trim()).join(" | "));
console.log("locked, not filters :", lockedNames.join(" | "));

// The point of the whole thing: a locked chip must not filter.
const before = await p.locator("[data-thread-row], [role='row']").count();
await lockedLinks.first().click();
await p.waitForTimeout(2000);
console.log("");
console.log("clicking LinkedIn   -> url:", new URL(p.url()).pathname, "(should be /integrations, not an empty inbox)");
console.log("                       tooltip:", await group.locator("a").first().getAttribute("title").catch(() => null));

await p.waitForTimeout(1500);
await p.screenshot({ path: "scripts/out-integrations.png" });
await p.goto(`${BASE}/inbox`, { waitUntil: "networkidle" });
await p.waitForTimeout(2500);
await p.screenshot({ path: "scripts/out-comms-center.png" });
console.log("rows before click   :", before);
await b.close();
