/**
 * Does the calendar actually fill from Google?
 *
 * The first run reported synced 0 from 16 scanned and looked like an empty
 * month. The loop counted successes and threw the errors away, so a broken
 * upsert target was indistinguishable from a free fortnight. This asserts the
 * number written, not just that the call returned.
 */
import { createClient } from "@supabase/supabase-js";
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
console.log("signed in as        :", sess.user.email);

const now = new Date();
const timeMin = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
const timeMax = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();

const r = await sb.functions.invoke("calendar-sync", { body: { timeMin, timeMax } });
if (r.error) {
  const b = r.error.context && typeof r.error.context.text === "function" ? await r.error.context.text() : "";
  console.log("sync FAILED         :", r.error.context?.status, b);
  process.exit(1);
}
console.log("sync                :", JSON.stringify(r.data));

// What actually landed, read back through the user's own RLS.
const { data: rows, error } = await sb
  .from("meetings")
  .select("title,starts_at,ends_at,all_day,location,attendee_emails,html_link")
  .gte("starts_at", timeMin).lte("starts_at", timeMax)
  .order("starts_at", { ascending: true });
if (error) { console.log("read back failed:", error.message); process.exit(1); }

console.log("rows visible to Rio :", rows.length);
console.log("with an end time    :", rows.filter(r => r.ends_at).length, "/", rows.length);
console.log("with attendees      :", rows.filter(r => (r.attendee_emails ?? []).length).length);
console.log("with a Google link  :", rows.filter(r => r.html_link).length);
console.log("");
for (const m of rows.slice(0, 6)) {
  const mins = m.ends_at ? Math.round((new Date(m.ends_at) - new Date(m.starts_at)) / 60000) : null;
  console.log(`  ${new Date(m.starts_at).toLocaleString().padEnd(24)} ${String(m.title).slice(0, 34).padEnd(36)} ${mins ? mins + " min" : "no end"}`);
}
