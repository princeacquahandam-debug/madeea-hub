/**
 * Does 0061 actually give each person the roster's spelling of their name, and
 * does it collapse a report already filed under the wrong one?
 *
 * Run against a real Postgres (PGlite), not a mock: the whole thing is SQL.
 */
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(process.cwd(), "supabase", "migrations");
const db = await PGlite.create();

await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create role supabase_auth_admin;
  create schema auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(), email text,
    raw_user_meta_data jsonb default '{}'::jsonb, raw_app_meta_data jsonb default '{}'::jsonb,
    email_confirmed_at timestamptz, confirmed_at timestamptz,
    last_sign_in_at timestamptz, created_at timestamptz default now()
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.role() returns text language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'authenticated') $$;
  create function auth.email() returns text language sql stable as $$
    select email from auth.users where id = auth.uid() $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean default false,
    file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now());
  create table storage.objects (id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets (id), name text, owner uuid, metadata jsonb,
    created_at timestamptz default now(), updated_at timestamptz default now());
  alter table storage.objects enable row level security;
  create function storage.foldername(text) returns text[] language sql immutable as $$
    select string_to_array(regexp_replace($1, '/[^/]*$', ''), '/') $$;
  grant usage on schema public, auth, storage to anon, authenticated, service_role;
`);

for (const f of readdirSync(DIR).filter((x) => x.endsWith(".sql")).sort()) {
  const sql = readFileSync(join(DIR, f), "utf8");
  const parts = /^-- =+ PART 2/im.test(sql) ? sql.split(/^-- =+ PART 2.*$/im) : [sql];
  for (const p of parts) if (p.trim()) await db.exec(p);
}

let failed = 0;
const check = (name, got, want) => {
  const ok = got === want;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${ok ? ` → ${got}` : ` → got "${got}", wanted "${want}"`}`);
  if (!ok) failed++;
};

console.log("\nThe resolver, on the addresses this team actually uses\n");
const CASES = [
  // The two in the screenshot.
  ["fj.caballes@madeeas.com", "FJ Caballes"],
  ["bryansumait.automate@gmail.com", "Bryan Sumait"],
  // The rest of the roster, so they never split when they submit.
  ["reich.rellora@madeeas.com", "Reichelle Rellora"],
  ["angelica.roma@madeeas.com", "Angelica Roma"],
  ["rio.castillo@madeeas.com", "Rio Castillo"],
  ["laura.esteban@madeeas.com", "Laura Esteban"],
  ["rowena.petran@madeeas.com", "Rowena Rose Petran"],
  // Genuinely ambiguous: different surname from the sheet. Must NOT guess.
  ["johncarlo.japitana@madeeas.com", "Johncarlo Japitana"],
  // Not on the roster at all: readable, never a raw local-part.
  ["someone.new@madeeas.com", "Someone New"],
];
for (const [addr, want] of CASES) {
  const r = await db.query("select canonical_person_name($1) as n", [addr]);
  check(addr, r.rows[0].n, want);
}

console.log("\nThe override, for the case the rules refuse\n");
await db.query(
  "insert into person_name_overrides (email, full_name) values ($1,$2) on conflict (email) do update set full_name = excluded.full_name",
  ["johncarlo.japitana@madeeas.com", "John Carlo Caintic"],
);
{
  const r = await db.query("select canonical_person_name($1) as n", ["johncarlo.japitana@madeeas.com"]);
  check("override wins over every rule", r.rows[0].n, "John Carlo Caintic");
}

console.log("\nA new account, through the real trigger\n");
{
  await db.query("insert into auth.users (email) values ($1)", ["fj.caballes@madeeas.com"]);
  const r = await db.query(
    "select p.full_name, p.initials from profiles p join auth.users u on u.id = p.id where u.email = $1",
    ["fj.caballes@madeeas.com"],
  );
  check("profile is named from the roster", r.rows[0]?.full_name, "FJ Caballes");
  check("initials follow the name", r.rows[0]?.initials, "FJ");
}

console.log("\nA name somebody typed is left alone\n");
{
  const u = await db.query("insert into auth.users (email) values ($1) returning id", ["rio.castillo@madeeas.com"]);
  await db.query("update profiles set full_name = 'Rio' where id = $1", [u.rows[0].id]);
  // Re-run the repair from 0061 §5 verbatim.
  await db.exec(`
    update profiles p
    set full_name = canonical_person_name(u.email)
    from auth.users u
    where u.id = p.id
      and canonical_person_name(u.email) is not null
      and canonical_person_name(u.email) <> p.full_name
      and (p.full_name = split_part(u.email, '@', 1)
           or p.full_name = pretty_name_from_email(u.email)
           or coalesce(trim(p.full_name), '') = '');
  `);
  const r = await db.query("select full_name from profiles where id = $1", [u.rows[0].id]);
  check("a hand-typed 'Rio' survives the repair", r.rows[0].full_name, "Rio");
}

console.log("\nReports already filed under the wrong name\n");
{
  const ws = await db.query("insert into workspaces (name) values ('t') returning id");
  const u = await db.query("insert into auth.users (email) values ($1) returning id", ["laura.esteban@madeeas.com"]);
  const wsId = ws.rows[0].id, uid = u.rows[0].id;
  await db.query("insert into memberships (workspace_id, user_id, role) values ($1,$2,'ea')", [wsId, uid]);

  /* The state the screenshot is in: a report filed while the profile was still
     called "laura.esteban". The trigger stamps the CURRENT profile name on
     write, so the wrong name has to be forced in to reproduce it. */
  await db.exec("alter table eod_reports disable trigger eod_canonical_person_trigger");
  await db.query(
    `insert into eod_reports (workspace_id, owner_id, person_name, report_date, done, submitted_at)
     values ($1,$2,'laura.esteban','2026-08-25',array['old work'], now() - interval '1 day')`,
    [wsId, uid],
  );
  await db.query(
    `insert into eod_reports (workspace_id, owner_id, person_name, report_date, done, submitted_at)
     values ($1,$2,'Laura Esteban','2026-08-25',array['the real one'], now())`,
    [wsId, uid],
  );
  await db.exec("alter table eod_reports enable trigger eod_canonical_person_trigger");

  await db.exec(`
    delete from eod_reports old
    using eod_reports keep, profiles pr
    where old.owner_id = pr.id
      and old.person_name <> pr.full_name
      and keep.person_name = pr.full_name
      and keep.report_date = old.report_date
      and keep.workspace_id is not distinct from old.workspace_id
      and keep.id <> old.id
      and coalesce(keep.submitted_at, 'epoch'::timestamptz) >= coalesce(old.submitted_at, 'epoch'::timestamptz);
    update eod_reports e set person_name = pr.full_name
    from profiles pr
    where e.owner_id = pr.id and coalesce(trim(pr.full_name), '') <> '' and e.person_name <> pr.full_name;
  `);

  const r = await db.query(
    "select person_name, done from eod_reports where owner_id = $1 order by person_name", [uid],
  );
  check("one row survives, not two", String(r.rows.length), "1");
  check("under the roster name", r.rows[0]?.person_name, "Laura Esteban");
  check("and it is the newer submission", String(r.rows[0]?.done), "the real one");
}

console.log(failed === 0 ? "\nAll name checks passed.\n" : `\n${failed} FAILED\n`);
process.exit(failed === 0 ? 0 : 1);
