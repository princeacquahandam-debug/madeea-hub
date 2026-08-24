/**
 * Can it actually book something, and does it refuse honestly when it cannot?
 *
 * Rio's connection currently holds calendar.readonly. That is the interesting
 * case: the button must say "reconnect and allow calendar changes" BEFORE
 * calling Google, not surface a raw 403 after.
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

// 1. The function's own answer, with the read-only token that exists today.
const r = await sb.functions.invoke("calendar-create-event", {
  body: {
    title: "Scope probe (should be refused)",
    startsAt: "2026-09-01T09:00:00.000Z",
    endsAt: "2026-09-01T09:30:00.000Z",
    timeZone: "Asia/Manila",
  },
});
const body = r.error?.context && typeof r.error.context.text === "function"
  ? await r.error.context.text() : JSON.stringify(r.data);
console.log("create with read-only token:", r.error?.context?.status ?? 200, body);

// 2. Validation, independent of scope.
const bad = await sb.functions.invoke("calendar-create-event", {
  body: { title: "", startsAt: "nope", endsAt: "nope", timeZone: "UTC" } });
const badBody = bad.error?.context && typeof bad.error.context.text === "function"
  ? await bad.error.context.text() : JSON.stringify(bad.data);
console.log("create with no title       :", bad.error?.context?.status ?? 200, badBody);

// 3. The UI.
const ref = new URL(env.VITE_SUPABASE_URL).host.split(".")[0];
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1400, height: 940 }, timezoneId: "America/Denver" });
await ctx.addInitScript(([k,v]) => { localStorage.setItem(k,v); localStorage.setItem("madeea-tour-done","1"); },
  [`sb-${ref}-auth-token`, JSON.stringify(sess.session)]);
const p = await ctx.newPage();
await p.goto("http://localhost:5174/calendar", { waitUntil: "networkidle" });
await p.waitForTimeout(4200);
const skip = p.getByText(/skip tour/i).first();
if (await skip.count()) { await skip.click().catch(()=>{}); await p.waitForTimeout(600); }

console.log("");
console.log("New event button   :", await p.getByRole("button", { name: /new event/i }).count() > 0);
console.log("Plan day button    :", await p.getByRole("button", { name: /plan day/i }).count() > 0);

await p.getByRole("button", { name: /new event/i }).click();
await p.waitForTimeout(900);
const warn = await p.locator(".text-amber-200").allTextContents();
console.log("dialog warning     :", warn.join(" | ").slice(0, 110) || "none");
const addBtn = p.getByRole("button", { name: /add to google calendar/i });
await p.locator("#ev-title").fill("Test");
await p.waitForTimeout(300);
console.log("Add button enabled :", await addBtn.isEnabled(), "(must be false while read-only)");
await p.screenshot({ path: "scripts/out-newevent.png" });

// 4. The nested-button fix: clicking a chip must open the event, not the day.
await p.keyboard.press("Escape");
await p.waitForTimeout(700);
console.log("Escape closed dialog:", await p.getByRole("dialog").count() === 0);
await p.keyboard.press("m");
await p.waitForTimeout(900);
const chip = p.locator("button", { hasText: "Team Meeting" }).first();
if (await chip.count()) {
  await chip.click();
  await p.waitForTimeout(900);
  const dialog = await p.getByRole("dialog").count();
  console.log("chip opens the event:", dialog > 0, dialog > 0 ? "(nested-button bug fixed)" : "(STILL BROKEN)");
  console.log("  has Plan this day :", await p.getByRole("button", { name: /plan this day/i }).count() > 0);
}
await b.close();
