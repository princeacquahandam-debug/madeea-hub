/**
 * Screenshot the real app, signed in, so a UI change is checked against what
 * renders rather than against what the code says it should render.
 *
 *   node scripts/shots.mjs [baseUrl]
 *
 * Not part of the build. Local verification only, and the images are gitignored.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";


/* Credentials come from the environment. They were hardcoded here, which put a
   real password into a repository other people can read, and into its history.
   See .env.example. */
const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error("Set E2E_EMAIL and E2E_PASSWORD before running this. See .env.example.");
  process.exit(1);
}

const BASE = process.argv[2] ?? "http://localhost:5174";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

// Surface anything the page complains about; a silent console is part of the
// check, not a nicety.
const problems = [];
page.on("console", (m) => { if (m.type() === "error") problems.push(m.text()); });
page.on("pageerror", (e) => problems.push(String(e)));

await page.goto(BASE, { waitUntil: "networkidle" });

// Sign in through the real form if the login gate is up.
if (await page.locator('input[type="password"]').count()) {
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).first().click();
  await page.waitForTimeout(4000);
}

/* The first-run tour drops a full-screen overlay that swallows every click, so
   nothing can be exercised until it is dismissed. Skipped rather than stepped
   through: the tour is not what is being checked here. */
async function dismissTour() {
  const skip = page.getByText(/skip tour/i).first();
  if (await skip.count()) {
    await skip.click().catch(() => {});
    await page.waitForTimeout(800);
  }
}
await dismissTour();

const shots = [
  ["communication", "/communication"],
  ["integrations", "/integrations"],
];

for (const [name, path] of shots) {
  await page.goto(BASE + path, { waitUntil: "networkidle" });
  await dismissTour();
  await page.waitForTimeout(3500); // let the channel queries land
  await page.screenshot({ path: `verify-${name}.png`, fullPage: true });
  console.log(`verify-${name}.png`);
}

// Slack selected, which is the flow that was actually broken.
await page.goto(BASE + "/communication", { waitUntil: "networkidle" });
await dismissTour();
await page.waitForTimeout(2500);
const slackNav = page.getByRole("button", { name: /^Slack/ }).last();
if (await slackNav.count()) {
  await slackNav.click();
  await page.waitForTimeout(3500);
  await page.screenshot({ path: "verify-slack.png", fullPage: true });
  console.log("verify-slack.png");
}

console.log(problems.length ? `\nconsole errors:\n  ${problems.slice(0, 8).join("\n  ")}` : "\nno console errors");
await browser.close();
