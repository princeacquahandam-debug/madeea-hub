/**
 * Remove screenshot files that have no row.
 *
 * These four exist because a row was deleted with SQL instead of through the
 * screenshot-delete function. The function removes the image first and the row
 * second, precisely so this cannot happen; going round it left four pictures of
 * somebody's screen in the bucket that no query, filter or audit can reach.
 *
 * Run as the owner through the function, not with the service key directly, so
 * the sweep is itself recorded.
 */
import { createClient } from "@supabase/supabase-js";
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

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);

const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
const { error: authErr } = await sb.auth.signInWithPassword({
  email: EMAIL,
  password: PASSWORD,
});
if (authErr) { console.error("sign-in failed:", authErr.message); process.exit(1); }

const { data, error } = await sb.functions.invoke("screenshot-delete", {
  body: { action: "sweep_orphans" },
});
if (error) {
  const ctx = error.context;
  const body = ctx && typeof ctx.text === "function" ? await ctx.text() : "";
  console.error("sweep failed:", error.message, body);
  process.exit(1);
}
console.log("sweep result:", JSON.stringify(data));
