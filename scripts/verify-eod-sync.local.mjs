/**
 * A failed EOD read must look like a failure, not like a team that did nothing.
 *
 * This is the "it does not sync between devices" symptom: the hook swallowed
 * every read error and returned an empty list, so one machine showed 32
 * submissions and another showed 0.00% completion, with nothing on either
 * screen saying which was real.
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

async function open(breakReads) {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addInitScript(([k,v]) => { localStorage.setItem(k,v); localStorage.setItem("madeea-tour-done","1"); },
    [`sb-${ref}-auth-token`, JSON.stringify(sess.session)]);
  const p = await ctx.newPage();
  if (breakReads) {
    // Exactly what a dropped request or an expired policy looks like.
    await p.route("**/rest/v1/eod_reports*", (r) =>
      r.fulfill({ status: 500, contentType: "application/json", body: '{"message":"simulated read failure"}' }));
  }
  await p.goto("http://localhost:5174/eod", { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(5000);
  const skip = p.getByText(/skip tour/i).first();
  if (await skip.count()) { await skip.click().catch(()=>{}); await p.waitForTimeout(600); }
  const banner = await p.locator("text=/This is a read failure/").count();
  const submissions = await p.locator("text=/SUBMISSIONS/i").locator("xpath=..").textContent().catch(()=>"");
  await p.screenshot({ path: breakReads ? "scripts/out-eod-fail.png" : "scripts/out-eod-ok.png" });
  await b.close();
  return { banner: banner > 0, submissions: String(submissions).replace(/\s+/g," ").trim().slice(0, 40) };
}

const ok = await open(false);
console.log("normal read  -> banner:", ok.banner, "|", ok.submissions);
const bad = await open(true);
console.log("failed read  -> banner:", bad.banner, "|", bad.submissions);
console.log("");
console.log(bad.banner
  ? "PASS: a failed read now says so instead of reporting zeros."
  : "FAIL: a failed read still renders as an empty week.");
