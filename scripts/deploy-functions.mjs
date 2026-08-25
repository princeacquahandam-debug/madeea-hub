/**
 * Deploy every Edge Function this project owns, in one command.
 *
 *   1. Make a Personal Access Token: https://supabase.com/dashboard/account/tokens
 *   2. PowerShell:  $env:SUPABASE_ACCESS_TOKEN="sbp_..."
 *      bash/zsh:    export SUPABASE_ACCESS_TOKEN=sbp_...
 *   3. npm run deploy:functions
 *
 * WHY THIS EXISTS. Functions were going into the dashboard one at a time, and
 * that has already produced two real failures: two files pasted into a single
 * editor, and a function left running an older build for days while everyone
 * assumed it was current. Nothing in the dashboard shows which build is live,
 * so "I updated that one" and "I meant to" look identical from outside.
 *
 * WHY NODE AND NOT A SHELL SCRIPT. It was bash first, which fails on this
 * machine: bash is not on PATH in PowerShell, so the npm script died before it
 * started. Node is on PATH everywhere npm is, by definition.
 *
 * The access token is read from the environment and never written down here.
 */
import { execSync } from "node:child_process";
import { readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "supabase", "functions");
const PROJECT = process.env.SUPABASE_PROJECT_REF ?? "bglduxferbjmoeqzyypx";

/**
 * The four a provider redirects a browser into, with no session attached.
 * Verifying a JWT there would reject the callback AFTER the person has already
 * approved, which looks like the provider failing. They are still protected:
 * by a single-use state row, and in WhatsApp's case by an HMAC signature.
 */
const NO_JWT = new Set([
  "integration-oauth-callback",
  "google-oauth-callback",
  "microsoft-oauth-callback",
  "whatsapp-webhook",
]);

if (!process.env.SUPABASE_ACCESS_TOKEN) {
  console.error("SUPABASE_ACCESS_TOKEN is not set.\n");
  console.error("  1. Create one at https://supabase.com/dashboard/account/tokens");
  console.error('  2. PowerShell:  $env:SUPABASE_ACCESS_TOKEN="sbp_..."');
  console.error("     bash/zsh:    export SUPABASE_ACCESS_TOKEN=sbp_...");
  console.error("  3. npm run deploy:functions");
  process.exit(1);
}

const names = readdirSync(DIR).sort().filter((n) => existsSync(join(DIR, n, "index.ts")));
/* One name on the command line deploys just that one, for when a single
   function is being iterated on and thirty-four redeploys are noise. */
const wanted = process.argv.slice(2);
const list = wanted.length ? names.filter((n) => wanted.includes(n)) : names;

if (!list.length) {
  console.error(`Nothing matched. Known functions:\n  ${names.join("\n  ")}`);
  process.exit(1);
}

let failed = 0;
for (const name of list) {
  const noJwt = NO_JWT.has(name) ? " --no-verify-jwt" : "";
  process.stdout.write(`→ ${name}${noJwt ? "  (no JWT verification)" : ""}\n`);
  try {
    execSync(
      `npx --yes supabase@latest functions deploy ${name} --project-ref ${PROJECT}${noJwt}`,
      { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (e) {
    failed++;
    const detail = String(e.stderr ?? e.stdout ?? e.message).trim().split("\n").slice(-3);
    console.error(detail.map((l) => `    ${l}`).join("\n"));
  }
}

console.log(
  failed === 0
    ? `\n${list.length} function${list.length === 1 ? "" : "s"} deployed. What is live is now what is in the repo.\n`
    : `\n${failed} of ${list.length} failed to deploy.\n`,
);
process.exit(failed ? 1 : 0);
