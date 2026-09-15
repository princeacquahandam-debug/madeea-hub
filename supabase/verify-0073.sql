-- Did 0073 land completely? Read-only. Safe to run any number of times.
--
-- A half-applied paste looks exactly like a whole one in the SQL editor: the
-- last statement reports success either way. This asks the database what it
-- actually has, so the answer does not depend on what the editor said.
--
-- Expect 9 rows, every one of them saying ok.

select 'view client_days'      as thing,
       case when to_regclass('public.client_days')     is null then 'MISSING' else 'ok' end as state
union all
select 'view client_calendar',
       case when to_regclass('public.client_calendar') is null then 'MISSING' else 'ok' end
union all
select 'view client_notes',
       case when to_regclass('public.client_notes')    is null then 'MISSING' else 'ok' end
union all
select 'old view client_hours is gone',
       case when to_regclass('public.client_hours')    is null then 'ok' else 'STILL THERE' end
union all
select 'notes.shared_with_client',
       case when exists (select 1 from information_schema.columns
                          where table_schema = 'public' and table_name = 'notes'
                            and column_name = 'shared_with_client')
            then 'ok' else 'MISSING' end
union all
select 'notes.author_is_client',
       case when exists (select 1 from information_schema.columns
                          where table_schema = 'public' and table_name = 'notes'
                            and column_name = 'author_is_client')
            then 'ok' else 'MISSING' end
union all
select 'function client_create_note',
       case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                          where n.nspname = 'public' and p.proname = 'client_create_note')
            then 'ok' else 'MISSING' end
union all
-- The whole isolation model rests on this. A client view that forgot its WHERE
-- clause is not a narrower view of one client, it is every client.
select 'all three views filter on my_client()',
       case when (select count(*) from pg_views
                   where schemaname = 'public'
                     and viewname in ('client_days', 'client_calendar', 'client_notes')
                     and definition like '%my_client()%') = 3
            then 'ok' else 'ONE IS UNSCOPED' end
union all
-- No existing note should have become visible to a client on the day this ran.
select 'no note was shared by the migration',
       case when (select count(*) from public.notes where shared_with_client) = 0
            then 'ok' else 'SOMETHING IS ALREADY SHARED' end;
