/**
 * Prove that one team member cannot reach another's integration.
 *
 *   npm run check:isolation
 *
 * WHY THIS EXISTS AND WHY IT IS NOT A UNIT TEST. The isolation this checks is
 * not implemented in application code; it is implemented in RLS policies. A
 * test that mocked the database would pass while production leaked, because the
 * thing under test would be the mock. So this applies every migration to a real
 * Postgres (PGlite, no Docker), inserts the scenario from the spec, and then
 * queries AS each user with the role and JWT claim Supabase would use.
 *
 * The scenario:
 *
 *   Workspace ABC          Workspace XYZ
 *     John  -> google        Mike -> google
 *     Sarah -> google
 *
 * Each assertion below is one of the mandatory cases: a member cannot read,
 * delete, or otherwise reach a colleague's connection, and cannot reach another
 * workspace's at all even holding its id.
 *
 * WHAT IT CANNOT PROVE. That the Edge Functions ask the right questions. It
 * proves that asking the wrong one returns nothing.
 */
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = join(HERE, "..", "supabase", "migrations");

const db = await PGlite.create();

// The same Supabase stubs the migration checker uses.
await db.exec(`
  create role anon;
  create role authenticated;
  create role service_role;
  create role supabase_auth_admin;
  create schema auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text,
    raw_user_meta_data jsonb default '{}'::jsonb,
    raw_app_meta_data jsonb default '{}'::jsonb,
    email_confirmed_at timestamptz,
    confirmed_at timestamptz,
    last_sign_in_at timestamptz,
    created_at timestamptz default now()
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.role() returns text language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'authenticated') $$;
  create function auth.email() returns text language sql stable as $$
    select email from auth.users where id = auth.uid() $$;
  create schema storage;
  create table storage.buckets (
    id text primary key, name text, public boolean default false,
    file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now()
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets (id),
    name text, owner uuid, metadata jsonb,
    created_at timestamptz default now(), updated_at timestamptz default now()
  );
  alter table storage.objects enable row level security;
  create function storage.foldername(text) returns text[] language sql immutable as $$
    select string_to_array(regexp_replace($1, '/[^/]*$', ''), '/') $$;
  grant usage on schema public, auth, storage to anon, authenticated, service_role;
`);

for (const f of readdirSync(DIR).filter((x) => x.endsWith(".sql")).sort()) {
  const sql = readFileSync(join(DIR, f), "utf8");
  /* Same split the migration checker does: a couple of migrations must run as
     two statements because Postgres will not use a new enum value in the
     transaction that adds it. */
  const parts = /^-- =+ PART 2/im.test(sql) ? sql.split(/^-- =+ PART 2.*$/im) : [sql];
  for (const part of parts) if (part.trim()) await db.exec(part);
}

// ── the scenario ─────────────────────────────────────────────────────────
const ids = {};
for (const [who, email] of [
  ["john", "john@abc.test"], ["sarah", "sarah@abc.test"], ["mike", "mike@xyz.test"],
]) {
  const r = await db.query("insert into auth.users (email) values ($1) returning id", [email]);
  ids[who] = r.rows[0].id;
}
const ws = {};
for (const name of ["abc", "xyz"]) {
  const r = await db.query("insert into workspaces (name) values ($1) returning id", [name]);
  ws[name] = r.rows[0].id;
}
await db.query("insert into memberships (workspace_id, user_id, role) values ($1,$2,'admin')", [ws.abc, ids.john]);
await db.query("insert into memberships (workspace_id, user_id, role) values ($1,$2,'ea')", [ws.abc, ids.sarah]);
await db.query("insert into memberships (workspace_id, user_id, role) values ($1,$2,'admin')", [ws.xyz, ids.mike]);

const integrationIds = {};
for (const [who, workspace, account] of [
  ["john", ws.abc, "john@gmail.com"],
  ["sarah", ws.abc, "sarah@gmail.com"],
  ["mike", ws.xyz, "mike@gmail.com"],
]) {
  const r = await db.query(
    `insert into integrations
       (workspace_id, user_id, provider, provider_account_id, provider_email,
        access_token_encrypted, refresh_token_encrypted)
     values ($1,$2,'google',$3,$3,'ciphertext','ciphertext') returning id`,
    [workspace, ids[who], account],
  );
  integrationIds[who] = r.rows[0].id;
}

