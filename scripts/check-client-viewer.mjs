/**
 * A viewer may look, and may do nothing else.
 *
 *   npm run check:client-viewer
 *
 * WHY A TEST AND NOT A READING. 0074 splits one client account into two kinds
 * of person, and the difference is enforced in four separate places: two RPCs,
 * one conversation function, and the pages that hide the controls. Four places
 * is four chances for one of them to be edited back. The UI half especially:
 * hiding a compose box is a rendering decision somebody could undo in a commit
 * that never mentions clients.
 *
 * So this signs in as an actual viewer -- a real JWT claim, through RLS -- and
 * tries the things a viewer must not be able to do.
 */
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

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
  create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now());
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner uuid, metadata jsonb, created_at timestamptz default now(), updated_at timestamptz default now());
  alter table storage.objects enable row level security;
  create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array(regexp_replace($1, '/[^/]*$', ''), '/') $$;
  grant usage on schema public, auth, storage to anon, authenticated, service_role;
`);
for (const f of readdirSync("supabase/migrations").filter(n => n.endsWith(".sql")).sort()) {
  const sql = readFileSync(join("supabase/migrations", f), "utf8");
  const parts = /^-- =+ PART 2/im.test(sql) ? sql.split(/^-- =+ PART 2.*$/im) : [sql];
  for (const p of parts) if (p.trim()) await db.exec(p);
}

/* Supabase grants these to `authenticated` by default, and the migrations rely
   on that -- they add RLS policies without re-granting. Without it every query
   below fails on privileges before RLS is consulted, and the test would "pass"
   for entirely the wrong reason. */
await db.exec(`
  grant select, insert, update, delete on all tables in schema public to authenticated;
  grant usage, select on all sequences in schema public to authenticated;
`);

const BOSS = "11111111-1111-1111-1111-111111111111";
const PRIMARY = "22222222-2222-2222-2222-222222222222";
const VIEWER = "99999999-9999-9999-9999-999999999999";
const MEMBER = "88888888-8888-8888-8888-888888888888";
const MEMBER2 = "77777777-7777-7777-7777-777777777777";
const WS = "33333333-3333-3333-3333-333333333333";
const CLIENT = "55555555-5555-5555-5555-555555555555";

await db.exec(`
  insert into auth.users (id,email) values
   ('${BOSS}','boss@agency.com'), ('${PRIMARY}','founder@breakaway.com'), ('${VIEWER}','ops@breakaway.com'),
   ('${MEMBER}','coach@breakaway.com'), ('${MEMBER2}','other@breakaway.com');
  insert into workspaces (id,name) values ('${WS}','MadeEA');
  insert into memberships (user_id,workspace_id,role) values ('${BOSS}','${WS}','owner');
  insert into clients (id,owner_id,workspace_id,name,lead_ea_id) values ('${CLIENT}','${BOSS}','${WS}','Breakaway Hoops','${BOSS}');
  insert into client_users (user_id,client_id,workspace_id,role) values
   ('${PRIMARY}','${CLIENT}','${WS}','primary'),
   ('${VIEWER}','${CLIENT}','${WS}','viewer'),
   ('${MEMBER}','${CLIENT}','${WS}','member'),
   ('${MEMBER2}','${CLIENT}','${WS}','member');
  -- 0065 opens both channels by trigger when the client row lands, so there is
  -- nothing to insert here. Inserting them was a duplicate-key error, which is
  -- the trigger proving it works.
  insert into tasks (workspace_id,client_id,owner_id,title) values ('${WS}','${CLIENT}','${BOSS}','Rebook the calls');
