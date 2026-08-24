/**
 * Plan the Calendar, end to end: real model, real parsing, real buttons.
 *
 * The point of the feature is that the plan is bookable. Asserting that the
 * prose appears is not enough; the Add buttons have to exist and be wired to
 * the create path.
 */
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const env = Object.fromEntries(readFileSync(".env.local","utf8").split("\n").filter(l=>l.includes("="))
  .map(l=>[l.slice(0,l.indexOf("=")).trim(), l.slice(l.indexOf("=")+1).trim()]));
const admin = createClient(env.VITE_SUPABASE_URL, process.env.SERVICE_KEY, { auth: { persistSession: false } });
const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: "rio.castillo@madeeas.com" });
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
const { data: sess } = await sb.auth.verifyOtp({
  email: "rio.castillo@madeeas.com", token: link.properties.email_otp, type: "magiclink" });
const ref = new URL(env.VITE_SUPABASE_URL).host.split(".")[0];

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1400, height: 940 }, timezoneId: "America/Denver" });
await ctx.addInitScript(([k,v]) => { localStorage.setItem(k,v); localStorage.setItem("madeea-tour-done","1"); },
  [`sb-${ref}-auth-token`, JSON.stringify(sess.session)]);
const p = await ctx.newPage();

// The exact link the Calendar's "Plan day" produces.
const url = "http://localhost:5174/quick-actions?" + new URLSearchParams({
  action: "Plan the Calendar",
  output: "Block focus time",
  date: "2026-08-25",
  constraints: "On Tuesday, August 25 I already have:\n7:00 PM AS x MadeEA (1 hr)\nI want deep work in the morning.",
});
await p.goto(url, { waitUntil: "domcontentloaded" });
await p.waitForTimeout(3500);
const skip = p.getByText(/skip tour/i).first();
if (await skip.count()) { await skip.click().catch(()=>{}); await p.waitForTimeout(600); }

// Target the field by its label, not by position: the first input on the page
// is the header search box.
const fields = await p.locator("form, .card").locator("input, textarea, select").evaluateAll((els) =>
  els.map((e) => ({ id: e.id || e.getAttribute("placeholder") || e.tagName, value: e.value })).filter((f) => f.value));
console.log("prefilled fields     :", JSON.stringify(fields));
const selVal = await p.locator("select").first().inputValue().catch(()=>"");
console.log("prefilled What you need:", JSON.stringify(selVal));

await p.getByRole("button", { name: /generate/i }).click();
console.log("generating (live model)…");
await p.waitForSelector("text=/Proposed blocks|Nothing worth adding/", { timeout: 90000 });
await p.waitForTimeout(800);

/* The component says so itself when the date did not arrive, which is the
   only thing that actually matters: without it nothing can be booked. */
const noDate = await p.locator("text=/No date given/").count();
const dateShown = await p.locator("text=/2026-08-25/").count();
console.log("date reached the booker:", noDate === 0 && dateShown > 0, noDate ? "(says: No date given)" : "");
const heading = await p.locator("text=Proposed blocks").count();
console.log("");
console.log("Proposed blocks shown:", heading > 0);
const tzShown = await p.locator("text=/Proposed blocks/").locator("xpath=..").textContent();
console.log("zone on the header   :", tzShown?.replace(/\s+/g," ").trim().slice(0,60));
const rows = await p.locator("li").filter({ has: p.getByRole("button", { name: /^Add$/ }) }).count();
console.log("bookable rows        :", rows);
const times = await p.locator("li span.tabular-nums").allTextContents();
console.log("slots                :", times.map(t=>t.trim()).filter(Boolean).join("  |  "));
const addBtn = p.getByRole("button", { name: /^Add$/ }).first();
console.log("Add enabled          :", await addBtn.count() ? await addBtn.isEnabled() : "no button", "(false expected: token is read-only)");
const warn = await p.locator(".text-amber-200").first().textContent().catch(()=>null);
console.log("warning              :", warn?.replace(/\s+/g," ").trim().slice(0, 90));

await p.screenshot({ path: "scripts/out-plan.png", fullPage: false });
await b.close();
