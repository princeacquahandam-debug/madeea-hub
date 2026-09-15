-- Did 0075 land completely? Read-only. Safe to run any number of times.
--
-- Expect 6 rows, every one saying ok.
--
-- RUN THIS BEFORE THE FRONTEND SHIPS. The task form now sends
-- client_visible_blocker on every save. Against a database without that column
-- the whole insert is rejected, so creating a task would fail for everybody,
-- not just fail to record the new field.

select 'tasks.client_visible_blocker' as thing,
       case when exists (select 1 from information_schema.columns
                          where table_schema = 'public' and table_name = 'tasks'
                            and column_name = 'client_visible_blocker')
            then 'ok' else 'MISSING' end as state
union all
select 'client_tasks publishes it',
       case when exists (select 1 from information_schema.columns
                          where table_schema = 'public' and table_name = 'client_tasks'
                            and column_name = 'client_visible_blocker')
            then 'ok' else 'MISSING' end
union all
-- The private note must NOT have come along with it.
select 'client_tasks still withholds blocker_note',
       case when not exists (select 1 from information_schema.columns
                              where table_schema = 'public' and table_name = 'client_tasks'
                                and column_name = 'blocker_note')
            then 'ok' else 'LEAKING THE PRIVATE NOTE' end
union all
select 'view staff_clock_status',
       case when to_regclass('public.staff_clock_status') is null then 'MISSING' else 'ok' end
union all
select 'alert route ea_not_clocked_in',
       case when exists (select 1 from public.alert_routes where event = 'ea_not_clocked_in')
            then 'ok' else 'MISSING' end
union all
-- Seeded off and pointing nowhere, like every other route. An alert route that
-- arrives switched on sends its first message before anybody chose to.
select 'and it is off until somebody configures it',
       case when not exists (select 1 from public.alert_routes
                              where event = 'ea_not_clocked_in' and is_active)
            then 'ok' else 'IT IS ALREADY LIVE' end;
