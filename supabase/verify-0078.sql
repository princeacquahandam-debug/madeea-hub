-- Did 0078 land completely? Read-only. Safe to run any number of times.
--
-- Expect 10 rows, every one saying ok.

select 'role member is allowed' as thing,
       case when (select pg_get_constraintdef(oid) from pg_constraint
                   where conname = 'client_users_role_check') like '%member%'
            then 'ok' else 'MISSING' end as state
union all
select 'table client_time_entries',
       case when to_regclass('public.client_time_entries') is null then 'MISSING' else 'ok' end
union all
select 'table client_time_screenshots',
       case when to_regclass('public.client_time_screenshots') is null then 'MISSING' else 'ok' end
union all
select 'the four views',
       case when (select count(*) from pg_views where schemaname = 'public'
                   and viewname in ('client_my_tasks','client_my_time',
                                    'client_team_time','client_team_screenshots')) = 4
            then 'ok' else 'MISSING' end
union all
select 'the four functions',
       case when (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public'
                     and p.proname in ('client_clock_in','client_clock_out',
                                       'client_create_team_task','client_member_set_status')) = 4
            then 'ok' else 'MISSING' end
union all
-- THE ONE THAT MATTERS MOST. The primary may read the timesheet and must never
-- write it. A timesheet the employer can quietly correct is not evidence of
-- anything, and a policy widened later would look harmless in a diff.
select 'the client cannot edit the timesheet',
       case when not exists (
              select 1 from pg_policies
               where schemaname = 'public' and tablename = 'client_time_entries'
                 and cmd <> 'SELECT'
                 and qual like '%primary%')
            then 'ok' else 'THE CLIENT CAN EDIT HOURS' end
union all
-- A member can only ever be one person's staff, and only write their own rows.
select 'members write only their own rows',
       case when exists (
              select 1 from pg_policies
               where schemaname = 'public' and tablename = 'client_time_entries'
                 and policyname = 'client time own')
            then 'ok' else 'MISSING' end
union all
select 'storage bucket client-screenshots',
       case when exists (select 1 from storage.buckets where id = 'client-screenshots')
            then 'ok' else 'MISSING - create it in Storage' end
union all
select 'the bucket is private',
       case when exists (select 1 from storage.buckets
                          where id = 'client-screenshots' and public = false)
            then 'ok' else 'IT IS PUBLIC - anyone with a URL can read captures' end
union all
select 'both storage policies exist',
       case when (select count(*) from pg_policies
                   where schemaname = 'storage' and tablename = 'objects'
                     and policyname in ('client shots upload own folder','client shots read')) = 2
            then 'ok' else 'MISSING' end;
