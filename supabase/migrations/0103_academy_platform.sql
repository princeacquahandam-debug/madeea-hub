-- 0103_academy_platform.sql. MadeEA Academy, the separate learning platform.
--
-- Run once in the Supabase SQL editor (madeea-hub project), after 0102.
-- Safe to run again: every object is created "if not exists" or replaced.
--
-- From Abder's Academy roadmap (calls of 11 and 16 Nov 2026):
--   * its own app on academy.madeea.io, same accounts as the Hub, one sign-in
--   * Studio for admins and trainers: courses built by hand (AI later),
--     modules and lessons with text, images, videos and tables, flashcards,
--     questions (multiple choice or free text), preview, publish
--   * learning paths on top of courses: pick courses, an optional final
--     assessment (pass mark, time limit, attempts), a question bank by
--     difficulty that the exam draws from at random, and an audience
--     (everyone, or chosen people, regions or teams)
--   * learners, reports, learner reviews, certificate settings (signer,
--     title, uploaded or drawn signature)
--   * learner side: overview, focused player, flashcards, quizzes, final
--     exam, certificate
--
-- The old Made Ready tables (academy_*) are left exactly as they are. The
-- Made Ready course is copied into the new tables as a DRAFT course, so it can
-- be edited and put into a path rather than rebuilt by hand (section 9).
--
-- ── Same rule as 0034: answers never reach a learner's browser ─────────────
-- acad_answer_keys is readable by Academy staff only. Learners get their
-- results from the grading functions. The final exam never returns which
-- answer was right, only the score, so the question bank can't be harvested
-- one attempt at a time. Module quizzes are for learning and do show the
-- right answer after submitting.

-- ── 1. who is who in the Academy ───────────────────────────────────────────
-- Academy role is separate from the Hub role. Hub owners and admins are
-- Academy admins by default; every other Hub member is a learner unless given
-- a row here. Region and team are what a path's audience can target.
create table if not exists public.acad_members (
  workspace_id uuid not null default public.my_workspace() references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text check (role in ('learner', 'trainer', 'admin')),
  region text,
  team text,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create or replace function public.acad_role_of(p_user uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when m.user_id is null then null
    when am.role is not null then am.role
    when public.role_rank(m.role::text) >= public.role_rank('admin') then 'admin'
    else 'learner'
  end
  from (select 1) one
  left join public.memberships m on m.user_id = p_user and m.workspace_id = public.my_workspace()
  left join public.acad_members am on am.user_id = p_user and am.workspace_id = public.my_workspace()
$$;

create or replace function public.acad_role()
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select public.acad_role_of(auth.uid())
$$;

create or replace function public.acad_is_staff()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.acad_role() in ('trainer', 'admin'), false)
$$;

create or replace function public.acad_is_admin()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.acad_role() = 'admin', false)
$$;

-- ── 2. settings (certificate signer, signature) ────────────────────────────
create table if not exists public.acad_settings (
  workspace_id uuid primary key default public.my_workspace() references public.workspaces (id) on delete cascade,
  academy_name text not null default 'MadeEA Academy',
  signer_name text,
  signer_title text,
  -- storage path in the academy-media bucket, uploaded or drawn
  signature_path text,
  updated_at timestamptz not null default now()
);

-- ── 3. courses ─────────────────────────────────────────────────────────────
create table if not exists public.acad_courses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.my_workspace() references public.workspaces (id) on delete cascade,
  title text not null,
  description text,
  level text not null default 'beginner' check (level in ('beginner', 'intermediate', 'advanced')),
  icon text not null default 'book',
  cover_path text,
  status text not null default 'draft' check (status in ('draft', 'published')),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz
);

create table if not exists public.acad_modules (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.acad_courses (id) on delete cascade,
  title text not null,
  position integer not null default 0,
  -- pass mark for this module's quiz, when it has one
  pass_pct integer not null default 70 check (pass_pct between 1 and 100)
);
create index if not exists acad_modules_course_idx on public.acad_modules (course_id, position);

-- A lesson is a list of blocks, in order:
--   {"type":"text","md":"..."}
--   {"type":"image","path":"...","caption":"..."}      (academy-media bucket)
--   {"type":"video","url":"https://..."} or {"type":"video","path":"..."}
--   {"type":"table","rows":[["Head","Head"],["cell","cell"]]}
create table if not exists public.acad_lessons (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references public.acad_modules (id) on delete cascade,
  title text not null,
  minutes integer not null default 10 check (minutes between 1 and 600),
  blocks jsonb not null default '[]'::jsonb check (jsonb_typeof(blocks) = 'array'),
  position integer not null default 0
);
create index if not exists acad_lessons_module_idx on public.acad_lessons (module_id, position);

create table if not exists public.acad_flashcards (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references public.acad_modules (id) on delete cascade,
  front text not null,
  back text not null,
  position integer not null default 0
);
create index if not exists acad_flashcards_module_idx on public.acad_flashcards (module_id, position);

