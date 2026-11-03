-- 0095_made_ready_curriculum.sql. The Made Ready Academy, to the HR outline.
--
-- Run once in the Supabase SQL editor, after 0094.
--
-- "Made Ready Academy: MadeEA AI-Powered Executive Assistant Foundations"
-- (course outline, Nov 2026) replaces the three-module draft from 0034:
--   Day 1  modules 1-3   The MadeEA Standard, EA essentials, Google Workspace
--   Day 2  modules 4-7   AI foundations, prompting, the AI toolkit, workflows
--   Day 3  modules 8-10  client tech stack, integration, communication
-- A quiz per module (80% to pass, as the outline asks), and four practical
-- assessments: the Module 3 mini exercise, prompt writing, the Day 2 practical
-- and the 90-minute final client simulation.
--
-- ── Practical assessments ─────────────────────────────────────────────────
-- The outline's certificate needs "pass all practical assessments", which a
-- multiple-choice grader cannot do. So a practical lesson takes a submission
-- (text, or links to the learner's Docs/Slides) and an admin marks it passed
-- or sends it back with feedback.
--
-- Same principle as the answer key in 0034: the person being assessed cannot
-- mark themselves. A learner can only ever write status 'submitted' (the
-- trigger forces it), and only an admin reviewing SOMEONE ELSE's work can set
-- 'passed' or 'needs_work'. An admin taking the course is reviewed by another
-- admin like everyone else.
--
-- Made Ready (academy_status) now means: every published module's quiz passed
-- AND every practical in a published module passed.
--
-- Safe to run more than once.

-- ---------- practical lessons ----------
alter table academy_lessons drop constraint if exists academy_lessons_kind_check;
alter table academy_lessons add constraint academy_lessons_kind_check
  check (kind in ('reading', 'video', 'simulation', 'practical'));

create table if not exists academy_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  lesson_id uuid not null references academy_lessons (id) on delete cascade,
  body text not null check (length(btrim(body)) > 0),
  status text not null default 'submitted' check (status in ('submitted', 'passed', 'needs_work')),
  feedback text,
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  submitted_at timestamptz not null default now(),
  unique (user_id, lesson_id)
);

create index if not exists academy_submissions_status_idx on academy_submissions (status, submitted_at);

-- Is this lesson part of the caller's workspace?
create or replace function academy_lesson_in_my_workspace(p_lesson uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from academy_lessons l join academy_modules m on m.id = l.module_id
     where l.id = p_lesson and m.workspace_id = my_workspace()
  );
$$;

-- Who may change what. The learner edits their work and it goes back to
-- 'submitted'; a reviewer changes the verdict and nothing else.
create or replace function academy_submission_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.user_id = auth.uid() then
    -- The learner: never a verdict, even an admin on their own work.
    new.status := 'submitted';
    new.reviewed_by := null;
    new.reviewed_at := null;
    if tg_op = 'UPDATE' then
      new.user_id := old.user_id;
      new.lesson_id := old.lesson_id;
      new.feedback := old.feedback;   -- keep the last feedback visible while they fix it
      new.submitted_at := now();
    end if;
  elsif tg_op = 'UPDATE' and is_admin() then
    -- A reviewer: verdict and feedback only.
    new.user_id := old.user_id;
    new.lesson_id := old.lesson_id;
    new.body := old.body;
    new.submitted_at := old.submitted_at;
    new.reviewed_by := auth.uid();
    new.reviewed_at := now();
  else
    raise exception 'not allowed';
  end if;
  return new;
end $$;

drop trigger if exists academy_submission_guard on academy_submissions;
create trigger academy_submission_guard before insert or update on academy_submissions
  for each row execute function academy_submission_guard();

alter table academy_submissions enable row level security;

drop policy if exists "submissions read" on academy_submissions;
create policy "submissions read" on academy_submissions for select to authenticated
  using (user_id = auth.uid() or (is_admin() and academy_lesson_in_my_workspace(lesson_id)));

drop policy if exists "submissions own insert" on academy_submissions;
create policy "submissions own insert" on academy_submissions for insert to authenticated
  with check (user_id = auth.uid() and academy_lesson_in_my_workspace(lesson_id));

drop policy if exists "submissions update" on academy_submissions;
create policy "submissions update" on academy_submissions for update to authenticated
  using (user_id = auth.uid() or (is_admin() and academy_lesson_in_my_workspace(lesson_id)))
  with check (user_id = auth.uid() or (is_admin() and academy_lesson_in_my_workspace(lesson_id)));

-- No delete policy: a submission is a record of the assessment.

-- ---------- resources ----------
-- "Resources Included" from the outline. Each one gets a link once it exists;
-- until then the Training Center lists it as being prepared.
create table if not exists academy_resources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid default my_workspace() references workspaces (id) on delete cascade,
  title text not null,
  url text check (url is null or url ~* '^https://'),
  position integer not null default 0
);

alter table academy_resources enable row level security;

drop policy if exists "resources readable" on academy_resources;
create policy "resources readable" on academy_resources for select to authenticated
  using (workspace_id = my_workspace());
drop policy if exists "resources admin write" on academy_resources;
create policy "resources admin write" on academy_resources for all to authenticated
  using (workspace_id = my_workspace() and is_admin())
  with check (workspace_id = my_workspace() and is_admin());

-- ---------- Made Ready now includes the practicals ----------
-- New columns go at the end so create or replace keeps working.
create or replace view academy_status
with (security_invoker = true) as
select
  m.user_id,
  (select count(*) from academy_modules am where am.workspace_id = m.workspace_id and am.is_published) as modules_total,
  (select count(distinct a.module_id)
     from academy_attempts a
     join academy_modules am on am.id = a.module_id
    where a.user_id = m.user_id and a.passed and am.is_published) as modules_passed,
  (select max(a.created_at)
     from academy_attempts a where a.user_id = m.user_id and a.passed) as last_passed_at,
  (select count(*)
     from academy_lessons l join academy_modules am on am.id = l.module_id
    where am.workspace_id = m.workspace_id and am.is_published and l.kind = 'practical') as practicals_total,
  (select count(*)
     from academy_submissions s
     join academy_lessons l on l.id = s.lesson_id
     join academy_modules am on am.id = l.module_id
    where s.user_id = m.user_id and s.status = 'passed' and am.is_published and l.kind = 'practical') as practicals_passed
from memberships m
where m.workspace_id = my_workspace();

comment on view academy_status is
  'Per-EA Academy completion. Made Ready = all published module quizzes passed and all practicals passed (0095).';
