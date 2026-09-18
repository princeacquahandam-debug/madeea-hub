/**
 * Everything the app calls actually exists.
 *
 *   npm run check:wiring
 *
 * WHY THIS EXISTS. Supabase calls are strings. `.from("client_dyas")`,
 * `.rpc("client_save_plann")` and `functions.invoke("delegation-coah")` all
 * compile, pass the type checker, build, deploy, and fail at the moment a
 * person clicks the thing. TypeScript cannot help: the name is data.
 *
 * That failure is also quiet in the worst way. A missing table returns an error
 * object rather than throwing, and half this codebase deliberately treats a
 * failed read as "nothing here yet" so a not-yet-migrated database degrades
 * instead of crashing. Which means a typo and an empty account look identical
 * on screen.
 *
 * So this reads every string the app passes to from(), rpc() and
 * functions.invoke(), applies every migration to PGlite, and asks Postgres
 * whether each one is real.
 *
 * WHAT IT CANNOT TELL YOU. Whether production has actually had the migrations
 * pasted into it. This proves the repo is internally consistent -- that the code
 * and the migrations agree -- not that the live database is up to date. Those
 * are different questions and only the verify-XXXX.sql files answer the second.
 */
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");
const MIGRATIONS = join(ROOT, "supabase", "migrations");
const FUNCTIONS = join(ROOT, "supabase", "functions");

/** Names built at runtime rather than written down, which this cannot resolve. */
const DYNAMIC = new Set(["", "undefined"]);

/**
 * Invoked, deliberately absent, and handled. The call sites wrap these in a
 * try/catch with a working fallback, so the feature degrades rather than
 * breaks. Listed here so the check stays honest about the difference between
 * "not deployed yet, by design" and "somebody typed it wrong".
 */
const OPTIONAL_FUNCTIONS = new Map([
  ["meeting-prep", "src/lib/ai.ts falls back to a deterministic brief composed from the same context"],
]);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(p);
  }
  return out;
}

const files = walk(SRC);
const tables = new Map();   // name -> [file]
const rpcs = new Map();
const invokes = new Map();

const add = (map, name, file) => {
  if (DYNAMIC.has(name)) return;
  if (!map.has(name)) map.set(name, []);
  const rel = file.slice(ROOT.length + 1).replace(/\\/g, "/");
  if (!map.get(name).includes(rel)) map.get(name).push(rel);
};

for (const f of files) {
  const s = readFileSync(f, "utf8");
  for (const m of s.matchAll(/\.from\(\s*["'`]([a-zA-Z0-9_]+)["'`]\s*\)/g)) add(tables, m[1], f);
  for (const m of s.matchAll(/\.rpc\(\s*["'`]([a-zA-Z0-9_]+)["'`]/g))        add(rpcs, m[1], f);
  for (const m of s.matchAll(/functions\.invoke\(\s*["'`]([a-zA-Z0-9_-]+)["'`]/g)) add(invokes, m[1], f);
}

// ---------------------------------------------------------------- the schema
const db = await PGlite.create();
await db.exec(`
  create role anon; create role authenticated; create role service_role; create role supabase_auth_admin;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text,
    raw_user_meta_data jsonb default '{}'::jsonb, raw_app_meta_data jsonb default '{}'::jsonb,
    email_confirmed_at timestamptz, confirmed_at timestamptz, last_sign_in_at timestamptz,
    created_at timestamptz default now());
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'authenticated') $$;
  create function auth.email() returns text language sql stable as $$ select email from auth.users where id = auth.uid() $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean default false,
    file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now());
  create table storage.objects (id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets(id), name text, owner uuid, metadata jsonb,
    created_at timestamptz default now(), updated_at timestamptz default now());
  alter table storage.objects enable row level security;
  create function storage.foldername(text) returns text[] language sql immutable as $$
    select string_to_array(regexp_replace($1, '/[^/]*$', ''), '/') $$;
  grant usage on schema public, auth, storage to anon, authenticated, service_role;
`);

for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql")).sort()) {
  const sql = readFileSync(join(MIGRATIONS, f), "utf8");
  const parts = /^-- =+ PART 2/im.test(sql) ? sql.split(/^-- =+ PART 2.*$/im) : [sql];
  for (const p of parts) if (p.trim()) await db.exec(p);
}

const { rows: relRows } = await db.query(
  `select table_name as n from information_schema.tables where table_schema = 'public'
   union select table_name from information_schema.views where table_schema = 'public'`,
);
const relations = new Set(relRows.map((r) => r.n));

const { rows: fnRows } = await db.query(
  `select p.proname as n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public'`,
);
const functions = new Set(fnRows.map((r) => r.n));

const deployed = existsSync(FUNCTIONS)
  ? new Set(readdirSync(FUNCTIONS).filter((n) => existsSync(join(FUNCTIONS, n, "index.ts"))))
  : new Set();

/* THERE WAS A NO_JWT CHECK HERE, AND IT WAS WRONG. It asserted that every
   browser-invoked function must be deployed with JWT verification off, reading
   that rule off the headers of invite-member and invite-client. Eighteen
   functions -- gmail-sync, slack-send, calendar-sync and the rest -- are called
   from the browser, are not on that list, and work in production. So the rule
   does not generalise, and a check that fails on eighteen working features is
   worse than no check: it trains people to ignore the output. Left as a note
   because the wrong version looked plausible enough that somebody will think of
   it again. */

// ------------------------------------------------------------------- results
let failed = 0;
const report = (label, map, has, hint) => {
  const missing = [...map.entries()].filter(([n]) => !has(n));
  if (missing.length === 0) {
    console.log(`  ok    ${map.size} ${label}, all present`);
    return;
  }
  failed += missing.length;
  for (const [n, where] of missing) {
    console.log(`  FAIL  ${label.replace(/s$/, "")} "${n}" ${hint}`);
    console.log(`          called from ${where.join(", ")}`);
  }
};

console.log("\nWHAT THE APP READS AND WRITES:");
report("tables and views", tables, (n) => relations.has(n), "does not exist in any migration");
report("database functions", rpcs, (n) => functions.has(n), "is not defined in any migration");
report(
  "edge functions",
  new Map([...invokes].filter(([n]) => !OPTIONAL_FUNCTIONS.has(n))),
  (n) => deployed.has(n),
  "has no supabase/functions/<name>/index.ts",
);

for (const [n, why] of OPTIONAL_FUNCTIONS) {
  if (!invokes.has(n)) continue;
  console.log(deployed.has(n)
    ? `  ok    ${n} is optional and now deployed`
    : `  note  ${n} is not deployed, by design. ${why}`);
}

console.log(
  failed
    ? `\n${failed} wiring problem(s). The app calls something that is not there.`
    : "\nEverything the app calls exists.",
);
await db.close();
process.exit(failed ? 1 : 0);
