/**
 * A stray click beside a dialog must not throw away what was typed in it.
 *
 * The distinction that matters: a dialog that OPENS prefilled is not dirty. If
 * prefilled counted as unsaved work, every planner and every composer would
 * refuse to close, people would learn to click through the warning, and the one
 * time it mattered they would click through that too.
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
const ctx = await b.newContext({ viewport: { width: 1400, height: 940 } });
await ctx.addInitScript(([k,v]) => { localStorage.setItem(k,v); localStorage.setItem("madeea-tour-done","1"); },
  [`sb-${ref}-auth-token`, JSON.stringify(sess.session)]);
const p = await ctx.newPage();

async function openPlanner() {
  await p.goto("http://localhost:5174/quick-actions?action=Plan+the+Calendar", { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(3500);
  const skip = p.getByText(/skip tour/i).first();
  if (await skip.count()) { await skip.click().catch(()=>{}); await p.waitForTimeout(500); }
}
const isOpen = async () => (await p.locator("text=Find times, protect focus blocks").count()) > 0;

// 1. Untouched dialog: an outside click should still just close it.
await openPlanner();
await p.mouse.click(80, 500);
await p.waitForTimeout(700);
console.log("untouched + outside click -> closed:", !(await isOpen()), "(expected true)");

// 2. Typed into: an outside click must NOT close it.
await openPlanner();
await p.locator("#qa-constraints").fill("Board offsite prep, do not lose this");
await p.mouse.click(80, 500);
await p.waitForTimeout(700);
const stillOpen = await isOpen();
const kept = await p.locator("#qa-constraints").inputValue().catch(()=>"");
console.log("typed + outside click     -> still open:", stillOpen, "| text kept:", JSON.stringify(kept.slice(0, 22)));
console.log("nudge shown               :", (await p.locator("text=/Your changes are still here/").count()) > 0);

// 3. Escape on a dirty dialog asks rather than discarding.
await p.keyboard.press("Escape");
await p.waitForTimeout(600);
console.log("Escape on dirty           -> asks:", (await p.locator("text=/You have unsaved changes/").count()) > 0,
            "| still open:", await isOpen());

// 4. Keep editing returns you to the form with the text intact.
await p.getByRole("button", { name: /keep editing/i }).click();
await p.waitForTimeout(400);
console.log("Keep editing              -> text intact:",
            (await p.locator("#qa-constraints").inputValue()) === "Board offsite prep, do not lose this");

// 5. Discard actually closes.
await p.keyboard.press("Escape");
await p.waitForTimeout(500);
await p.getByRole("button", { name: /^Discard$/ }).click();
await p.waitForTimeout(700);
console.log("Discard                   -> closed:", !(await isOpen()), "(expected true)");

// 6. A PREFILLED dialog that was never edited must not nag.
await p.goto("http://localhost:5174/quick-actions?" + new URLSearchParams({
  action: "Plan the Calendar", output: "Reorder today", date: "2026-08-26",
  constraints: "Prefilled by the calendar",
}), { waitUntil: "domcontentloaded" });
await p.waitForTimeout(3500);
await p.mouse.click(80, 500);
await p.waitForTimeout(700);
console.log("prefilled, untouched      -> closed:", !(await isOpen()), "(expected true: prefill is not an edit)");

await p.screenshot({ path: "scripts/out-guard.png" });
await b.close();
