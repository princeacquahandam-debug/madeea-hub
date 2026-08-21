/** Screenshots for the update to Prince. JPEG, because these go into a Doc as
 *  base64 and PNG at this size would make the upload several megabytes. */
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
const p = await (await b.newContext({ viewport: { width: 1180, height: 745 }, deviceScaleFactor: 1 })).newPage();

await p.goto(BASE, { waitUntil: "domcontentloaded" });
await p.fill('input[type="email"]', EMAIL);
await p.fill('input[type="password"]', PASSWORD);
await p.getByRole("button", { name: /sign in/i }).first().click();
await p.waitForTimeout(5500);
const skip = p.getByText(/skip tour/i).first();
if (await skip.count()) { await skip.click().catch(() => {}); await p.waitForTimeout(800); }

const shots = [
  ["inbox", "/inbox", 4000],
  ["integrations", "/integrations", 3000],
  ["admin", "/admin", 3500],
];

for (const [name, path, wait] of shots) {
  await p.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  await p.waitForTimeout(wait);
  await p.screenshot({ path: `scripts/report-${name}.jpg`, type: "jpeg", quality: 60 });
  console.log(name, "captured");
}
await b.close();
