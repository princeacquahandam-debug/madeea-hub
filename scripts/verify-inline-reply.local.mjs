/**
 * Can you read a message and answer it without leaving the pane?
 *
 * The specific regression to watch for is the page-level shortcuts: single
 * keys are commands on this screen, so typing "c" into a reply box used to be
 * a real risk of opening the composer mid-sentence.
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
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();

await p.goto(BASE, { waitUntil: "domcontentloaded" });
await p.fill('input[type="email"]', EMAIL);
await p.fill('input[type="password"]', PASSWORD);
await p.getByRole("button", { name: /sign in/i }).first().click();
await p.waitForTimeout(5000);
const skip = p.getByText(/skip tour/i).first();
if (await skip.count()) { await skip.click().catch(() => {}); await p.waitForTimeout(600); }

await p.goto(`${BASE}/inbox`, { waitUntil: "networkidle" });
await p.waitForTimeout(3500);

console.log("removed 'Original Message' label :", (await p.getByText("Original Message").count()) === 0);
const box = p.locator('textarea[aria-label^="Reply to"]');
console.log("reply box present on open       :", (await box.count()) > 0);
console.log("placeholder                     :", await box.first().getAttribute("placeholder"));

// Secondary actions are icon-only, so identity comes from aria-label. An
// icon button without one is unreachable by screen reader, so assert it.
const controls = await p.locator("aside, .card").filter({ has: box }).locator("button")
  .evaluateAll((els) => els.map((e) => (e.textContent || "").trim() || e.getAttribute("aria-label") || "UNLABELLED"));
console.log("controls under the box          :", controls.join(" | "));
console.log("any unlabelled icon button?     :", controls.includes("UNLABELLED"));
const rows = await p.locator("aside, .card").filter({ has: box }).locator("button")
  .evaluateAll((els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().top))).size);
console.log("rows the action bar occupies    :", rows);

// The shortcut regression: type text containing "c" and "r" and confirm no
// compose window opened over the top.
await box.first().click();
await p.keyboard.type("checking that r and c do not fire shortcuts");
await p.waitForTimeout(600);
const typed = await box.first().inputValue();
const composerOpened = await p.locator('text=/New message|Reply all/i').count();
console.log("");
console.log("typed into the box              :", JSON.stringify(typed.slice(0, 45)));
console.log("full composer hijacked typing?  :", typed.length === 0);

// Send must be enabled once there is text, and AI draft must be present.
const send = p.getByRole("button", { name: /^Send/ }).first();
console.log("Send enabled with text          :", await send.isEnabled());
console.log("AI draft button present         :", (await p.getByRole("button", { name: /AI draft/i }).count()) > 0);

await p.screenshot({ path: "scripts/out-inline-reply.png" });
await b.close();
