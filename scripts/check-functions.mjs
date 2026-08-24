/**
 * Parse every Edge Function before anybody pastes one into the dashboard.
 *
 *   npm run check:functions
 *
 * WHY THIS EXISTS. Edge Functions are Deno and TypeScript, and nothing else in
 * this repo touches them: `tsc -b` covers src/ only, and the dashboard's own
 * check happens after you have pasted 300 lines and pressed Deploy. A missing
 * brace was found that way twice.
 *
 * WHAT IT PROVES. That each file parses as TypeScript. Not that it runs, not
 * that Deno's globals resolve, and not that the Supabase import is reachable:
 * esbuild is a parser here, not a type checker.
 */
import { execSync } from "node:child_process";
import { readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "supabase", "functions");
const nul = process.platform === "win32" ? "NUL" : "/dev/null";

let failed = 0;
for (const name of readdirSync(DIR).sort()) {
  const file = join(DIR, name, "index.ts");
  if (!existsSync(file)) continue;
  try {
    /* Through the shell, because npx on Windows is a .cmd and execFile will
       not run it. Quoted, because the repo lives under a path with a space. */
    execSync(`npx esbuild "${file}" --outfile=${nul}`, { stdio: "pipe" });
    console.log(`  ok    ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(String(e.stderr ?? e.message).split("\n").slice(0, 4).map((l) => `        ${l}`).join("\n"));
  }
}

console.log(`\n${failed === 0 ? "All functions parse." : `${failed} function(s) failed to parse.`}\n`);
process.exit(failed ? 1 : 0);