`);

async function as(uid, sql) {
  await db.exec(`set local role authenticated; set local request.jwt.claim.sub = '${uid}'; set local request.jwt.claim.role = 'authenticated';`);
  return db.query(sql);
}

let failed = 0;
const ok = (m) => console.log(`  ok    ${m}`);
const bad = (m) => { failed++; console.log(`  FAIL  ${m}`); };

async function mustThrow(uid, sql, label) {
  try { await db.transaction(async (t) => {
      await t.exec(`set local role authenticated; set local request.jwt.claim.sub = '${uid}'; set local request.jwt.claim.role = 'authenticated';`);
      await t.query(sql);
    });
    bad(`${label} -- it was ALLOWED`);
  } catch { ok(label); }
}
async function mustReturn(uid, sql, n, label) {
  const r = await db.transaction(async (t) => {
    await t.exec(`set local role authenticated; set local request.jwt.claim.sub = '${uid}'; set local request.jwt.claim.role = 'authenticated';`);
    return t.query(sql);
  });
  if (r.rows.length === n) ok(`${label} (${n} rows)`); else bad(`${label} -- got ${r.rows.length}, expected ${n}`);
}

console.log("\nA VIEWER MAY READ:");
await mustReturn(VIEWER, `select * from client_tasks`, 1, "sees the account tasks");
await mustReturn(VIEWER, `select * from client_calendar`, 0, "sees the calendar view");
await mustReturn(VIEWER, `select * from client_people`, 4, "sees who else holds a login");

console.log("\nA VIEWER MAY NOT ACT:");
await mustThrow(VIEWER, `select client_create_task('Do this for me')`, "cannot request a task");
await mustThrow(VIEWER, `select client_create_note('t','body')`, "cannot leave a note");
await mustReturn(VIEWER, `select * from conversations`, 0, "cannot see either channel");
await mustReturn(VIEWER, `select * from conversation_messages`, 0, "cannot read any message");

console.log("\nTHE PRIMARY CLIENT IS UNAFFECTED:");
await mustReturn(PRIMARY, `select * from conversations`, 2, "still sees both channels");
const t = await db.transaction(async (tx) => {
  await tx.exec(`set local role authenticated; set local request.jwt.claim.sub = '${PRIMARY}'; set local request.jwt.claim.role = 'authenticated';`);
  return tx.query(`select client_create_task('Chase the invoice') as id`);
});
t.rows[0].id ? ok("still requests tasks") : bad("primary could not request a task");

console.log("\nMANAGING PEOPLE:");
await mustThrow(VIEWER, `select client_remove_viewer('ops@breakaway.com')`, "a viewer cannot remove anybody");
await mustThrow(PRIMARY, `select client_remove_viewer('founder@breakaway.com')`, "a primary cannot remove a primary");
await mustThrow(PRIMARY, `select client_remove_viewer('nobody@nowhere.com')`, "removing an unknown address fails");

/* The email column is the one thing client_people shows conditionally, and a
   conditional column is exactly the kind that gets simplified away later. */
const seenByViewer = await db.transaction(async (t) => {
  await t.exec(`set local role authenticated; set local request.jwt.claim.sub = '${VIEWER}'; set local request.jwt.claim.role = 'authenticated';`);
  return t.query(`select email from client_people`);
});
seenByViewer.rows.every((r) => r.email === null)
  ? ok("a viewer sees no addresses in client_people")
  : bad("a viewer can read colleague addresses");

const seenByPrimary = await db.transaction(async (t) => {
  await t.exec(`set local role authenticated; set local request.jwt.claim.sub = '${PRIMARY}'; set local request.jwt.claim.role = 'authenticated';`);
  return t.query(`select email from client_people`);
});
seenByPrimary.rows.every((r) => r.email)
  ? ok("the primary sees who is on their account")
  : bad("the primary cannot see their own people");

// And the removal must actually work when it is allowed.
const removed = await db.transaction(async (t) => {
  await t.exec(`set local role authenticated; set local request.jwt.claim.sub = '${PRIMARY}'; set local request.jwt.claim.role = 'authenticated';`);
  return t.query(`select client_remove_viewer('ops@breakaway.com') as gone`);
});
removed.rows[0].gone ? ok("the primary can remove a viewer") : bad("the primary could not remove a viewer");


console.log("\nA TEAM MEMBER WORKS, AND ONLY ON THEIR OWN WORK:");

const assigned = await db.transaction(async (tx) => {
  await tx.exec(`set local role authenticated; set local request.jwt.claim.sub = '${PRIMARY}'; set local request.jwt.claim.role = 'authenticated';`);
  return tx.query(`select client_create_team_task('Run the Tuesday session','coach@breakaway.com') as id`);
});
const TASK = assigned.rows[0].id;
TASK ? ok("the client can assign work to a member") : bad("the client could not assign work");

await mustReturn(MEMBER, `select * from client_my_tasks`, 1, "the member sees the task assigned to them");
await mustReturn(MEMBER2, `select * from client_my_tasks`, 0, "another member sees none of it");
await mustThrow(PRIMARY, `select client_create_team_task('x','nobody@nowhere.com')`, "assigning to a stranger fails");
await mustThrow(VIEWER, `select client_create_team_task('x','coach@breakaway.com')`, "a viewer cannot assign work");

const clocked = await db.transaction(async (tx) => {
  await tx.exec(`set local role authenticated; set local request.jwt.claim.sub = '${MEMBER}'; set local request.jwt.claim.role = 'authenticated';`);
  return tx.query(`select client_clock_in() as id`);
});
clocked.rows[0].id ? ok("a member can clock in") : bad("a member could not clock in");

await mustThrow(MEMBER, `select client_clock_in()`, "cannot clock in twice");
await mustThrow(VIEWER, `select client_clock_in()`, "a viewer cannot clock in");
await mustThrow(PRIMARY, `select client_clock_in()`, "the client cannot clock in as their own staff");

await mustReturn(MEMBER, `select * from client_my_time`, 1, "the member sees their own shift");
await mustReturn(MEMBER2, `select * from client_my_time`, 0, "another member does not see it");
await mustReturn(PRIMARY, `select * from client_team_time`, 1, "the client sees the team timesheet");
await mustReturn(VIEWER, `select * from client_team_time`, 0, "a viewer sees no timesheet");

const moved = await db.transaction(async (tx) => {
  await tx.exec(`set local role authenticated; set local request.jwt.claim.sub = '${MEMBER}'; set local request.jwt.claim.role = 'authenticated';`);
  return tx.query(`select client_member_set_status('${TASK}','in_progress') as done`);
});
moved.rows[0].done ? ok("a member can move their own task along") : bad("a member could not update their task");
await mustThrow(MEMBER2, `select client_member_set_status('${TASK}','done')`, "cannot touch another member's task");

await mustReturn(MEMBER, `select * from conversations`, 0, "a member cannot see the client channels");

console.log("");
console.log(failed ? failed + " rule(s) broken." : "Client, member and viewer rules all hold.");
await db.close();
process.exit(failed ? 1 : 0);
