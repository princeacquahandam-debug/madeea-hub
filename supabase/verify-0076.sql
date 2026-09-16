-- Did 0076 land completely? Read-only. Safe to run any number of times.
--
-- Expect 8 rows, every one saying ok.

select 'table delegation_assessments' as thing,
       case when to_regclass('public.delegation_assessments') is null then 'MISSING' else 'ok' end as state
union all
select 'table delegation_plans',
       case when to_regclass('public.delegation_plans') is null then 'MISSING' else 'ok' end
union all
select 'table delegation_follow_ups',
       case when to_regclass('public.delegation_follow_ups') is null then 'MISSING' else 'ok' end
union all
select 'the three client views',
       case when (select count(*) from pg_views
                   where schemaname = 'public'
                     and viewname in ('client_delegation_plans',
                                      'client_delegation_assessments',
                                      'client_delegation_follow_ups')) = 3
            then 'ok' else 'MISSING' end
union all
select 'the five client functions',
       case when (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public'
                     and p.proname in ('client_save_assessment','client_save_plan',
                                       'client_hand_off_plan','client_save_follow_up',
                                       'client_complete_follow_up')) = 5
            then 'ok' else 'MISSING' end
union all
-- THE ONE THAT MATTERS MOST. The imported schema ships its own handle_new_user
-- and a trigger on auth.users. This database already owns that trigger and it
-- decides whether a new account becomes staff or a client. If the original had
-- been pasted as written, this row would say CLOBBERED and every account
-- created from now on would arrive with no membership and no client link.
select 'signup still knows staff from clients',
       case when (select pg_get_functiondef(p.oid)
                    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname = 'handle_new_user')
                 like '%workspace%'
            then 'ok' else 'CLOBBERED - DO NOT CREATE ACCOUNTS' end
union all
-- Staff read plans. Staff do not write them.
select 'staff can read plans and not write them',
       case when (select count(*) from pg_policies
                   where schemaname = 'public' and tablename = 'delegation_plans'
                     and cmd <> 'SELECT') = 0
            then 'ok' else 'A WRITE POLICY EXISTS' end
union all
select 'no plans yet, as expected on a fresh install',
       case when (select count(*) from public.delegation_plans) = 0
            then 'ok' else 'there are already plans, which is fine if you expected that' end;
