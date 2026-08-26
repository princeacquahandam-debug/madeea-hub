-- Stop one person from becoming two chips on the EOD report.
--
-- ── THE SYMPTOM ──────────────────────────────────────────────────────────
--
-- "Every Report" showed FJ twice: "FJ" with 0 reports, from the roster, and
-- "fj.caballes" with 1, from the report he had just filed. Same for Bryan. The
-- filter is per person, so half the work sits behind a chip nobody clicks, and
-- team completion divides by a headcount that has grown by two people who do
-- not exist.
--
-- ── THE CAUSE, WHICH IS NOT THE EOD CODE ─────────────────────────────────
--
-- handle_new_user writes `full_name = split_part(email, '@', 1)`. A new account
-- is therefore called "fj.caballes" until somebody edits it, and 0021's
-- eod_canonical_person trigger faithfully stamps that onto every report filed,
-- exactly as designed: it guarantees ONE name per person, and has no opinion
-- about whether that name is the right one.
--
-- This happened before. In July, Bryan's profile was renamed by hand with a
-- one-off UPDATE, and it came back the moment those accounts were deleted and
-- re-invited, because a new auth user gets a new profile with a freshly
-- generated name. A repair that must be re-run after every invite is not a
-- repair, so this one changes where the name comes from. The hand-written
-- script it replaces is deleted, not archived: a superseded repair that still
-- looks runnable is a trap for whoever finds it next.
--
-- ── WHAT THIS DOES ───────────────────────────────────────────────────────
--
-- Makes the roster the source of the name. An address belonging to somebody on
-- the sheet gets the sheet's spelling; anybody else gets a readable form of
-- their address rather than a raw local-part; and where the answer is genuinely
-- unknown, it refuses to guess and leaves the name alone.

-- ── 1. The roster, as data ───────────────────────────────────────────────
--
-- The eight names from the July sheet, which is what the report grid is keyed
-- by and what the team already reads. In a table rather than inline in a
-- function so a name can be corrected without a migration.
create table if not exists public.person_roster (
  full_name text primary key,
  /* Letters only, lowercased: "FJ Caballes" -> "fjcaballes". Emails punctuate
     differently from names and there is no agreement on which separator, so
     comparison happens with all of it removed. */
  match_key text generated always as (lower(regexp_replace(full_name, '[^A-Za-z]', '', 'g'))) stored
);

insert into public.person_roster (full_name) values
  ('Reichelle Rellora'), ('Angelica Roma'), ('FJ Caballes'), ('Bryan Sumait'),
  ('John Carlo Caintic'), ('Rio Castillo'), ('Laura Esteban'), ('Rowena Rose Petran')
on conflict (full_name) do nothing;

-- ── 2. The escape hatch, checked first ───────────────────────────────────
--
-- Matching is deliberately conservative and there is one case on this team it
-- cannot solve: the sheet says "John Carlo Caintic" and the invited account is
-- johncarlo.japitana@madeeas.com. Those are different surnames, and no rule
-- should decide whether that is a typo, a marriage, or two different people.
-- A human puts the answer here:
--
--   insert into person_name_overrides (email, full_name)
--   values ('johncarlo.japitana@madeeas.com', 'John Carlo Caintic')
--   on conflict (email) do update set full_name = excluded.full_name;
create table if not exists public.person_name_overrides (
  email text primary key,
  full_name text not null,
  note text
);

-- ── 3. The resolver ──────────────────────────────────────────────────────
create or replace function public.canonical_person_name(addr text)
returns text language plpgsql stable set search_path = public, pg_temp as $canon$
declare
  local_part text;
  key text;
  hit text;
  n int;
