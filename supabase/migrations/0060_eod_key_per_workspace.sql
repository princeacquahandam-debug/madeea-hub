-- One report per person per day, PER WORKSPACE.
--
-- 0021 keyed a report on (person_name, report_date), which is right about the
-- thing it was solving — two devices, or a renamed profile, must not fork one
-- human into two rows — and wrong about scope. The name is not unique across
-- the world: two agencies each with a "Rio Castillo" share a row, and the
-- second one to submit collides with a row it cannot even see.
--
-- That does not corrupt anything, because the write policy still demands
-- workspace_id = my_workspace(): the upsert tries to update a hidden row and is
-- refused. But "your report will not save today and nobody can tell you why" is
-- not a good failure, and it is invisible until the day a second workspace
-- exists.
--
-- WHY THIS IS SAFE TO DO NOW, AND WOULD NOT HAVE BEEN LAST WEEK. eod_reports is
-- empty: the old workspace was deleted and took its reports with it. Rewriting
-- a unique key with rows in it means deciding what to do with whatever already
-- violates the new key. With zero rows there is nothing to decide, and the
-- constraint simply becomes correct.
alter table public.eod_reports drop constraint if exists eod_reports_person_name_report_date_key;

create unique index if not exists eod_reports_person_day_uniq
  on public.eod_reports (workspace_id, person_name, report_date);

comment on index public.eod_reports_person_day_uniq is
  'One report per person per day per workspace. The app upserts on these three columns, so a second device corrects the existing report instead of filing a duplicate.';
