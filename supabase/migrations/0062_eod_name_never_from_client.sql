-- A second device can never file under a second name.
--
-- ── WHAT WAS ALREADY TRUE ────────────────────────────────────────────────
--
-- 0021's eod_canonical_person overwrites person_name with the owner's profile
-- name on every insert and update, and it fires BEFORE ON CONFLICT is resolved,
-- so a phone submitting with a stale name still lands on the row the laptop
-- created. That is the guarantee, and it holds.
--
-- ── THE HOLE IN IT ───────────────────────────────────────────────────────
--
-- It holds only while the profile HAS a name:
--
--   if nm is not null then new.person_name := nm; end if;
--
-- When the profile name is blank the trigger keeps whatever the client sent —
-- and what the client sends is whatever that device happens to have cached.
-- Two devices with different cached values then file two rows, which is the
-- exact failure the trigger exists to prevent, occurring in the one case it
-- steps aside for.
--
-- A blank profile name is not hypothetical. It is what an account has between
-- being created and its profile row being written, and it is what several
-- accounts here had after being deleted and re-invited.
--
-- ── THE FIX ──────────────────────────────────────────────────────────────
--
-- Fall back to the address instead of to the client. 0061's resolver turns an
-- address into the roster's spelling of that person's name, which is stable,
-- identical on every device, and derived from something the browser cannot
-- influence. The client's person_name is now never trusted for a report that
-- has an owner: it is read, and then replaced.
create or replace function public.eod_canonical_person()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $canon$
declare
  nm text;
  addr text;
begin
  -- Imported rows from the July sheet have no owner and no address to resolve
  -- against, so they keep the name the sheet gave them. Nothing else may.
  if new.owner_id is null then
    return new;
  end if;

  select nullif(trim(p.full_name), '') into nm from profiles p where p.id = new.owner_id;

  if nm is null then
    /* No profile name yet. Resolve from the account's address rather than
       accepting the browser's idea of who this is: two devices agree on an
       address and need not agree on a cached display name. */
    select u.email into addr from auth.users u where u.id = new.owner_id;
    nm := canonical_person_name(addr);
  end if;

  if nm is not null then
    new.person_name := nm;
  end if;
  return new;
end $canon$;

comment on function public.eod_canonical_person is
  'Forces person_name to the owner''s canonical name on every write. Never trusts the value the client sent for an owned report, so a second device updates the existing row instead of filing under a new name.';

-- The trigger definition is unchanged; recreated only so this migration is
-- self-contained if 0021 is ever edited.
drop trigger if exists eod_canonical_person_trigger on eod_reports;
create trigger eod_canonical_person_trigger
  before insert or update on eod_reports
  for each row execute function eod_canonical_person();
