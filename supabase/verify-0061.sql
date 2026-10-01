-- Did 0061 and 0062 land? Read-only. Safe to run any number of times.
--
-- Expect rows 1 to 4 to say ok or "none". Row 5 lists the name every person
-- now reports under: read it once, and check each one is right.

select '1. Names come from the roster (0061)' as check,
       case when to_regclass('public.person_roster') is not null
             and exists (select 1 from pg_proc where proname = 'canonical_person_name')
            then 'ok' else 'MISSING: paste 0061' end as result
union all
select '2. A second device cannot file a second name (0062)',
       case when exists (select 1 from pg_proc
                          where proname = 'eod_canonical_person'
                            and prosrc like '%canonical_person_name%')
            then 'ok' else 'MISSING: paste 0062' end
union all
select '3. Accounts still named from their email',
       coalesce(string_agg(u.email, ', '), 'none')
from profiles p
join auth.users u on u.id = p.id
where p.full_name = split_part(u.email, '@', 1)
union all
-- Anything here is a report that clashed with an imported July-sheet row for
-- the same person and day. 0061 leaves those for a person to decide.
select '4. People still split across two names',
       coalesce((select string_agg(x, '; ') from (
                   select u.email || ': ' || string_agg(distinct e.person_name, ' + ') as x
                   from eod_reports e
                   join auth.users u on u.id = e.owner_id
                   group by u.email
                   having count(distinct e.person_name) > 1) s), 'none')
union all
select '5. Reports under',
       p.full_name || '   (' || u.email || ')'
from profiles p
join auth.users u on u.id = p.id
order by 1, 2;