begin
  if coalesce(trim(addr), '') = '' then return null; end if;

  select o.full_name into hit from person_name_overrides o where lower(o.email) = lower(addr);
  if hit is not null then return hit; end if;

  local_part := split_part(lower(addr), '@', 1);
  key        := regexp_replace(local_part, '[^a-z]', '', 'g');
  if key = '' then return null; end if;

  /* Exact, or the address begins with the name. The second case is ordinary and
     unambiguous: bryansumait.automate@ is Bryan Sumait with a suffix, and no
     other roster member's key is a prefix of it. */
  select count(*), min(r.full_name) into n, hit
  from person_roster r
  where key = r.match_key or key like r.match_key || '%';
  if n = 1 then return hit; end if;

  /* Otherwise the surname, which is how these addresses are actually built:
     reich.rellora@ is Reichelle Rellora even though "reich" is not "reichelle".
     Four letters minimum, because short tokens collide, and it must identify
     exactly ONE person: two Santoses means this rule says nothing rather than
     picking one. Attributing somebody's report to a colleague is a worse
     outcome than the duplicate chip this migration exists to remove. */
  select count(*), min(r.full_name) into n, hit
  from person_roster r
  cross join lateral (
    select lower(split_part(r.full_name, ' ',
      array_length(string_to_array(r.full_name, ' '), 1))) as s
  ) x
  where length(x.s) >= 4
    and x.s = any (string_to_array(local_part, '.'));
  if n = 1 then return hit; end if;

  /* Nobody on the roster. Still not a raw local-part: "rio.castillo" reads as a
     handle, "Rio Castillo" reads as a person, and this is the name that ends up
     on every report they file. */
  return pretty_name_from_email(addr);
end $canon$;

comment on function public.canonical_person_name is
  'The one name a person reports under, resolved from their address: explicit override, then the roster, then a readable form of the address. Never a raw email local-part.';

-- ── 4. New accounts get it from the start ────────────────────────────────
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $newuser$
declare nm text;
begin
  /* An invite may carry a real name, which beats anything derived, so it wins.
     Everything else goes through the resolver. */
  nm := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
    canonical_person_name(new.email),
    'Elite EA'
  );

  insert into profiles (id, full_name, initials)
  values (new.id, nm, upper(left(regexp_replace(nm, '[^A-Za-z]', '', 'g'), 2)))
  on conflict (id) do nothing;

  if new.email_confirmed_at is not null then
    perform grant_invited_membership(new.id, new.email);
  end if;

  return new;
end $newuser$;

-- ── 5. Repair the profiles that already carry a generated name ───────────
--
-- ONLY those. A name somebody typed is theirs, and this must not overwrite
-- "Rio" with "Rio Castillo" because a migration preferred it. The guard is that
-- full_name still equals one of the two things the machine produces: the raw
-- local-part, or its prettified form.
update profiles p
set full_name = canonical_person_name(u.email),
    initials  = upper(left(regexp_replace(canonical_person_name(u.email), '[^A-Za-z]', '', 'g'), 2))
from auth.users u
where u.id = p.id
  and canonical_person_name(u.email) is not null
  and canonical_person_name(u.email) <> p.full_name
  and (
    p.full_name = split_part(u.email, '@', 1)
    or p.full_name = pretty_name_from_email(u.email)
    or coalesce(trim(p.full_name), '') = ''
  );

-- ── 6. Move reports already filed under the wrong name ───────────────────
--
-- Deleting the loser rather than updating it, where both exist: two rows for
-- one person on one day are the same day's work filed twice, and the newer
-- submission is the one they meant. Done BEFORE the update, so the update
-- cannot collide with the (workspace_id, person_name, report_date) index.
delete from eod_reports old
using eod_reports keep, profiles pr
where old.owner_id = pr.id
  and old.person_name <> pr.full_name
  and keep.person_name = pr.full_name
  and keep.report_date = old.report_date
  and keep.workspace_id is not distinct from old.workspace_id
  and keep.id <> old.id
  and coalesce(keep.submitted_at, 'epoch'::timestamptz) >= coalesce(old.submitted_at, 'epoch'::timestamptz);

update eod_reports e
set person_name = pr.full_name
from profiles pr
where e.owner_id = pr.id
  and coalesce(trim(pr.full_name), '') <> ''
  and e.person_name <> pr.full_name;
