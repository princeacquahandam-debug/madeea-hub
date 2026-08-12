/**
 * Apply every migration in order against a real Postgres before anybody pastes
 * one into the Supabase SQL editor.
 *
 *   npm run check:migrations
 *
 * Why this exists: migrations here are applied by hand, one paste at a time,
 * against the production database. A syntax error is found half way down that
 * paste, with the earlier statements already committed. This runs the whole
 * chain against PGlite (Postgres compiled to WASM, no Docker, no server) so
 * that class of mistake is caught on a laptop instead.
 *
 * What it proves: the DDL parses, applies in filename order, and does not
 * conflict with what came before it.
 *
 * What it does not prove: anything that depends on Supabase itself. The auth
 * and storage schemas below are stubs with only the columns these migrations
 * touch, real storage RLS is not modelled, and pgcrypto is absent (PGlite has
 * gen_random_uuid() in core, which is all we use it for). A pass here means
 * "the SQL is valid", not "the deploy is safe".
 *
 * If a migration fails only because a stub is missing a column, add the column
 * to the stub. That is a harness gap, not a migration bug.
 */
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), "..", "supabase", "migrations");

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

const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
let failed = 0;

for (const f of files) {
  const sql = readFileSync(join(DIR, f), "utf8");
  // Some migrations must be run as two separate statements because Postgres
  // will not use a new enum value in the transaction that adds it. Their
  // headers say so, and they mark the split with a "PART 2" banner.
  const parts = /^-- =+ PART 2/im.test(sql) ? sql.split(/^-- =+ PART 2.*$/im) : [sql];
  try {
    for (const p of parts) if (p.trim()) await db.exec(p);
    console.log(`  ok    ${f}${parts.length > 1 ? "   (run as 2 separate pastes)" : ""}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL  ${f}`);
    console.log(`        ${e.message.split("\n")[0]}`);
  }
}

console.log(`\n${files.length - failed}/${files.length} applied.`);
await db.close();
process.exit(failed ? 1 : 0);
