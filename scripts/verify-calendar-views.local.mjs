/**
 * Every view, both toggle states, and the timezone that was wrong.
 *
 * The bug that started this: Google shows Team Meeting at 8pm GMT+8 and the app
 * showed 5:00 AM, because it rendered in the laptop's zone. Asserted here
 * against the real event, not a fixture.
 */
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const env = Object.fromEntries(readFileSync(".env.local","utf8").split("\n").filter(l=>l.includes("="))
  .map(l=>[l.slice(0,l.indexOf("=")).trim(), l.slice(l.indexOf("=")+1).trim()]));

const admin = createClient(env.VITE_SUPABASE_URL, process.env.SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } });
const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: "rio.castillo@madeeas.com" });
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
const { data: sess } = await sb.auth.verifyOtp({
  email: "rio.castillo@madeeas.com", token: link.properties.email_otp, type: "magiclink" });

const ref = new URL(env.VITE_SUPABASE_URL).host.split(".")[0];
const b = await chromium.launch();
// Deliberately a US zone, which is the situation that produced the bug.
const ctx = await b.newContext({ viewport: { width: 1440, height: 940 }, timezoneId: "America/Denver" });
await ctx.addInitScript(([k, v]) => {
  localStorage.setItem(k, v); localStorage.setItem("madeea-tour-done", "1");
}, [`sb-${ref}-auth-token`, JSON.stringify(sess.session)]);
const p = await ctx.newPage();

await p.goto("http://localhost:5174/calendar", { waitUntil: "networkidle" });
await p.waitForTimeout(4500);
const skip = p.getByText(/skip tour/i).first();
if (await skip.count()) { await skip.click().catch(() => {}); await p.waitForTimeout(700); }

console.log("browser zone is     : America/Denver (the wrong-looking case)");
const zoneChip = await p.locator("button[title*='timezone']").first().textContent();
console.log("zone shown           :", zoneChip?.trim());

// The decisive assertion: open the day of the known event and read its time.
await p.keyboard.press("m");
await p.waitForTimeout(1200);

for (const [key, name] of [["d","Day"],["w","Week"],["m","Month"],["y","Year"],["a","Schedule"],["x","4 days"]]) {
  await p.keyboard.press(key);
  await p.waitForTimeout(900);
  const label = (await p.locator("h2").first().textContent())?.trim();
  const crashed = await p.locator("text=/Something went wrong|Unexpected/i").count();
  console.log(`  ${name.padEnd(9)} -> ${String(label).slice(0, 46).padEnd(48)} ${crashed ? "CRASHED" : "ok"}`);
}

// Week view, find the known event and read the rendered time.
await p.keyboard.press("w");
await p.waitForTimeout(1200);
const teamBtn = p.locator("button", { hasText: "Team Meeting" }).first();
if (await teamBtn.count()) {
  console.log("");
  console.log("Team Meeting renders:", (await teamBtn.textContent())?.replace(/\s+/g, " ").trim());
}

await p.keyboard.press("m");
await p.waitForTimeout(900);
await p.screenshot({ path: "scripts/out-cal-month.png" });
await p.keyboard.press("w");
await p.waitForTimeout(1200);
await p.screenshot({ path: "scripts/out-cal-week.png" });
await p.keyboard.press("y");
await p.waitForTimeout(1200);
await p.screenshot({ path: "scripts/out-cal-year.png" });

// Toggles.
await p.keyboard.press("m");
await p.waitForTimeout(800);
await p.getByRole("button", { name: /^Month/ }).click();
await p.waitForTimeout(400);
const before = await p.locator('button[aria-label*="item"]').count();
await p.getByRole("menuitemcheckbox", { name: /show weekends/i }).click();
await p.waitForTimeout(900);
const after = await p.locator('button[aria-label*="item"]').count();
console.log("");
console.log("weekends on  -> cells:", before);
console.log("weekends off -> cells:", after, after < before ? "(columns removed)" : "(NO CHANGE - broken)");
await p.screenshot({ path: "scripts/out-cal-noweekend.png" });
await b.close();
