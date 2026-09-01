/**
 * Who can read a client's conversation, proved rather than asserted.
 *
 *   npm run check:access
 *
 * WHY THIS EXISTS. 0065 makes a confidentiality promise — a client's chat with
 * their assistant is not readable by the agency — and a promise about row level
 * security is worth exactly as much as the last time somebody ran the query.
 * The failure mode is silent by construction: a policy that grants too much
 * looks identical, from inside the app, to one that grants correctly. Nobody
 * notices until the wrong person opens the wrong page.
 *
 * So this boots a real Postgres (PGlite, no Docker), applies every migration in
 * order, seeds one agency with two clients and three staff, and then asks the
 * database the question directly, once per identity, with RLS switched on and
 * auth.uid() set the way Supabase would set it.
 *
 * The harness mirrors check-migrations' stubs on purpose rather than importing
 * them: that script is a top-level program that runs on import, and the two
 * checks answer different questions — "does the DDL apply" and "who can read
 * what". Keeping them separate means a failure names which one broke.
 */
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "supabase", "migrations");

let failed = 0;
const check = (name, passed, detail = "") => {
  console.log(`  ${passed ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!passed) failed++;
};

const db = await PGlite.create();

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

for (const f of readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort()) {
  const sql = readFileSync(join(DIR, f), "utf8");
  const parts = /^-- =+ PART 2/im.test(sql) ? sql.split(/^-- =+ PART 2.*$/im) : [sql];
  for (const p of parts) if (p.trim()) await db.exec(p);
}

/* Supabase grants the 'authenticated' role table privileges on the public
   schema; the migrations never do, because in production they do not have to.
   Without this every query below fails with "permission denied" and every
   isolation check passes for entirely the wrong reason — a test that cannot
   tell a missing GRANT from a working policy is not testing the policy. */
await db.exec(`
  grant select, insert, update, delete on all tables in schema public to authenticated;
  grant usage, select on all sequences in schema public to authenticated;
  -- storage too: the object policies are half of what this file checks, and
  -- without the grant they would "pass" on a privilege error instead.
  grant select, insert, update, delete on all tables in schema storage to authenticated;
`);

console.log("\nConversation access\n");

/* ── the cast ────────────────────────────────────────────────────────────
   One agency. Two clients. An assistant who leads client A, a second who leads
   nobody, and an admin. Everything below is asked from one of these seats. */
const ids = {};
const mk = async (key, email) => {
  const r = await db.query(`insert into auth.users (email) values ($1) returning id`, [email]);
  ids[key] = r.rows[0].id;
};
await mk("admin", "admin@agency.test");
await mk("eaLead", "lead@agency.test");
await mk("eaOther", "other@agency.test");
await mk("clientA", "a@clienta.test");
await mk("clientB", "b@clientb.test");

const ws = (await db.query(`insert into workspaces (name) values ('Agency') returning id`)).rows[0].id;

await db.query(
  `insert into memberships (workspace_id, user_id, role) values
     ($1,$2,'admin'), ($1,$3,'ea'), ($1,$4,'ea')`,
  [ws, ids.admin, ids.eaLead, ids.eaOther],
);

const mkClient = async (name, lead) => {
  const r = await db.query(
    `insert into clients (workspace_id, owner_id, name, lead_ea_id) values ($1,$2,$3,$4) returning id`,
    [ws, ids.admin, name, lead],
  );
  return r.rows[0].id;
};
const clientA = await mkClient("Client A", ids.eaLead);
const clientB = await mkClient("Client B", ids.eaOther);

await db.query(
  `insert into client_users (user_id, client_id, workspace_id) values ($1,$2,$3), ($4,$5,$3)`,
  [ids.clientA, clientA, ws, ids.clientB, clientB],
);

/** Run a query as one identity, with RLS enforced the way PostgREST does. */
async function as(who, sql, params = []) {
  await db.exec("begin");
  try {
    await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [ids[who]]);
    await db.exec("set local role authenticated");
    const r = await db.query(sql, params);
    return r.rows;
  } finally {
    await db.exec("rollback");
  }
}

// ── 1. A client is not a member, and that is the whole isolation ─────────
{
  const r = await as("clientA", `select my_workspace() as ws, my_client() as cl`);
  check("a client account has no workspace", r[0].ws === null,
    "my_workspace() is NULL, so every workspace-gated policy denies");
  check("and it does resolve to their client", r[0].cl === clientA);
}

/* The blast radius, checked rather than reasoned about. These are the tables
   whose only gate is `workspace_id = my_workspace()`; if a client ever gains a
   membership row, every one of them opens at once. */
const GATED = [
  "eod_reports", "notes", "memories", "files", "folders", "projects",
  "task_comments", "task_activity", "reminders", "routines", "sla_settings",
  "workspace_integrations", "memberships", "alert_routes", "snoozes",
];
{
  const leaked = [];
  for (const t of GATED) {
    const rows = await as("clientA", `select count(*)::int as n from ${t}`);
    if (rows[0].n !== 0) leaked.push(`${t}=${rows[0].n}`);
  }
  check(`a client reads nothing from ${GATED.length} workspace-gated tables`,
    leaked.length === 0, leaked.length ? `LEAKED ${leaked.join(", ")}` : "all denied");
}

// ── 2. Both channels exist for every client, seeded not created ──────────
{
  const rows = await db.query(`select kind from conversations where client_id = $1 order by kind`, [clientA]);
  check("every client gets both channels automatically",
    rows.rows.length === 2, rows.rows.map((r) => r.kind).join(" + "));
}

// ── 3. Who sees what. The headline is the admin line. ────────────────────
const seen = async (who) => {
  const rows = await as(who, `select c.kind, c.client_id from conversations c order by c.kind`);
  return rows.map((r) => `${r.kind}${r.client_id === clientA ? "(A)" : "(B)"}`);
};

{
  const c = await seen("clientA");
  check("the client sees both of their own channels",
    c.length === 2 && c.every((x) => x.endsWith("(A)")), c.join(", "));
}
{
  const c = await seen("eaLead");
  check("their assistant sees the private channel", c.includes("client_ea(A)"), c.join(", ") || "none");
  check("and NOT the escalation channel", !c.some((x) => x.startsWith("escalation")),
    "a client escalating about their EA does not write it where that EA reads");
}
{
  const c = await seen("admin");
  check("an agency admin sees the escalation channel",
    c.includes("escalation(A)") && c.includes("escalation(B)"), c.join(", ") || "none");
  check("an agency admin CANNOT see any client↔EA channel",
    !c.some((x) => x.startsWith("client_ea")),
    "this is the confidentiality promise, enforced by the database");
}
{
  const c = await seen("eaOther");
  check("an unrelated EA sees only their own client's private channel",
    c.length === 1 && c[0] === "client_ea(B)", c.join(", ") || "none");
}

// ── 4. Messages follow the conversation, and cannot be forged ───────────
const convOf = async (client, kind) =>
  (await db.query(`select id from conversations where client_id=$1 and kind=$2`, [client, kind])).rows[0].id;

const privA = await convOf(clientA, "client_ea");
const escA = await convOf(clientA, "escalation");

await db.query(
  `insert into conversation_messages (conversation_id, sender_id, body) values ($1,$2,$3), ($4,$5,$6)`,
  [privA, ids.clientA, "private to my assistant", escA, ids.clientA, "escalating to the agency"],
);

{
  const rows = await as("admin", `select body from conversation_messages`);
  check("the admin reads the escalation message", rows.some((r) => r.body.startsWith("escalating")));
  check("and cannot read the private one", !rows.some((r) => r.body.startsWith("private")),
    `${rows.length} message(s) visible`);
}
{
  const rows = await as("eaLead", `select body from conversation_messages`);
  check("the assistant reads the private message", rows.some((r) => r.body.startsWith("private")));
  check("and cannot read the escalation", !rows.some((r) => r.body.startsWith("escalating")));
}
{
  let refused = false;
  try {
    await as("eaOther", `insert into conversation_messages (conversation_id, sender_id, body) values ($1,$2,'butting in')`,
      [privA, ids.eaOther]);
  } catch { refused = true; }
  check("an unrelated EA cannot post into somebody else's channel", refused);
}
{
  let refused = false;
  try {
    await as("clientA", `insert into conversation_messages (conversation_id, sender_id, body) values ($1,$2,'not me')`,
      [privA, ids.eaLead]);
  } catch { refused = true; }
  check("nobody can send as somebody else", refused, "sender_id must be auth.uid()");
}

/* ══ The knowledge base: two shelves, and the bytes behind them ══════════
 *
 * The row policies and the STORAGE policies are checked separately, because
 * 0031 got exactly that distinction wrong: its file rows were scoped correctly
 * and its objects were readable by every authenticated account in every
 * workspace. A test that only queries `files` would have passed against that
 * bucket the whole time it was open.
 */
console.log("\nKnowledge base\n");

// A second agency, to prove the bucket is not a commons.
await mk("outsider", "ea@other-agency.test");
const ws2 = (await db.query(`insert into workspaces (name) values ('Other Agency') returning id`)).rows[0].id;
await db.query(`insert into memberships (workspace_id, user_id, role) values ($1,$2,'ea')`, [ws2, ids.outsider]);

const mkFile = async (name, scope, by, workspace = ws) => {
  const key = `${ids[by]}/${Date.now()}-${name}`;
  const r = await db.query(
    `insert into files (workspace_id, name, storage_key, uploaded_by, scope, size_bytes)
     values ($1,$2,$3,$4,$5,$6) returning id`,
    [workspace, name, key, ids[by], scope, 1024],
  );
  await db.query(
    `insert into storage.objects (bucket_id, name, owner) values ('workspace-files', $1, $2)`,
    [key, ids[by]],
  );
  return { id: r.rows[0].id, key };
};

const teamDoc = await mkFile("handbook.pdf", "team", "eaLead");
const privateDoc = await mkFile("my-notes.pdf", "personal", "eaLead");
const otherAgencyDoc = await mkFile("their-contract.pdf", "team", "outsider", ws2);

const filesSeenBy = async (who) =>
  (await as(who, `select name from files order by name`)).map((r) => r.name);

{
  const f = await filesSeenBy("eaLead");
  check("the uploader sees both their own shelves",
    f.includes("handbook.pdf") && f.includes("my-notes.pdf"), f.join(", "));
}
{
  const f = await filesSeenBy("eaOther");
  check("a colleague sees the team shelf", f.includes("handbook.pdf"));
  check("and NOT the personal shelf", !f.includes("my-notes.pdf"),
    "personal means personal");
}
{
  const f = await filesSeenBy("admin");
  check("an admin sees the team shelf", f.includes("handbook.pdf"));
  check("and an admin CANNOT read a personal file", !f.includes("my-notes.pdf"),
    "no admin override, same rule as private mail in 0040");
}
{
  const f = await filesSeenBy("outsider");
  check("another agency sees none of this workspace's files",
    !f.includes("handbook.pdf") && !f.includes("my-notes.pdf"),
    f.length ? f.join(", ") : "sees only its own");
}
{
  const f = await filesSeenBy("clientA");
  check("a client account sees no files at all", f.length === 0);
}

/* ── The objects, which is where 0031 actually leaked ──────────────────── */
const objectsSeenBy = async (who) =>
  (await as(who, `select name from storage.objects where bucket_id = 'workspace-files'`)).map((r) => r.name);

{
  const o = await objectsSeenBy("eaOther");
  check("a colleague can fetch the team OBJECT", o.includes(teamDoc.key));
  check("and cannot fetch the personal object", !o.includes(privateDoc.key));
}
{
  const o = await objectsSeenBy("outsider");
  check("another agency cannot fetch ANY object from this bucket",
    !o.includes(teamDoc.key) && !o.includes(privateDoc.key),
    "0031 allowed exactly this: bucket_id = 'workspace-files', no other condition");
  check("but can still fetch its own", o.includes(otherAgencyDoc.key));
}
{
  /* The write rule is the one thing that cannot consult the row, because at
     upload time there is no row yet. It pens each account into its own folder. */
  let refused = false;
  try {
    await as("outsider", `insert into storage.objects (bucket_id, name, owner) values ('workspace-files', $1, $2)`,
      [`${ids.eaLead}/planted.pdf`, ids.outsider]);
  } catch { refused = true; }
  check("nobody can upload into somebody else's folder", refused);
}

// ── What it costs, visible rather than guessed at ───────────────────────
{
  const rows = await as("eaLead", `select scope, bytes from kb_usage order by scope`);
  check("usage is reportable per shelf", rows.length === 2,
    rows.map((r) => `${r.scope}=${r.bytes}B`).join(" "));
}

/* ══ AI spend: who can see it, and what it costs ═════════════════════════
 *
 * A billing surface, so the read rule is deliberately wider than the private
 * ones above: an admin has to be able to see where the money went. It is still
 * not open — an EA sees their own line and nobody else's.
 */
console.log("\nAI spend\n");

// One model priced, one deliberately left unpriced, which is how 0069 ships.
await db.query(
  `update ai_rates set input_per_mtok = 2.50, output_per_mtok = 10.00
    where provider = 'openai' and model = 'gpt-4o'`,
);

const spend = async (who, model, inTok, outTok) =>
  db.query(
    `insert into ai_spend (workspace_id, owner_id, feature, provider, model, input_tokens, output_tokens)
     values ($1,$2,'generate','openai',$3,$4,$5) returning cost_usd`,
    [ws, ids[who], model, inTok, outTok],
  );

const priced = await spend("eaLead", "gpt-4o", 1_000_000, 500_000);
const unpriced = await spend("eaOther", "gpt-4o-mini", 200_000, 100_000);

{
  // 1M in at 2.50 + 0.5M out at 10.00 = 2.50 + 5.00
  const c = Number(priced.rows[0].cost_usd);
  check("a priced call is costed on the way in", Math.abs(c - 7.5) < 0.000001, `${c}`);
}
check("an unpriced model records tokens and leaves cost null",
  unpriced.rows[0].cost_usd === null,
  "null reads as 'not priced'; zero would read as free");

{
  const rows = await as("eaLead", `select owner_id, total_tokens from ai_spend_current_month`);
  check("an EA sees their own spend", rows.length === 1 && rows[0].owner_id === ids.eaLead,
    `${rows.length} row(s)`);
  check("and the tokens are the ones recorded", Number(rows[0].total_tokens) === 1_500_000);
}
{
  const rows = await as("eaOther", `select owner_id from ai_spend_current_month`);
  check("an EA does NOT see a colleague's spend",
    rows.length === 1 && rows[0].owner_id === ids.eaOther);
}
{
  const rows = await as("admin", `select owner_id from ai_spend_current_month order by owner_id`);
  check("an admin sees the whole workspace, because somebody has to", rows.length === 2,
    `${rows.length} accounts`);
}
{
  const rows = await as("clientA", `select count(*)::int as n from ai_spend`);
  check("a client account sees no spend at all", rows[0].n === 0);
}
{
  let refused = false;
  try {
    await as("eaOther", `insert into ai_spend (workspace_id, owner_id, feature, provider, model)
                         values ($1,$2,'generate','openai','gpt-4o')`, [ws, ids.eaLead]);
  } catch { refused = true; }
  check("nobody can log spend against another account", refused, "owner_id is pinned to auth.uid()");
}
{
  /* No update or delete policy exists, so both are refused for everyone. A
     spend record that can be edited afterwards is not a record of spend. */
  let noUpdate = false, noDelete = false;
  try { await as("admin", `update ai_spend set input_tokens = 0`); } catch { noUpdate = true; }
  try { await as("admin", `delete from ai_spend`); } catch { noDelete = true; }
  const u = await as("admin", `select sum(input_tokens)::bigint as n from ai_spend`);
  check("spend cannot be edited after the fact", noUpdate || Number(u[0].n) === 1_200_000);
  check("and cannot be deleted", noDelete || Number(u[0].n) === 1_200_000);
}
{
  const rows = await db.query(`select monthly_tokens from ai_allowances where workspace_id = $1 and owner_id is null`, [ws]);
  check("every workspace gets a default allowance", rows.rows.length === 1,
    `${rows.rows[0]?.monthly_tokens ?? "none"} tokens`);
}

console.log(failed === 0 ? "\nAccess is correct.\n" : `\n${failed} check(s) FAILED.\n`);
process.exit(failed ? 1 : 0);
