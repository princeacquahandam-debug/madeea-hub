-- 0092: a personal time zone on each profile (Reich's testing, 20 Oct 2026).
--
-- "The selected time zone should synchronize across emails, replies, task
-- deadlines, and calendar appointments." An EA in Manila supporting a client in
-- Dubai needs the Hub to show times in ONE zone she chose, not whatever her
-- laptop happens to be set to that week.
--
-- profiles.timezone is an IANA name ("Asia/Manila"). NULL means "use the
-- computer's zone", which is what every account did before this migration, so
-- nobody's screen changes until they pick something.
--
-- WHY A TRIGGER AND NOT A CHECK. The obvious check, `now() at time zone tz`,
-- calls a STABLE function and depends on the server's tzdata; a CHECK is meant
-- to be immutable and is re-validated on dump/restore, where a zone that
-- disappeared from tzdata would make the restore fail. A BEFORE trigger
-- validates only on write, uses the same parser Postgres uses everywhere else,
-- and turns a typo into a clear error instead of a stored zone the app would
-- then have to second-guess. The app validates too (Intl), and falls back to
-- the computer's zone for anything it cannot read, so neither side trusts the
-- other blindly.
--
-- RLS is unchanged: "own profile" (0001) already lets a person update their own
-- row, and "read workspace profiles" (0003) lets teammates see each other's zone.
--
-- Idempotent: safe to run more than once.

alter table public.profiles add column if not exists timezone text;

comment on column public.profiles.timezone is
  'IANA time zone the Hub shows this person''s times in (e.g. Asia/Manila). NULL = the computer''s own zone. Validated by profiles_timezone_valid.';

create or replace function public.profiles_timezone_valid()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Blank is the same as "not set".
  if new.timezone is not null and btrim(new.timezone) = '' then
    new.timezone := null;
  end if;

  if new.timezone is not null then
    new.timezone := btrim(new.timezone);
    -- Region/City names and UTC only. Postgres also accepts abbreviations and
    -- POSIX strings ("EST", "UTC+3"), which browsers do not, and "UTC+3" in
    -- POSIX means three hours WEST. Refusing them avoids that trap.
    if new.timezone <> 'UTC' and position('/' in new.timezone) = 0 then
      raise exception 'Unknown time zone "%". Use a name like Asia/Manila.', new.timezone
        using errcode = '22023';
    end if;
    begin
      perform now() at time zone new.timezone;
    exception when others then
      raise exception 'Unknown time zone "%". Use a name like Asia/Manila.', new.timezone
        using errcode = '22023';
    end;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_timezone_valid on public.profiles;
create trigger profiles_timezone_valid
  before insert or update of timezone on public.profiles
  for each row execute function public.profiles_timezone_valid();
