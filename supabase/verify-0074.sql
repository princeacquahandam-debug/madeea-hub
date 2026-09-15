-- Did 0074 land completely? Read-only. Safe to run any number of times.
--
-- A half-applied paste reports success on its last statement either way, so
-- this asks the database what it actually has.
--
-- Expect 8 rows, every one saying ok.

select 'client_users.role column' as thing,
       case when exists (select 1 from information_schema.columns
                          where table_schema = 'public' and table_name = 'client_users'
                            and column_name = 'role')
            then 'ok' else 'MISSING' end as state
union all
select 'role is constrained to primary/viewer',
       case when exists (select 1 from pg_constraint where conname = 'client_users_role_check')
            then 'ok' else 'MISSING' end
union all
select 'function my_client_role',
       case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                          where n.nspname = 'public' and p.proname = 'my_client_role')
            then 'ok' else 'MISSING' end
union all
select 'function client_remove_viewer',
       case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                          where n.nspname = 'public' and p.proname = 'client_remove_viewer')
            then 'ok' else 'MISSING' end
union all
select 'view client_people',
       case when to_regclass('public.client_people') is null then 'MISSING' else 'ok' end
union all
-- The rule that keeps a colleague out of the escalation channel. If this one
-- says MISSING, the migration applied but the conversation function did not get
-- replaced, and viewers can read the client private messages.
select 'viewers are shut out of the channels',
       case when (select pg_get_functiondef(p.oid)
                    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname = 'can_see_conversation')
                 like '%my_client_role%'
            then 'ok' else 'MISSING' end
union all
select 'viewers cannot request tasks',
       case when (select pg_get_functiondef(p.oid)
                    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname = 'client_create_task')
                 like '%my_client_role%'
            then 'ok' else 'MISSING' end
union all
-- Nobody should have changed role when this ran.
select 'every existing login is still primary',
       case when not exists (select 1 from public.client_users where role <> 'primary')
            then 'ok' else 'SOMEONE IS ALREADY A VIEWER' end;
