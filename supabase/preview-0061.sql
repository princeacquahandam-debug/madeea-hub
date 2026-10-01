-- Before pasting 0061: who will it change? Read-only. Changes nothing.
-- Safe to run any number of times.
--
-- Rows to expect:
--   1   whether the fix is already live
--   2   each account whose name was made from its email (these get renamed)
--   3   each person whose reports are split across two names (these get merged)
--   4   each day someone has two reports (the older one is removed, the newer kept)

select '1. Is the fix already live?' as check,
       case when to_regclass('public.person_roster') is null
            then 'No, not applied yet'
            else 'Yes, 0061 already ran' end as result
union all
select '2. Name made from email (will be fixed)',
       u.email || '   now "' || coalesce(p.full_name, '') || '"'
from profiles p
join auth.users u on u.id = p.id
where p.full_name = split_part(u.email, '@', 1)
   or coalesce(trim(p.full_name), '') = ''
union all
select '3. Reports split across two names (will be merged)',
       u.email || ':  ' || string_agg(distinct e.person_name, '  +  ') || '   (' || count(*) || ' reports)'
from eod_reports e
join auth.users u on u.id = e.owner_id
group by u.email
having count(distinct e.person_name) > 1
union all
select '4. Same day reported twice (older removed, newer kept)',
       u.email || ' on ' || e.report_date::text
from eod_reports e
join auth.users u on u.id = e.owner_id
group by u.email, e.report_date
having count(*) > 1
order by 1, 2;