-- ── 4. learning paths ──────────────────────────────────────────────────────
create table if not exists public.acad_paths (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.my_workspace() references public.workspaces (id) on delete cascade,
  title text not null,
  -- free label: onboarding, client-ready, compliance, ...
  kind text,
  description text,
  status text not null default 'draft' check (status in ('draft', 'published')),
  has_final boolean not null default false,
  pass_pct integer not null default 80 check (pass_pct between 1 and 100),
  time_limit_min integer check (time_limit_min is null or time_limit_min between 1 and 600),
  attempts_allowed integer check (attempts_allowed is null or attempts_allowed between 1 and 50),
  exam_size integer not null default 20 check (exam_size between 1 and 200),
  audience text not null default 'all' check (audience in ('all', 'selected')),
  due_days integer check (due_days is null or due_days between 1 and 365),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz
);

create table if not exists public.acad_path_courses (
  path_id uuid not null references public.acad_paths (id) on delete cascade,
  course_id uuid not null references public.acad_courses (id) on delete cascade,
  position integer not null default 0,
  primary key (path_id, course_id)
);

-- Who a 'selected' path is for: a person, a region or a team.
create table if not exists public.acad_path_audience (
  path_id uuid not null references public.acad_paths (id) on delete cascade,
  kind text not null check (kind in ('user', 'region', 'team')),
  value text not null,
  primary key (path_id, kind, value)
);

-- ── 5. questions: module quizzes and the path's final-exam bank ────────────
create table if not exists public.acad_questions (
  id uuid primary key default gen_random_uuid(),
  module_id uuid references public.acad_modules (id) on delete cascade,
  path_id uuid references public.acad_paths (id) on delete cascade,
  kind text not null default 'choice' check (kind in ('choice', 'text')),
  prompt text not null,
  choices jsonb not null default '[]'::jsonb check (jsonb_typeof(choices) = 'array'),
  explanation text,
  difficulty text not null default 'medium' check (difficulty in ('easy', 'medium', 'hard')),
  position integer not null default 0,
  check ((module_id is null) <> (path_id is null)),
  -- the final exam is marked automatically, so its bank is multiple choice
  check (path_id is null or kind = 'choice')
);
create index if not exists acad_questions_module_idx on public.acad_questions (module_id, position);
create index if not exists acad_questions_path_idx on public.acad_questions (path_id, difficulty);

create table if not exists public.acad_answer_keys (
  question_id uuid primary key references public.acad_questions (id) on delete cascade,
  correct_index integer,
  model_answer text
);

-- ── 6. learner records ─────────────────────────────────────────────────────
create table if not exists public.acad_progress (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  lesson_id uuid not null references public.acad_lessons (id) on delete cascade,
  completed_at timestamptz not null default now(),
  primary key (user_id, lesson_id)
);

create table if not exists public.acad_quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  module_id uuid not null references public.acad_modules (id) on delete cascade,
  score integer not null,
  total integer not null,
  passed boolean not null,
  created_at timestamptz not null default now()
);
create index if not exists acad_quiz_attempts_user_idx on public.acad_quiz_attempts (user_id, module_id);

create table if not exists public.acad_exams (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  path_id uuid not null references public.acad_paths (id) on delete cascade,
  question_ids uuid[] not null,
  started_at timestamptz not null default now(),
  deadline timestamptz,
  submitted_at timestamptz,
  score integer,
  total integer,
  passed boolean
);
create index if not exists acad_exams_user_idx on public.acad_exams (user_id, path_id);

create table if not exists public.acad_certificates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  path_id uuid not null references public.acad_paths (id) on delete cascade,
  score integer,
  code text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
  issued_at timestamptz not null default now(),
  unique (user_id, path_id)
);

-- Learner feedback on a course (the Reviews page in Studio).
create table if not exists public.acad_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  course_id uuid not null references public.acad_courses (id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now(),
  unique (user_id, course_id)
);

-- ── 7. who can see what ────────────────────────────────────────────────────
create or replace function public.acad_path_visible(p_path uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.acad_paths p
     where p.id = p_path
       and p.workspace_id = public.my_workspace()
       and public.acad_role() is not null
       and (public.acad_is_staff() or (
         p.status = 'published' and (
           p.audience = 'all'
           or exists (
             select 1 from public.acad_path_audience a
               left join public.acad_members am
                 on am.user_id = auth.uid() and am.workspace_id = p.workspace_id
              where a.path_id = p.id and (
                (a.kind = 'user' and a.value = auth.uid()::text)
                or (a.kind = 'region' and lower(a.value) = lower(coalesce(am.region, '')))
                or (a.kind = 'team' and lower(a.value) = lower(coalesce(am.team, '')))
              )
           )
         )
       ))
  )
$$;

create or replace function public.acad_course_visible(p_course uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.acad_courses c
     where c.id = p_course
       and c.workspace_id = public.my_workspace()
       and (public.acad_is_staff() or (
         c.status = 'published'
         and exists (select 1 from public.acad_path_courses pc
                      where pc.course_id = c.id and public.acad_path_visible(pc.path_id))
       ))
  )
$$;

create or replace function public.acad_module_course(p_module uuid)
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select course_id from public.acad_modules where id = p_module
$$;

