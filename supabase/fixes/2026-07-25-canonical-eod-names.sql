-- Collapse split EOD identities. 2026-07-25
--
-- Symptom: the "Every Report" filter showed a person twice (e.g. "Bryan" with 0
-- reports AND "Bryansumait" with 1). Cause: the account's profile name, generated
-- from its email local-part ("bryansumait.automate" -> "Bryansumait Automate"),
-- doesn't match the imported July sheet roster name ("Bryan Sumait").
--
-- Migration 0021's eod_canonical_person trigger already forces every report's
-- person_name to the OWNER'S PROFILE NAME on each write, so one account can never
-- fork into two names across devices. This script just makes that single profile
-- name the canonical roster name, so the live account and the sheet roster line up
-- as ONE chip instead of two.
--
-- Idempotent and safe to re-run. Keyed by email so it targets the right account.

-- ---------- Bryan (the one in the screenshot) ----------
update profiles p
set full_name = 'Bryan Sumait'
from auth.users u
where u.id = p.id and lower(u.email) = 'bryansumait.automate@gmail.com';

-- Re-attribute his already-submitted report(s) to the canonical name. Guarded so
-- it can't violate the (person_name, report_date) unique constraint.
update eod_reports e
set person_name = 'Bryan Sumait'
from auth.users u
where e.owner_id = u.id
  and lower(u.email) = 'bryansumait.automate@gmail.com'
  and e.person_name <> 'Bryan Sumait'
  and not exists (
    select 1 from eod_reports x
    where x.person_name = 'Bryan Sumait' and x.report_date = e.report_date and x.id <> e.id
  );

-- ---------- The other EAs ----------
-- Run each line ONCE that person's account exists, so they never split either.
-- The sheet roster's exact names are:
--   Reichelle Rellora · Angelica Roma · FJ Caballes · John Carlo Caintic
--   Rio Castillo · Laura Esteban · Rowena Rose Petran
--
-- NOTE the mismatch to confirm before running: the sheet says "John Carlo Caintic",
-- but the invited account is johncarlo.japitana@madeeas.com (different surname).
-- Decide which is correct and set the name accordingly.

-- update profiles p set full_name = 'Reichelle Rellora'  from auth.users u where u.id = p.id and lower(u.email) = 'reich.rellora@madeeas.com';
-- update profiles p set full_name = 'Angelica Roma'       from auth.users u where u.id = p.id and lower(u.email) = 'angelica.roma@madeeas.com';
-- update profiles p set full_name = 'FJ Caballes'         from auth.users u where u.id = p.id and lower(u.email) = 'fj.caballes@madeeas.com';
-- update profiles p set full_name = 'Laura Esteban'       from auth.users u where u.id = p.id and lower(u.email) = 'laura.esteban@madeeas.com';
-- update profiles p set full_name = 'Rowena Rose Petran'  from auth.users u where u.id = p.id and lower(u.email) = 'rowena.petran@madeeas.com';
-- update profiles p set full_name = 'John Carlo Caintic'  from auth.users u where u.id = p.id and lower(u.email) = 'johncarlo.japitana@madeeas.com';  -- confirm surname first
