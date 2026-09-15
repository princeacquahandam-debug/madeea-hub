/**
 * Every migration survives the journey to the SQL editor.
 *
 *   npm run check:pasteable
 *
 * WHY THIS IS NOT PARANOIA. check-migrations proves a file is valid Postgres.
 * It cannot prove the file is valid Postgres AFTER a human has copied it out of
 * an editor, through a clipboard, into a browser textarea. That trip is how
 * these migrations actually reach production -- check-migrations says so in its
 * own header -- and three constructs are legal SQL that routinely do not
 * survive it:
 *
 *   ;  inside a string literal   Statement splitters in editors, admin panels
 *                                and migration runners cut on semicolons. The
 *                                good ones track quotes. Not all of them are
 *                                good, and the failure is a half statement with
 *                                an unterminated string, reported at a line
 *                                nowhere near the real one.
 *
 *   -- inside a string literal   Comment strippers cut the rest of the line.
 *                                The string is silently truncated, or the
 *                                closing quote is eaten and everything after it
 *                                becomes part of a string that never ends.
 *
 *   '' escaped apostrophes       Survive Postgres perfectly. Do not survive a
 *                                round trip through anything that unescapes
 *                                them: the string closes early, and the words
 *                                after it are parsed as SQL. A word in that
 *                                position is read as a table name, which is why
 *                                this class of failure shows up as the baffling
 *                                `relation "their" does not exist`.
 *
 * None of the three is ever necessary. A comment can be reworded. This check
 * costs a rewording and buys back the failure mode where a migration breaks
 * only in production, only when pasted, and reports the wrong line when it does.
 *
 * SCOPE. String literals only, and only outside dollar-quoted bodies -- a
 * function body is full of legitimate semicolons and is pasted as one opaque
 * block, so it is skipped.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "supabase", "migrations");

/**
 * Walk the file character by character, tracking what we are inside of, and
 * hand back every top-level string literal with the line it started on.
 *
 * Written as a scanner rather than a regular expression because the thing being
 * looked for is precisely the case where quoting is ambiguous, and a regex that
 * gets quoting wrong would fail at exactly the moment it matters.
 */
function topLevelStrings(sql) {
  const found = [];
  let i = 0;
  let line = 1;

  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (ch === "\n") { line++; i++; continue; }

    // Line comment: skip to the newline.
    if (ch === "-" && next === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }

    // Block comment: Postgres nests these, so count depth.
    if (ch === "/" && next === "*") {
      let depth = 1;
      i += 2;
      while (i < sql.length && depth > 0) {
        if (sql[i] === "\n") line++;
        if (sql[i] === "/" && sql[i + 1] === "*") { depth++; i += 2; continue; }
        if (sql[i] === "*" && sql[i + 1] === "/") { depth--; i += 2; continue; }
        i++;
      }
      continue;
    }

    // Dollar-quoted body: skip it whole, tag and all.
    if (ch === "$") {
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (tag) {
        const close = sql.indexOf(tag[0], i + tag[0].length);
        const body = sql.slice(i, close === -1 ? sql.length : close + tag[0].length);
        line += (body.match(/\n/g) ?? []).length;
        i = close === -1 ? sql.length : close + tag[0].length;
        continue;
      }
    }

    // A string literal. Doubled quotes inside it are an escape, not an end.
    if (ch === "'") {
      const startLine = line;
      let text = "";
      let escapes = 0;
      i++;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") { text += "''"; escapes++; i += 2; continue; }
        if (sql[i] === "'") { i++; break; }
        if (sql[i] === "\n") line++;
        text += sql[i];
        i++;
      }
      found.push({ text, line: startLine, escapes });
      continue;
    }

    i++;
  }

  return found;
}

/**
 * Already applied to production, and carrying one of these constructs.
 *
 * Recorded rather than rewritten. Editing an applied migration changes nothing
 * in the database -- the columns and comments are already there -- and it
 * destroys the record of what was actually run, which is the one thing a
 * migration file is for. They are listed so the check can be green on a clean
 * tree and fail on anything new.
 *
 * Note for anyone reading this after a paste failure: several of these shipped
 * without trouble, so these constructs are not a guaranteed break. They are a
 * known way for a paste to go wrong, worth not having, and free to avoid.
 */
const GRANDFATHERED = new Set([
  "0028_sop_recordings.sql",
  "0043_monitoring_core.sql",
  "0051_team_connections.sql",
  "0055_calendar_views.sql",
  "0058_per_user_integrations.sql",
  "0062_eod_name_never_from_client.sql",
  "0069_ai_spend.sql",
  "0072_client_proof_surface.sql",
]);

let failed = 0;
const files = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql") && !GRANDFATHERED.has(f))
  .sort();

for (const f of files) {
  const problems = [];
  for (const s of topLevelStrings(readFileSync(join(DIR, f), "utf8"))) {
    if (s.text.includes(";")) {
      problems.push([s.line, "a semicolon inside a string -- a statement splitter will cut here"]);
    }
    if (s.text.includes("--")) {
      problems.push([s.line, "a double dash inside a string -- a comment stripper will truncate it"]);
    }
    if (s.escapes > 0) {
      problems.push([s.line, `${s.escapes} escaped apostrophe(s) -- reword instead, these do not survive a round trip`]);
    }
  }

  if (problems.length) {
    failed++;
    console.log(`  FAIL  ${f}`);
    for (const [line, why] of problems) console.log(`        line ${line}: ${why}`);
  }
}

console.log(
  failed
    ? `\n${failed} migration(s) will not survive being pasted.`
    : `\nAll ${files.length} migrations are safe to paste.`,
);
process.exit(failed ? 1 : 0);