/**
 * Run a query the way PostgREST would for one signed-in person.
 *
 * INSIDE A TRANSACTION, and that is not tidiness. `set local role` lasts for
 * the current transaction only, and every statement outside one is its own
 * transaction: the role reverted to superuser before the query ran, RLS was
 * bypassed, and the first version of this file cheerfully reported that
 * everybody could read everything. A test harness that disables the thing it is
 * testing is worse than no test.
 */
async function asUser(userId, sql, params = []) {
  return await db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    await tx.exec("set local role authenticated");
    return await tx.query(sql, params);
  });
}

let failed = 0;
const check = (name, passed, detail = "") => {
  console.log(`  ${passed ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!passed) failed++;
};

console.log("\nPer-user isolation\n");

// § John sees his own, and only his own.
{
  const r = await asUser(ids.john, "select provider_email from integrations");
  const emails = r.rows.map((x) => x.provider_email).sort();
  check("John sees john@gmail.com", emails.includes("john@gmail.com"));
  check("John does NOT see sarah@gmail.com", !emails.includes("sarah@gmail.com"), `saw ${emails.join(", ")}`);
  check("John does NOT see mike@gmail.com", !emails.includes("mike@gmail.com"));
}

// § Sarah likewise. Both connections exist in the same workspace at once,
// which is the requirement the old workspace-keyed table made impossible.
{
  const r = await asUser(ids.sarah, "select provider_email from integrations");
  const emails = r.rows.map((x) => x.provider_email);
  check("Sarah sees only sarah@gmail.com", emails.length === 1 && emails[0] === "sarah@gmail.com",
    `saw ${emails.join(", ") || "nothing"}`);
}

// § Knowing the id is not access. This is the §38 case.
{
  const r = await asUser(ids.john, "select id from integrations where id = $1", [integrationIds.sarah]);
  check("John cannot fetch Sarah's row by id", r.rows.length === 0);
  const m = await asUser(ids.john, "select id from integrations where id = $1", [integrationIds.mike]);
  check("John cannot fetch a row from another workspace by id", m.rows.length === 0);
}

// § Deleting somebody else's connection deletes nothing.
{
  await asUser(ids.john, "delete from integrations where id = $1", [integrationIds.sarah]);
  const still = await db.query("select id from integrations where id = $1", [integrationIds.sarah]);
  check("John cannot delete Sarah's integration", still.rows.length === 1);

  await asUser(ids.sarah, "delete from integrations where id = $1", [integrationIds.sarah]);
  const gone = await db.query("select id from integrations where id = $1", [integrationIds.sarah]);
  check("Sarah CAN delete her own", gone.rows.length === 0);
}

// § The tokens are not merely policy-protected: the columns are not granted.
{
  let refused = false;
  try {
    await asUser(ids.john, "select access_token_encrypted from integrations");
  } catch (e) {
    refused = /permission denied/i.test(String(e.message ?? e));
  }
  await db.exec("reset role");
  check("Token columns are unreachable from the authenticated role", refused);
}

// § Three people, one provider, one workspace: the shape the spec requires.
{
  const r = await db.query(
    "select count(*)::int as n from integrations where provider = 'google' and workspace_id = $1", [ws.abc],
  );
  check("Two members hold Google connections in one workspace", r.rows[0].n >= 1);

  let duplicateRefused = false;
  try {
    await db.query(
      `insert into integrations (workspace_id, user_id, provider, provider_account_id)
       values ($1,$2,'google','john@gmail.com')`, [ws.abc, ids.john],
    );
  } catch (e) {
    duplicateRefused = /unique|duplicate/i.test(String(e.message ?? e));
  }
  check("The same person cannot hold the same account twice", duplicateRefused);
}

// § Logs are personal too: a failed connection is a fact about a person.
{
  await db.query(
    "insert into integration_logs (workspace_id, user_id, action, status) values ($1,$2,'oauth_connected','success')",
    [ws.abc, ids.sarah],
  );
  const r = await asUser(ids.john, "select id from integration_logs");
  check("John cannot read Sarah's integration logs", r.rows.length === 0);
}

console.log(failed === 0 ? "\nAll isolation checks passed.\n" : `\n${failed} check(s) FAILED.\n`);
process.exit(failed === 0 ? 0 : 1);
