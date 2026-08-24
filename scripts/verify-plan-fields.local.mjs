/**
 * The three controls Rio asked for, and the thing that must not break: the
 * value each one stores has to stay usable by the model and by the booker.
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
await p.goto("http://localhost:5174/quick-actions?action=Plan+the+Calendar", { waitUntil: "domcontentloaded" });
await p.waitForTimeout(4000);
const skip = p.getByText(/skip tour/i).first();
if (await skip.count()) { await skip.click().catch(()=>{}); await p.waitForTimeout(600); }

const dateType = await p.locator("#qa-date").getAttribute("type");
console.log("Which day is a picker :", dateType === "date", `(type=${dateType})`);

const outTag = await p.locator("#qa-output").evaluate((el) => el.tagName.toLowerCase());
const outList = await p.locator("#qa-output").getAttribute("list");
console.log("What you need is free :", outTag === "input", `(tag=${outTag}, datalist=${Boolean(outList)})`);
await p.locator("#qa-output").fill("Prep the Q3 board offsite");
console.log("  accepts free text   :", (await p.locator("#qa-output").inputValue()) === "Prep the Q3 board offsite");
await p.getByRole("button", { name: "Block focus time" }).click();
console.log("  preset button works :", (await p.locator("#qa-output").inputValue()) === "Block focus time");

const durType = await p.locator("#qa-duration").getAttribute("type");
console.log("How long is a slider  :", durType === "range", `(type=${durType})`);
const shown = async () => (await p.locator("#qa-duration").locator("xpath=../div[1]").textContent())?.replace(/\s+/g," ").trim();
console.log("  default             :", await shown());
await p.locator("#qa-duration").fill("5");
console.log("  dragged to stop 5   :", await shown());
await p.getByRole("button", { name: /^30m$/ }).click();
console.log("  30m chip            :", await shown());

// Set a date the way a person would, then confirm it flows to the booker.
await p.locator("#qa-date").fill("2026-08-26");
await p.locator("#qa-constraints").fill("Nothing booked. I want two deep work blocks.");
await p.screenshot({ path: "scripts/out-planfields.png" });

await p.getByRole("button", { name: /generate/i }).click();
await p.waitForSelector("text=/Proposed blocks|Nothing worth adding/", { timeout: 90000 });
await p.waitForTimeout(600);
const hdr = await p.locator("text=/Proposed blocks/").locator("xpath=..").textContent();
console.log("");
console.log("booker header         :", hdr?.replace(/\s+/g," ").trim().slice(0, 52));
const slots = await p.locator("li span.tabular-nums").allTextContents();
console.log("slots                 :", slots.map(t=>t.trim()).filter(Boolean).join("  |  "));
await b.close();
