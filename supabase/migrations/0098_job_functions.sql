-- 0098_job_functions.sql. What each person does, separate from what they may access.
--
-- Run once in the Supabase SQL editor. Safe to run more than once.
--
-- 30 Oct 2026 direction from MadeEA: the EOS grows from an EA tool into one
-- platform for the whole team: Executive Assistants, AI Specialists, Marketing
-- Specialists and other operations and support roles.
--
-- memberships.role is ACCESS (owner, admin, manager, employee) and stays as it
-- is: every policy in the database reads it. The job is a separate column, so
-- an AI Specialist can be an employee and an EA can be a manager without one
-- meaning the other. It changes labels, Madeline's framing and which training
-- applies; it grants nothing.
--
-- Everyone on file today was hired as an EA, except the people running the
-- business (owners, admins, managers), who start as Operations. Admins can
-- change either in the Admin Panel.

alter table memberships add column if not exists job_function text;

update memberships
   set job_function = case when role::text in ('owner', 'admin', 'manager') then 'operations' else 'ea' end
 where job_function is null;

alter table memberships alter column job_function set default 'ea';
alter table memberships alter column job_function set not null;

alter table memberships drop constraint if exists memberships_job_function_check;
alter table memberships add constraint memberships_job_function_check
  check (job_function in ('ea', 'ai_specialist', 'marketing_specialist', 'operations', 'other'));

-- Writes go through the existing "memb admin write" policy and the 0045 guard,
-- so only admins change it, and never for someone ranked above them.