create or replace function public.acad_staff_owns_course(p_course uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.acad_is_staff() and exists (
    select 1 from public.acad_courses where id = p_course and workspace_id = public.my_workspace())
$$;

create or replace function public.acad_staff_owns_path(p_path uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.acad_is_staff() and exists (
    select 1 from public.acad_paths where id = p_path and workspace_id = public.my_workspace())
$$;

alter table public.acad_members       enable row level security;
alter table public.acad_settings      enable row level security;
alter table public.acad_courses       enable row level security;
alter table public.acad_modules       enable row level security;
alter table public.acad_lessons       enable row level security;
alter table public.acad_flashcards    enable row level security;
alter table public.acad_paths         enable row level security;
alter table public.acad_path_courses  enable row level security;
alter table public.acad_path_audience enable row level security;
alter table public.acad_questions     enable row level security;
alter table public.acad_answer_keys   enable row level security;
alter table public.acad_progress      enable row level security;
alter table public.acad_quiz_attempts enable row level security;
alter table public.acad_exams         enable row level security;
alter table public.acad_certificates  enable row level security;
alter table public.acad_reviews       enable row level security;

-- members: you read your own row, staff read all, admins write
drop policy if exists "acad members read" on public.acad_members;
create policy "acad members read" on public.acad_members for select to authenticated
  using (workspace_id = public.my_workspace() and (user_id = auth.uid() or public.acad_is_staff()));
drop policy if exists "acad members admin write" on public.acad_members;
create policy "acad members admin write" on public.acad_members for all to authenticated
  using (workspace_id = public.my_workspace() and public.acad_is_admin())
  with check (workspace_id = public.my_workspace() and public.acad_is_admin());

-- settings: everyone in the Academy reads (the certificate needs it), admins write
drop policy if exists "acad settings read" on public.acad_settings;
create policy "acad settings read" on public.acad_settings for select to authenticated
  using (workspace_id = public.my_workspace() and public.acad_role() is not null);
drop policy if exists "acad settings admin write" on public.acad_settings;
create policy "acad settings admin write" on public.acad_settings for all to authenticated
  using (workspace_id = public.my_workspace() and public.acad_is_admin())
  with check (workspace_id = public.my_workspace() and public.acad_is_admin());

-- courses and their content
drop policy if exists "acad courses read" on public.acad_courses;
create policy "acad courses read" on public.acad_courses for select to authenticated
  using (public.acad_course_visible(id));
drop policy if exists "acad courses staff write" on public.acad_courses;
create policy "acad courses staff write" on public.acad_courses for all to authenticated
  using (workspace_id = public.my_workspace() and public.acad_is_staff())
  with check (workspace_id = public.my_workspace() and public.acad_is_staff());

drop policy if exists "acad modules read" on public.acad_modules;
create policy "acad modules read" on public.acad_modules for select to authenticated
  using (public.acad_course_visible(course_id));
drop policy if exists "acad modules staff write" on public.acad_modules;
create policy "acad modules staff write" on public.acad_modules for all to authenticated
  using (public.acad_staff_owns_course(course_id)) with check (public.acad_staff_owns_course(course_id));

drop policy if exists "acad lessons read" on public.acad_lessons;
create policy "acad lessons read" on public.acad_lessons for select to authenticated
  using (public.acad_course_visible(public.acad_module_course(module_id)));
drop policy if exists "acad lessons staff write" on public.acad_lessons;
create policy "acad lessons staff write" on public.acad_lessons for all to authenticated
  using (public.acad_staff_owns_course(public.acad_module_course(module_id)))
  with check (public.acad_staff_owns_course(public.acad_module_course(module_id)));

drop policy if exists "acad flashcards read" on public.acad_flashcards;
create policy "acad flashcards read" on public.acad_flashcards for select to authenticated
  using (public.acad_course_visible(public.acad_module_course(module_id)));
drop policy if exists "acad flashcards staff write" on public.acad_flashcards;
create policy "acad flashcards staff write" on public.acad_flashcards for all to authenticated
  using (public.acad_staff_owns_course(public.acad_module_course(module_id)))
  with check (public.acad_staff_owns_course(public.acad_module_course(module_id)));

-- paths
drop policy if exists "acad paths read" on public.acad_paths;
create policy "acad paths read" on public.acad_paths for select to authenticated
  using (public.acad_path_visible(id));
drop policy if exists "acad paths staff write" on public.acad_paths;
create policy "acad paths staff write" on public.acad_paths for all to authenticated
  using (workspace_id = public.my_workspace() and public.acad_is_staff())
  with check (workspace_id = public.my_workspace() and public.acad_is_staff());

drop policy if exists "acad path courses read" on public.acad_path_courses;
create policy "acad path courses read" on public.acad_path_courses for select to authenticated
  using (public.acad_path_visible(path_id));
drop policy if exists "acad path courses staff write" on public.acad_path_courses;
create policy "acad path courses staff write" on public.acad_path_courses for all to authenticated
  using (public.acad_staff_owns_path(path_id)) with check (public.acad_staff_owns_path(path_id));

drop policy if exists "acad path audience staff" on public.acad_path_audience;
create policy "acad path audience staff" on public.acad_path_audience for all to authenticated
  using (public.acad_staff_owns_path(path_id)) with check (public.acad_staff_owns_path(path_id));

-- questions: learners see module-quiz questions of courses they can see, never
-- the exam bank (they get exam questions from acad_start_exam). Staff all.
drop policy if exists "acad questions read" on public.acad_questions;
create policy "acad questions read" on public.acad_questions for select to authenticated
  using (
    (module_id is not null and public.acad_course_visible(public.acad_module_course(module_id)))
    or (path_id is not null and public.acad_staff_owns_path(path_id))
  );
drop policy if exists "acad questions staff write" on public.acad_questions;
create policy "acad questions staff write" on public.acad_questions for all to authenticated
  using ((module_id is not null and public.acad_staff_owns_course(public.acad_module_course(module_id)))
      or (path_id is not null and public.acad_staff_owns_path(path_id)))
  with check ((module_id is not null and public.acad_staff_owns_course(public.acad_module_course(module_id)))
      or (path_id is not null and public.acad_staff_owns_path(path_id)));

-- answer keys: staff only, through the question they belong to
drop policy if exists "acad keys staff" on public.acad_answer_keys;
create policy "acad keys staff" on public.acad_answer_keys for all to authenticated
  using (exists (select 1 from public.acad_questions q where q.id = question_id
                  and ((q.module_id is not null and public.acad_staff_owns_course(public.acad_module_course(q.module_id)))
                    or (q.path_id is not null and public.acad_staff_owns_path(q.path_id)))))
  with check (exists (select 1 from public.acad_questions q where q.id = question_id
                  and ((q.module_id is not null and public.acad_staff_owns_course(public.acad_module_course(q.module_id)))
                    or (q.path_id is not null and public.acad_staff_owns_path(q.path_id)))));

-- progress: your own, on lessons you can see. Staff read everyone's.
drop policy if exists "acad progress own" on public.acad_progress;
create policy "acad progress own" on public.acad_progress for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid()
    and exists (select 1 from public.acad_lessons l where l.id = lesson_id));
drop policy if exists "acad progress staff read" on public.acad_progress;
create policy "acad progress staff read" on public.acad_progress for select to authenticated
  using (public.acad_is_staff() and exists (
    select 1 from public.memberships m where m.user_id = acad_progress.user_id and m.workspace_id = public.my_workspace()));

-- attempts, exams, certificates: read own (staff read all), written only by functions
drop policy if exists "acad quiz attempts read" on public.acad_quiz_attempts;
create policy "acad quiz attempts read" on public.acad_quiz_attempts for select to authenticated
  using (user_id = auth.uid() or (public.acad_is_staff() and public.acad_module_course(module_id) in
    (select id from public.acad_courses where workspace_id = public.my_workspace())));
drop policy if exists "acad exams read" on public.acad_exams;
create policy "acad exams read" on public.acad_exams for select to authenticated
  using (user_id = auth.uid() or public.acad_staff_owns_path(path_id));
drop policy if exists "acad certificates read" on public.acad_certificates;
create policy "acad certificates read" on public.acad_certificates for select to authenticated
  using (user_id = auth.uid() or public.acad_staff_owns_path(path_id));

-- reviews: write your own on a course you can see; staff read all
drop policy if exists "acad reviews own" on public.acad_reviews;
create policy "acad reviews own" on public.acad_reviews for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.acad_course_visible(course_id));
drop policy if exists "acad reviews staff read" on public.acad_reviews;
create policy "acad reviews staff read" on public.acad_reviews for select to authenticated
  using (public.acad_staff_owns_course(course_id));

