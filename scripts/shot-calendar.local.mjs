import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const env = Object.fromEntries(readFileSync(".env.local","utf8").split("\n").filter(l=>l.includes("="))
  .map(l=>[l.slice(0,l.indexOf("=")).trim(), l.slice(l.indexOf("=")+1).trim()]));

const admin = createClient(env.VITE_SUPABASE_URL, process.env.SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } });
const { data: link } = await admin.auth.admin.generateLink({
  type: "magiclink", email: "rio.castillo@madeeas.com" });
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
const { data: sess } = await sb.auth.verifyOtp({
  email: "rio.castillo@madeeas.com", token: link.properties.email_otp, type: "magiclink" });

const ref = new URL(env.VITE_SUPABASE_URL).host.split(".")[0];
const BASE = "http://localhost:5174";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
await ctx.addInitScript(([k, v]) => { localStorage.setItem(k, v); localStorage.setItem("madeea-tour-done", "1"); },
  [`sb-${ref}-auth-token`, JSON.stringify(sess.session)]);
const p = await ctx.newPage();

await p.goto(`${BASE}/calendar`, { waitUntil: "networkidle" });
await p.waitForTimeout(4000);
const skip = p.getByText(/skip tour/i).first();
if (await skip.count()) { await skip.click().catch(() => {}); await p.waitForTimeout(800); }

console.log("heading        :", await p.locator("h1").first().textContent());
console.log("month cells    :", await p.locator('button[aria-label*="event"]').count());
console.log("sidebar nav has Calendar:", await p.locator('a[href="/calendar"]').count() > 0);
const warn = await p.locator(".text-amber-200").allTextContents();
console.log("warnings       :", warn.join(" | ") || "none");

// Click a day that has events, then check the agenda and the prep deep link.
const busy = p.locator('button[aria-label*="event"]').filter({ hasNot: p.locator("text=/, 0 events/") });
const withEvents = await p.locator('button[aria-label]').evaluateAll((els) =>
  els.map((e, i) => ({ i, label: e.getAttribute("aria-label") }))
     .filter((x) => x.label && /\d+ events?$/.test(x.label) && !/, 0 events/.test(x.label)));
console.log("days with events:", withEvents.length);
if (withEvents.length) {
  await p.locator('button[aria-label]').nth(withEvents[0].i).click();
  await p.waitForTimeout(1200);
}
await p.screenshot({ path: "scripts/out-calendar.png" });

const prep = p.getByRole("button", { name: /^Prepare/ }).first();
if (await prep.count()) {
  await prep.click();
  await p.waitForTimeout(2500);
  console.log("");
  console.log("Prepare went to :", new URL(p.url()).pathname);
  const filled = await p.locator("input, textarea").evaluateAll((els) =>
    els.map((e) => e.value).filter((v) => v && v.length > 2).slice(0, 3));
  console.log("prefilled fields:", filled.map((f) => JSON.stringify(String(f).slice(0, 58))).join("  "));
  await p.screenshot({ path: "scripts/out-calendar-prep.png" });
}
await b.close();
