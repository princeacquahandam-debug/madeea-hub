/**
 * Can a reviewer actually review a named person?
 *
 * The database was already correct: a manager can read the team's screenshots
 * and an employee cannot. Proven by impersonation, not by reading policy text.
 * What was missing was any way to USE that in the app: the page never passed an
 * owner filter and no screen said whose desktop was on it.
 */
import { chromium } from "playwright";


/* Credentials come from the environment. They were hardcoded here, which put a
   real password into a repository other people can read, and into its history.
   See .env.example. */
const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error("Set E2E_EMAIL and E2E_PASSWORD before running this. See .env.example.");
  process.exit(1);
}

const BASE = "http://localhost:5174";
const b = await chromium.launch();
const p = await (await b.newContext()).newPage();

await p.goto(BASE, { waitUntil: "domcontentloaded" });
await p.fill('input[type="email"]', EMAIL);
await p.fill('input[type="password"]', PASSWORD);
await p.getByRole("button", { name: /sign in/i }).first().click();
await p.waitForTimeout(5000);
const skip = p.getByText(/skip tour/i).first();
if (await skip.count()) { await skip.click().catch(() => {}); await p.waitForTimeout(600); }

await p.goto(`${BASE}/screenshots`, { waitUntil: "networkidle" });
await p.waitForTimeout(3500);

const picker = p.locator("#shot-who");
console.log("Person picker present      :", (await picker.count()) === 1);
const opts = await picker.locator("option").allTextContents();
console.log("people selectable          :", opts.length, "->", opts.join(" | "));

// Attribution: is a name actually painted next to the session?
const named = await p.evaluate(() =>
  [...document.querySelectorAll("section.card h2")]
    .map((h) => h.parentElement?.textContent?.trim().replace(/\s+/g, " "))
    .filter(Boolean));
console.log("session headers            :", named.join("  //  "));

// Narrow to one person and confirm the set changes rather than just re-rendering.
const before = await p.locator('button[aria-label^="Screenshot at"]').count();
const rio = opts.find((o) => o.includes("Rio"));
await picker.selectOption({ label: rio });
await p.waitForTimeout(2500);
const afterRio = await p.locator('button[aria-label^="Screenshot at"]').count();

const other = opts.find((o) => !o.includes("Rio") && !o.includes("Everyone"));
await picker.selectOption({ label: other });
await p.waitForTimeout(2500);
const afterOther = await p.locator('button[aria-label^="Screenshot at"]').count();

console.log("");
console.log("Everyone                   :", before, "screenshots");
console.log(`filtered to ${rio?.split(" ·")[0]}`.padEnd(27), ":", afterRio, "screenshots");
console.log(`filtered to ${other?.split(" ·")[0]}`.padEnd(27), ":", afterOther, "screenshots");

await p.screenshot({ path: "scripts/out-review-scope.png", fullPage: true });
await b.close();