-- ── 8. functions the apps call ─────────────────────────────────────────────

-- Who am I in the Academy (the app calls this first).
create or replace function public.acad_me()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'user_id', auth.uid(),
    'role', public.acad_role(),
    'workspace_id', public.my_workspace(),
    'name', (select full_name from public.profiles where id = auth.uid()),
    'email', (select email from auth.users where id = auth.uid())
  )
$$;

-- Module quiz: marks the answers, records the attempt, and shows the right
-- answers (quizzes are for learning). Free-text questions are not marked;
-- the model answer is shown so the learner can compare.
create or replace function public.acad_grade_quiz(p_module uuid, p_answers jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_results jsonb := '[]'::jsonb;
  v_score int := 0;
  v_total int := 0;
  v_pass int;
  rq record;
  v_given jsonb;
  v_ok boolean;
begin
  if not public.acad_course_visible(public.acad_module_course(p_module)) then
    raise exception 'not allowed';
  end if;
  select pass_pct into v_pass from public.acad_modules where id = p_module;

  for rq in
    select q.id, q.kind, q.explanation, k.correct_index, k.model_answer
      from public.acad_questions q
      left join public.acad_answer_keys k on k.question_id = q.id
     where q.module_id = p_module
     order by q.position
  loop
    v_given := p_answers -> rq.id::text;
    if rq.kind = 'choice' then
      v_total := v_total + 1;
      v_ok := v_given is not null and jsonb_typeof(v_given) = 'number'
              and rq.correct_index is not null and (v_given)::text::int = rq.correct_index;
      if v_ok then v_score := v_score + 1; end if;
      v_results := v_results || jsonb_build_object('id', rq.id, 'correct', v_ok,
        'correct_index', rq.correct_index, 'explanation', rq.explanation);
    else
      v_results := v_results || jsonb_build_object('id', rq.id, 'correct', null,
        'model_answer', rq.model_answer, 'explanation', rq.explanation);
    end if;
  end loop;

  insert into public.acad_quiz_attempts (user_id, module_id, score, total, passed)
  values (auth.uid(), p_module, v_score, v_total,
          v_total = 0 or (v_score * 100) >= (coalesce(v_pass, 70) * v_total));

  return jsonb_build_object('score', v_score, 'total', v_total,
    'passed', v_total = 0 or (v_score * 100) >= (coalesce(v_pass, 70) * v_total),
    'results', v_results);
end $$;

-- Lessons in a path, and how many the caller has done.
create or replace function public.acad_path_progress(p_path uuid, p_user uuid default null)
returns table (lessons_total int, lessons_done int)
language sql stable security definer set search_path = public, pg_temp as $$
  select count(l.id)::int,
         count(pr.lesson_id)::int
    from public.acad_path_courses pc
    join public.acad_courses c on c.id = pc.course_id and c.status = 'published'
    join public.acad_modules m on m.course_id = c.id
    join public.acad_lessons l on l.module_id = m.id
    left join public.acad_progress pr on pr.lesson_id = l.id
          and pr.user_id = coalesce(case when public.acad_is_staff() then p_user end, auth.uid())
   where pc.path_id = p_path and public.acad_path_visible(p_path)
$$;

-- Final exam: draw the questions. Balanced across easy, medium and hard when
-- the bank allows, random within each. Checks the attempt limit.
create or replace function public.acad_start_exam(p_path uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p public.acad_paths;
  v_used int;
  v_ids uuid[];
  v_exam uuid;
  v_deadline timestamptz;
  v_per int;
  v_open public.acad_exams;
  v_prog record;
begin
  select * into p from public.acad_paths where id = p_path;
  if p.id is null or not public.acad_path_visible(p_path) or not p.has_final then
    raise exception 'not allowed';
  end if;

  -- must have finished every lesson first
  select * into v_prog from public.acad_path_progress(p_path);
  if v_prog.lessons_done < v_prog.lessons_total then
    raise exception 'finish every lesson before the final assessment';
  end if;

  -- an unfinished attempt still in time is resumed, not restarted
  select * into v_open from public.acad_exams
   where user_id = auth.uid() and path_id = p_path and submitted_at is null
     and (deadline is null or deadline > now())
   order by started_at desc limit 1;
  if v_open.id is not null then
    v_exam := v_open.id; v_ids := v_open.question_ids; v_deadline := v_open.deadline;
  else
    select count(*) into v_used from public.acad_exams where user_id = auth.uid() and path_id = p_path;
    if p.attempts_allowed is not null and v_used >= p.attempts_allowed then
      raise exception 'no attempts left';
    end if;
    if exists (select 1 from public.acad_certificates where user_id = auth.uid() and path_id = p_path) then
      raise exception 'already passed';
    end if;

    v_per := ceil(p.exam_size / 3.0);
    with ranked as (
      select q.id, q.difficulty,
             row_number() over (partition by q.difficulty order by random()) as rn
        from public.acad_questions q where q.path_id = p_path
    ), first_pick as (
      select id from ranked where rn <= v_per
    ), rest as (
      select id from ranked where id not in (select id from first_pick) order by random()
    )
    select array_agg(id) into v_ids from (
      select id from (select id, 0 as pri, random() r from first_pick
                      union all select id, 1, random() from rest) x
       order by pri, r limit p.exam_size
    ) y;

    if v_ids is null or array_length(v_ids, 1) = 0 then
      raise exception 'this path has no exam questions yet';
    end if;

    v_deadline := case when p.time_limit_min is not null then now() + make_interval(mins => p.time_limit_min) end;
    insert into public.acad_exams (user_id, path_id, question_ids, deadline)
    values (auth.uid(), p_path, v_ids, v_deadline) returning id into v_exam;
  end if;

  return jsonb_build_object(
    'exam_id', v_exam,
    'deadline', v_deadline,
    'questions', (select jsonb_agg(jsonb_build_object('id', q.id, 'prompt', q.prompt, 'choices', q.choices)
                                   order by array_position(v_ids, q.id))
                    from public.acad_questions q where q.id = any (v_ids))
  );
end $$;

-- Final exam: mark it. Returns only the score. Issues the certificate on a pass.
create or replace function public.acad_submit_exam(p_exam uuid, p_answers jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  e public.acad_exams;
  p public.acad_paths;
  v_score int := 0;
  v_total int;
  v_passed boolean;
  v_cert text;
begin
  select * into e from public.acad_exams where id = p_exam and user_id = auth.uid() for update;
  if e.id is null then raise exception 'not allowed'; end if;
  if e.submitted_at is not null then raise exception 'already submitted'; end if;
  select * into p from public.acad_paths where id = e.path_id;

  v_total := array_length(e.question_ids, 1);
  -- one minute's grace for a slow connection; later than that scores zero
  if e.deadline is null or now() <= e.deadline + interval '1 minute' then
    select count(*) into v_score
      from public.acad_answer_keys k
     where k.question_id = any (e.question_ids)
       and jsonb_typeof(p_answers -> k.question_id::text) = 'number'
       and (p_answers ->> k.question_id::text)::int = k.correct_index;
  end if;
  v_passed := (v_score * 100) >= (p.pass_pct * v_total);

  update public.acad_exams set submitted_at = now(), score = v_score, total = v_total, passed = v_passed
   where id = e.id;

  if v_passed then
    insert into public.acad_certificates (user_id, path_id, score)
    values (auth.uid(), e.path_id, round(v_score * 100.0 / v_total))
    on conflict (user_id, path_id) do nothing;
    select code into v_cert from public.acad_certificates where user_id = auth.uid() and path_id = e.path_id;
  end if;

  return jsonb_build_object('score', v_score, 'total', v_total, 'passed', v_passed,
    'pass_pct', p.pass_pct, 'certificate', v_cert,
    'attempts_left', case when p.attempts_allowed is null then null
      else greatest(p.attempts_allowed - (select count(*) from public.acad_exams where user_id = auth.uid() and path_id = e.path_id), 0) end);
end $$;

-- A path without a final assessment: certificate once every lesson is done.
create or replace function public.acad_claim_certificate(p_path uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_prog record;
  v_code text;
begin
  if not public.acad_path_visible(p_path)
     or exists (select 1 from public.acad_paths where id = p_path and has_final) then
    raise exception 'not allowed';
  end if;
  select * into v_prog from public.acad_path_progress(p_path);
  if v_prog.lessons_total = 0 or v_prog.lessons_done < v_prog.lessons_total then
    raise exception 'finish every lesson first';
  end if;
  insert into public.acad_certificates (user_id, path_id) values (auth.uid(), p_path)
  on conflict (user_id, path_id) do nothing;
  select code into v_code from public.acad_certificates where user_id = auth.uid() and path_id = p_path;
  return v_code;
end $$;

-- Certificate details for printing (own, or any for staff).
create or replace function public.acad_certificate(p_code text)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'code', c.code, 'issued_at', c.issued_at, 'score', c.score,
    'learner', coalesce(pr.full_name, u.email), 'path', p.title,
    'academy', coalesce(s.academy_name, 'MadeEA Academy'),
    'signer_name', s.signer_name, 'signer_title', s.signer_title, 'signature_path', s.signature_path)
    from public.acad_certificates c
    join public.acad_paths p on p.id = c.path_id and p.workspace_id = public.my_workspace()
    join auth.users u on u.id = c.user_id
    left join public.profiles pr on pr.id = c.user_id
    left join public.acad_settings s on s.workspace_id = p.workspace_id
   where c.code = upper(p_code) and (c.user_id = auth.uid() or public.acad_is_staff())
$$;

-- Studio: everyone in the workspace, with Academy role and progress.
create or replace function public.acad_people()
returns table (user_id uuid, name text, email text, hub_role text, role text, region text, team text,
               paths_assigned int, lessons_total int, lessons_done int, certificates int, last_active timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  with ws as (select public.my_workspace() as id)
  select m.user_id,
         coalesce(pr.full_name, split_part(u.email, '@', 1)),
         u.email::text,
         m.role::text,
         public.acad_role_of(m.user_id),
         am.region, am.team,
         (select count(*) from public.acad_paths p, ws
           where p.workspace_id = ws.id and p.status = 'published'
             and (p.audience = 'all' or exists (select 1 from public.acad_path_audience a where a.path_id = p.id and (
                  (a.kind = 'user' and a.value = m.user_id::text)
                  or (a.kind = 'region' and lower(a.value) = lower(coalesce(am.region, '')))
                  or (a.kind = 'team' and lower(a.value) = lower(coalesce(am.team, '')))))))::int,
         (select count(distinct l.id) from public.acad_paths p
            join public.acad_path_courses pc on pc.path_id = p.id
            join public.acad_courses c on c.id = pc.course_id and c.status = 'published'
            join public.acad_modules md on md.course_id = c.id
            join public.acad_lessons l on l.module_id = md.id, ws
           where p.workspace_id = ws.id and p.status = 'published'
             and (p.audience = 'all' or exists (select 1 from public.acad_path_audience a where a.path_id = p.id and (
                  (a.kind = 'user' and a.value = m.user_id::text)
                  or (a.kind = 'region' and lower(a.value) = lower(coalesce(am.region, '')))
                  or (a.kind = 'team' and lower(a.value) = lower(coalesce(am.team, '')))))))::int,
         (select count(*) from public.acad_progress x
            join public.acad_lessons l on l.id = x.lesson_id
            join public.acad_modules md on md.id = l.module_id
            join public.acad_courses c on c.id = md.course_id, ws
           where x.user_id = m.user_id and c.workspace_id = ws.id)::int,
         (select count(*) from public.acad_certificates ce join public.acad_paths p on p.id = ce.path_id, ws
           where ce.user_id = m.user_id and p.workspace_id = ws.id)::int,
         (select max(x.completed_at) from public.acad_progress x where x.user_id = m.user_id)
    from public.memberships m
    join ws on m.workspace_id = ws.id
    join auth.users u on u.id = m.user_id
    left join public.profiles pr on pr.id = m.user_id
    left join public.acad_members am on am.user_id = m.user_id and am.workspace_id = ws.id
   where public.acad_is_staff()
   order by 2
$$;

-- Studio reports: one row per published path.
create or replace function public.acad_path_report()
returns table (path_id uuid, title text, assigned int, started int, completed int, avg_score numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  with people as (select * from public.acad_people()),
  paths as (select * from public.acad_paths where workspace_id = public.my_workspace() and status = 'published')
  select p.id, p.title,
    (select count(*) from people pe left join public.acad_members am on am.user_id = pe.user_id and am.workspace_id = p.workspace_id
      where p.audience = 'all' or exists (select 1 from public.acad_path_audience a where a.path_id = p.id and (
             (a.kind = 'user' and a.value = pe.user_id::text)
             or (a.kind = 'region' and lower(a.value) = lower(coalesce(am.region, '')))
             or (a.kind = 'team' and lower(a.value) = lower(coalesce(am.team, ''))))))::int,
    (select count(distinct x.user_id) from public.acad_progress x
       join public.acad_lessons l on l.id = x.lesson_id
       join public.acad_modules md on md.id = l.module_id
       join public.acad_path_courses pc on pc.course_id = md.course_id
      where pc.path_id = p.id)::int,
    (select count(*) from public.acad_certificates c where c.path_id = p.id)::int,
    (select round(avg(e.score * 100.0 / nullif(e.total, 0)), 0) from public.acad_exams e
      where e.path_id = p.id and e.submitted_at is not null)
  from paths p
  where public.acad_is_staff()
  order by p.title
$$;

-- Studio reviews: learner feedback with names.
create or replace function public.acad_review_list()
returns table (id uuid, course_id uuid, course text, learner text, rating int, comment text, created_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select r.id, c.id, c.title, coalesce(pr.full_name, u.email::text), r.rating, r.comment, r.created_at
    from public.acad_reviews r
    join public.acad_courses c on c.id = r.course_id and c.workspace_id = public.my_workspace()
    join auth.users u on u.id = r.user_id
    left join public.profiles pr on pr.id = r.user_id
   where public.acad_is_staff()
   order by r.created_at desc
$$;

-- Save a question and its answer key in one call (Studio).
create or replace function public.acad_save_question(p jsonb)
returns uuid language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if p ? 'id' and nullif(p ->> 'id', '') is not null then
    update public.acad_questions set
      kind = coalesce(p ->> 'kind', kind),
      prompt = p ->> 'prompt',
      choices = coalesce(p -> 'choices', '[]'::jsonb),
      explanation = nullif(p ->> 'explanation', ''),
      difficulty = coalesce(p ->> 'difficulty', difficulty),
      position = coalesce((p ->> 'position')::int, position)
    where id = (p ->> 'id')::uuid returning id into v_id;
  else
    insert into public.acad_questions (module_id, path_id, kind, prompt, choices, explanation, difficulty, position)
    values (nullif(p ->> 'module_id', '')::uuid, nullif(p ->> 'path_id', '')::uuid,
            coalesce(p ->> 'kind', 'choice'), p ->> 'prompt', coalesce(p -> 'choices', '[]'::jsonb),
            nullif(p ->> 'explanation', ''), coalesce(p ->> 'difficulty', 'medium'),
            coalesce((p ->> 'position')::int, 0))
    returning id into v_id;
  end if;
  if v_id is null then raise exception 'not allowed'; end if;
  insert into public.acad_answer_keys (question_id, correct_index, model_answer)
  values (v_id, (p ->> 'correct_index')::int, nullif(p ->> 'model_answer', ''))
  on conflict (question_id) do update set correct_index = excluded.correct_index, model_answer = excluded.model_answer;
  return v_id;
end $$;

-- Copy a whole course (Studio "Duplicate").
create or replace function public.acad_duplicate_course(p_course uuid)
returns uuid language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_new uuid; m record; v_m uuid; rq record; v_q uuid;
begin
  insert into public.acad_courses (title, description, level, icon, cover_path, status)
  select title || ' (copy)', description, level, icon, cover_path, 'draft' from public.acad_courses where id = p_course
  returning id into v_new;
  if v_new is null then raise exception 'not allowed'; end if;
  for m in select * from public.acad_modules where course_id = p_course order by position loop
    insert into public.acad_modules (course_id, title, position, pass_pct) values (v_new, m.title, m.position, m.pass_pct)
    returning id into v_m;
    insert into public.acad_lessons (module_id, title, minutes, blocks, position)
      select v_m, title, minutes, blocks, position from public.acad_lessons where module_id = m.id;
    insert into public.acad_flashcards (module_id, front, back, position)
      select v_m, front, back, position from public.acad_flashcards where module_id = m.id;
    for rq in select q.*, k.correct_index, k.model_answer from public.acad_questions q
               left join public.acad_answer_keys k on k.question_id = q.id where q.module_id = m.id loop
      insert into public.acad_questions (module_id, kind, prompt, choices, explanation, difficulty, position)
      values (v_m, rq.kind, rq.prompt, rq.choices, rq.explanation, rq.difficulty, rq.position) returning id into v_q;
      insert into public.acad_answer_keys (question_id, correct_index, model_answer) values (v_q, rq.correct_index, rq.model_answer);
    end loop;
  end loop;
  return v_new;
end $$;

revoke execute on function public.acad_people() from public, anon;
revoke execute on function public.acad_path_report() from public, anon;
revoke execute on function public.acad_review_list() from public, anon;
revoke execute on function public.acad_grade_quiz(uuid, jsonb) from public, anon;
revoke execute on function public.acad_start_exam(uuid) from public, anon;
revoke execute on function public.acad_submit_exam(uuid, jsonb) from public, anon;
revoke execute on function public.acad_claim_certificate(uuid) from public, anon;
revoke execute on function public.acad_certificate(text) from public, anon;
revoke execute on function public.acad_me() from public, anon;
grant execute on function public.acad_people(), public.acad_path_report(), public.acad_review_list(),
  public.acad_grade_quiz(uuid, jsonb), public.acad_start_exam(uuid), public.acad_submit_exam(uuid, jsonb),
  public.acad_claim_certificate(uuid), public.acad_certificate(text), public.acad_me(),
  public.acad_save_question(jsonb), public.acad_duplicate_course(uuid),
  public.acad_path_progress(uuid, uuid) to authenticated;

-- ── 9. media storage (images, videos, signatures) ──────────────────────────
-- Public read so lesson images and videos load in a plain <img>/<video>;
-- file names are random. Only Academy staff can upload or delete.
insert into storage.buckets (id, name, public, file_size_limit)
values ('academy-media', 'academy-media', true, 52428800)
on conflict (id) do update set public = true;

drop policy if exists "academy media staff insert" on storage.objects;
create policy "academy media staff insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'academy-media' and public.acad_is_staff()
              and (storage.foldername(name))[1] = public.my_workspace()::text);
drop policy if exists "academy media staff update" on storage.objects;
create policy "academy media staff update" on storage.objects for update to authenticated
  using (bucket_id = 'academy-media' and public.acad_is_staff()
         and (storage.foldername(name))[1] = public.my_workspace()::text);
drop policy if exists "academy media staff delete" on storage.objects;
create policy "academy media staff delete" on storage.objects for delete to authenticated
  using (bucket_id = 'academy-media' and public.acad_is_staff()
         and (storage.foldername(name))[1] = public.my_workspace()::text);

-- ── 10. bring the Made Ready course across, as a draft ─────────────────────
-- Once per workspace that has it. Days become modules; lesson text becomes a
-- text block (video lessons keep their link); the module quizzes and their
-- keys come too. Practical and simulation lessons come across as reading.
do $import$
declare
  w record; v_course uuid; am record; v_mod uuid; al record; rq record; v_q uuid; v_blocks jsonb;
begin
  for w in
    select distinct workspace_id from public.academy_modules where workspace_id is not null
  loop
    if exists (select 1 from public.acad_courses where workspace_id = w.workspace_id and title = 'Made Ready: AI-Powered EA Foundations') then
      continue;
    end if;
    insert into public.acad_courses (workspace_id, title, description, level, icon, status, created_by)
    values (w.workspace_id, 'Made Ready: AI-Powered EA Foundations',
            'The Made Ready course, brought across from the Hub''s Training Center. Edit it here, then add it to a learning path.',
            'beginner', 'graduation', 'draft', null)
    returning id into v_course;

    for am in select * from public.academy_modules where workspace_id = w.workspace_id and is_published order by day, position loop
      insert into public.acad_modules (course_id, title, position, pass_pct)
      values (v_course, am.title, am.day * 100 + am.position, am.pass_pct) returning id into v_mod;

      for al in select * from public.academy_lessons where module_id = am.id order by position loop
        v_blocks := '[]'::jsonb;
        if coalesce(al.body, '') <> '' then
          v_blocks := v_blocks || jsonb_build_array(jsonb_build_object('type', 'text', 'md', al.body));
        end if;
        if coalesce(al.video_url, '') <> '' then
          v_blocks := v_blocks || jsonb_build_array(jsonb_build_object('type', 'video', 'url', al.video_url));
        end if;
        insert into public.acad_lessons (module_id, title, minutes, blocks, position)
        values (v_mod, al.title, greatest(1, least(600, coalesce(al.minutes, 10))), v_blocks, al.position);
      end loop;

      for rq in select aq.*, k.correct_index from public.academy_questions aq
                 left join public.academy_answer_key k on k.question_id = aq.id
                where aq.module_id = am.id order by aq.position loop
        insert into public.acad_questions (module_id, kind, prompt, choices, explanation, position)
        values (v_mod, 'choice', rq.prompt, rq.choices, rq.explanation, rq.position) returning id into v_q;
        insert into public.acad_answer_keys (question_id, correct_index) values (v_q, rq.correct_index);
      end loop;
    end loop;
  end loop;
end $import$;
