/**
 * Nothing private reaches a client view.
 *
 *   npm run check:client-surface
 *
 * WHY THIS EXISTS. 0072 and 0073 are built on one rule: a client-facing view
 * lists its columns by name, so adding a column to `tasks` or `meetings` does
 * not publish it. That rule protects against the accident nobody is thinking
 * about — a migration six months from now adding `internal_rate` to tasks.
 *
 * It does NOT protect against somebody editing the view itself. A reasonable
 * person reading client_calendar could add `description` to it in thirty
 * seconds, believing they are helping a client see their own agenda, and
 * nothing in the repository would object. The headers explain why not to; a
 * header is not a test.
 *
 * So this applies every migration against PGlite exactly as check-migrations
 * does, then asks Postgres what columns the client views actually have, and
 * fails on any that must never be there. It reads the shipped schema, not the
 * SQL text, so it survives the view being rewritten, renamed through a
 * `create or replace`, or rebuilt from a different table.
 *
 * ADDING A COLUMN TO A CLIENT VIEW ON PURPOSE. Change BANNED below, in the same
 * commit, and say in the migration why the column is safe. That is the whole
 * point: it should take a deliberate edit in two places, not one.
 */
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = join(HERE, "..", "supabase", "migrations");

/**
 * Per view: the columns that would be a leak, and the reason, so a failure
 * explains itself rather than sending somebody back to the migration.
 */
const BANNED = {
  client_tasks: {
    notes: "the assistant's own working notes on the task",
    blocker_note: "why it is stuck, written for the agency",
    source_quote: "a verbatim line lifted from a meeting recording",
    attachments: "files attached for the agency's own use",
    assignee_id: "an auth user id; a client has no business resolving staff",
    owner_id: "same",
    workspace_id: "the agency's workspace, which a client must never learn",
    internal_rate: "if it is ever added, it must not land here",
  },
  client_days: {
    storage_path: "the screenshot itself — a monitor shows whoever else was on it",
    note: "time_entries.note is the assistant's own",
    owner_id: "an auth user id",
    workspace_id: "the agency's workspace",
    task_id: "links a session to a task row this view does not publish",
  },
  client_calendar: {
    attendee_emails: "other people's addresses, frequently from other accounts",
    organizer_email: "whose calendar this really is",
    description: "agenda notes written for the agency, not the client",
    html_link: "a Google event page the client cannot open, and which discloses the calendar",
    calendar_id: "which of the assistant's calendars this came from",
    response_status: "the assistant's own answer to an invitation",
    gcal_event_id: "an identifier in the assistant's Google account",
    owner_id: "an auth user id",
    workspace_id: "the agency's workspace",
  },
  client_notes: {
    pinned: "how the assistant organises their own list",
    owner_id: "an auth user id",
    workspace_id: "the agency's workspace",
  },
  client_delegation_plans: {
    created_by: "an auth user id",
    workspace_id: "the agency workspace",
    client_id: "they are the client, they do not need their own id",
  },
  client_delegation_assessments: {
    created_by: "an auth user id",
    workspace_id: "the agency workspace",
    client_id: "same",
  },
  client_delegation_follow_ups: {
    created_by: "an auth user id",
    workspace_id: "the agency workspace",
    client_id: "same",
  },
  client_overview: {
    lead_ea_id: "an auth user id; the name is published instead, deliberately",
    workspace_id: "the agency's workspace",
    notes: "the Vault's own notes on the account",
  },
};

/** Every client-facing view must filter on my_client(), or it publishes the lot. */
const MUST_SCOPE = Object.keys(BANNED);

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

for (const f of readdirSync(DIR).filter((n) => n.endsWith(".sql")).sort()) {
  const sql = readFileSync(join(DIR, f), "utf8");
  const parts = /^-- =+ PART 2/im.test(sql) ? sql.split(/^-- =+ PART 2.*$/im) : [sql];
  for (const p of parts) if (p.trim()) await db.exec(p);
}

let failed = 0;

for (const view of MUST_SCOPE) {
  const { rows: exists } = await db.query(
    `select 1 from pg_views where schemaname = 'public' and viewname = $1`,
    [view],
  );
  if (exists.length === 0) {
    failed++;
    console.log(`  FAIL  ${view} — no such view. It was dropped, or never applied.`);
    continue;
  }

  const { rows: cols } = await db.query(
    `select column_name from information_schema.columns
      where table_schema = 'public' and table_name = $1`,
    [view],
  );
  const published = cols.map((c) => c.column_name);

  const leaks = published.filter((c) => BANNED[view][c]);
  if (leaks.length) {
    failed++;
    for (const c of leaks) {
      console.log(`  FAIL  ${view}.${c} is published — ${BANNED[view][c]}`);
    }
  }

  /* The WHERE clause is the access rule for these views, because they run as
     their owner and read the underlying tables directly. One without it is not
     a narrower view of a client's data; it is every client's data. */
  const { rows: [{ definition }] } = await db.query(
    `select pg_get_viewdef($1::regclass, true) as definition`,
    [`public.${view}`],
  );
  if (!definition.includes("my_client()")) {
    failed++;
    console.log(`  FAIL  ${view} does not filter on my_client() — it publishes every client.`);
    continue;
  }

  if (!leaks.length) {
    console.log(`  ok    ${view} — ${published.length} columns, scoped to my_client()`);
  }
}

/* The writes a client holds. Anything beyond these two means somebody granted
   a client a direct table write, which is the thing 0072 and 0073 both refuse
   to do. */
const { rows: writable } = await db.query(`
  select distinct table_name
    from information_schema.role_table_grants
   where grantee = 'authenticated'
     and table_schema = 'public'
     and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
     and table_name like 'client_%'
`);
if (writable.length) {
  failed++;
  console.log(`  FAIL  client views are writable: ${writable.map((r) => r.table_name).join(", ")}`);
} else {
  console.log("  ok    no client view accepts a write — client_create_task and client_create_note are the only doors");
}

console.log(failed ? `\n${failed} problem(s) with the client surface.` : "\nThe client surface is clean.");
await db.close();
process.exit(failed ? 1 : 0);
