-- 0034_academy.sql. The Made Ready Academy.
--
-- Run once in the Supabase SQL editor, after 0033.
--
-- Audit §5.2. Reichelle at 52:44 and 54:18: a short, highly visual course every
-- EA finishes BEFORE they are handed to a client, and a talking point on the
-- sales call (18:00). Three days, roughly three hours each, ending in an
-- assessment that checks they know when to use which tool.
--
-- R-5.2.1 course player + progress + completion flag
-- R-5.2.2 assessment engine with a pass/fail gate
-- R-5.2.3 admin view of who has completed what
--
-- ── Why the answer key is its own table ───────────────────────────────────
-- A gate that the person being gated can walk around is decoration. If the
-- correct answers ship to the browser (as a column on the question, or in the
-- JS bundle) then "every EA is Made Ready certified" is a claim we cannot make
-- on a sales call, because passing costs one glance at devtools.
--
-- So the key sits in academy_answer_key, which has RLS enabled and NO policies
-- at all. With RLS on, absent means denied: PostgREST cannot read it, and
-- neither can an admin through the API. The only thing that can is
-- grade_academy_attempt(), which is security definer.
--
-- Same reason academy_attempts has no insert policy. If it had one, an EA
-- could POST {passed: true} and skip the course entirely. Rows get there
-- through the grading function or not at all.
--
-- ── What this deliberately does not do ────────────────────────────────────
-- Retries are unlimited, because Reichelle's goal at 52:44 is preparedness and
-- not mastery. So a determined person can pass by repetition. That is fine and
-- is what a training course is for. What matters is that they cannot skip
-- reading the material to get there.

-- ---------- structure ----------
create table if not exists academy_modules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid default my_workspace() references workspaces (id) on delete cascade,

  -- 1, 2, 3. The three days. An integer rather than an enum so a Day 4 is an
  -- insert and not a migration.
  day integer not null,
  title text not null,
  summary text,
  -- Percentage needed to pass this module's assessment. Per module rather than
  -- one global constant, so Day 3 can be harder than Day 1 without a deploy.
  pass_pct integer not null default 80 check (pass_pct between 1 and 100),
  -- An unpublished module is invisible to learners and does not count toward
  -- completion, which is how a half-finished Day 3 avoids blocking everyone.
  is_published boolean not null default true,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists academy_lessons (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references academy_modules (id) on delete cascade,

  title text not null,
  -- reading   text the EA works through here
  -- video     FJ's recording, video_url filled in when it exists
  -- simulation an exercise they perform in the app itself
  kind text not null default 'reading' check (kind in ('reading', 'video', 'simulation')),
  body text,
  video_url text,
  minutes integer not null default 10,
  position integer not null default 0
);

create index if not exists academy_lessons_module_idx on academy_lessons (module_id, position);

-- ---------- progress ----------
-- One row per lesson a person has finished. Composite key, so marking the same
-- lesson done twice is a no-op rather than a duplicate.
create table if not exists academy_progress (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  lesson_id uuid not null references academy_lessons (id) on delete cascade,
  completed_at timestamptz not null default now(),
  primary key (user_id, lesson_id)
);

-- ---------- assessment ----------
create table if not exists academy_questions (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references academy_modules (id) on delete cascade,
  prompt text not null,
  -- ["option a", "option b", ...] in display order.
  choices jsonb not null default '[]'::jsonb,
  -- Shown after grading, so a wrong answer teaches something.
  explanation text,
  position integer not null default 0
);

create index if not exists academy_questions_module_idx on academy_questions (module_id, position);

-- The key. Read the header. Nothing selects from this except the grader.
create table if not exists academy_answer_key (
  question_id uuid primary key references academy_questions (id) on delete cascade,
  correct_index integer not null
);

create table if not exists academy_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  module_id uuid not null references academy_modules (id) on delete cascade,
  score integer not null,
  passed boolean not null,
  created_at timestamptz not null default now()
);

create index if not exists academy_attempts_user_idx on academy_attempts (user_id, module_id, created_at desc);

-- ---------- RLS ----------
alter table academy_modules   enable row level security;
alter table academy_lessons   enable row level security;
alter table academy_progress  enable row level security;
alter table academy_questions enable row level security;
alter table academy_answer_key enable row level security;
alter table academy_attempts  enable row level security;

-- Course material: everyone in the workspace reads it, admins write it.
drop policy if exists "modules readable" on academy_modules;
create policy "modules readable" on academy_modules for select to authenticated
  using (workspace_id = my_workspace());
drop policy if exists "modules admin write" on academy_modules;
create policy "modules admin write" on academy_modules for all to authenticated
  using (workspace_id = my_workspace() and is_admin())
  with check (workspace_id = my_workspace() and is_admin());

drop policy if exists "lessons readable" on academy_lessons;
create policy "lessons readable" on academy_lessons for select to authenticated
  using (exists (select 1 from academy_modules m where m.id = module_id and m.workspace_id = my_workspace()));
drop policy if exists "lessons admin write" on academy_lessons;
create policy "lessons admin write" on academy_lessons for all to authenticated
  using (is_admin() and exists (select 1 from academy_modules m where m.id = module_id and m.workspace_id = my_workspace()))
  with check (is_admin() and exists (select 1 from academy_modules m where m.id = module_id and m.workspace_id = my_workspace()));

-- Questions are readable without their answers, which is the point of the split.
drop policy if exists "questions readable" on academy_questions;
create policy "questions readable" on academy_questions for select to authenticated
  using (exists (select 1 from academy_modules m where m.id = module_id and m.workspace_id = my_workspace()));
drop policy if exists "questions admin write" on academy_questions;
create policy "questions admin write" on academy_questions for all to authenticated
  using (is_admin() and exists (select 1 from academy_modules m where m.id = module_id and m.workspace_id = my_workspace()))
  with check (is_admin() and exists (select 1 from academy_modules m where m.id = module_id and m.workspace_id = my_workspace()));

-- academy_answer_key: no policies, deliberately. See the header.

-- Progress is your own. Admins read everyone's, which is R-5.2.3.
drop policy if exists "progress own" on academy_progress;
create policy "progress own" on academy_progress for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "progress admin read" on academy_progress;
create policy "progress admin read" on academy_progress for select to authenticated
  using (is_admin());

-- Attempts: readable, never directly writable. See the header.
drop policy if exists "attempts own read" on academy_attempts;
create policy "attempts own read" on academy_attempts for select to authenticated
  using (user_id = auth.uid() or is_admin());

-- ---------- the grader ----------
-- Takes {"<question_id>": <chosen_index>}, marks it against the hidden key,
-- records the attempt, and hands back enough for the learner to review.
--
-- Returns per-question right/wrong but never the correct index. Someone who
-- fails should know which three to go back over; they should not be handed the
-- key one submission at a time.
create or replace function grade_academy_attempt(p_module_id uuid, p_answers jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $grade$
declare
  m academy_modules%rowtype;
  total integer;
  correct integer;
  pct integer;
  did_pass boolean;
  per_question jsonb;
begin
  -- Workspace check first: security definer means RLS is not doing it for us.
  select * into m from academy_modules
   where id = p_module_id and workspace_id = my_workspace() and is_published;
  if not found then
    raise exception 'module not available';
  end if;

  select count(*) into total from academy_questions q where q.module_id = p_module_id;
  if total = 0 then
    raise exception 'module has no questions';
  end if;

  -- A missing or unparseable answer counts as wrong rather than erroring, so a
  -- half-finished submission grades as a fail instead of losing the attempt.
  select
    count(*) filter (where k.correct_index = nullif(p_answers ->> q.id::text, '')::integer),
    jsonb_object_agg(
      q.id::text,
      jsonb_build_object(
        -- coalesce, because an unanswered question compares to null, and the
        -- client needs false there rather than a JSON null it has to interpret.
        'correct', coalesce(k.correct_index = nullif(p_answers ->> q.id::text, '')::integer, false),
        'explanation', q.explanation
      )
    )
  into correct, per_question
  from academy_questions q
  join academy_answer_key k on k.question_id = q.id
  where q.module_id = p_module_id;

  correct := coalesce(correct, 0);
  pct := floor((correct::numeric / total) * 100);
  did_pass := pct >= m.pass_pct;

  insert into academy_attempts (module_id, score, passed) values (p_module_id, pct, did_pass);

  return jsonb_build_object(
    'score', pct, 'passed', did_pass, 'correct', correct, 'total', total,
    'pass_pct', m.pass_pct, 'questions', coalesce(per_question, '{}'::jsonb)
  );
end $grade$;

revoke execute on function grade_academy_attempt(uuid, jsonb) from public;
grant execute on function grade_academy_attempt(uuid, jsonb) to authenticated;

-- ---------- who has finished what (R-5.2.3) ----------
-- security_invoker, so the policies above decide what each caller sees: an EA
-- gets their own row, an admin gets the team. One query either way.
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
     from academy_attempts a where a.user_id = m.user_id and a.passed) as last_passed_at
from memberships m
where m.workspace_id = my_workspace();

comment on view academy_status is
  'Per-EA Academy completion. Made Ready = modules_passed >= modules_total and modules_total > 0.';

-- Note for anyone extending this: because the view is security_invoker, a
-- non-admin selecting it sees rows for colleagues with modules_passed = 0,
-- since the attempts policy hides their attempts rather than their membership.
-- Not a leak, but it is wrong-looking data, so the roster is rendered for
-- admins only. Filter by user_id = auth.uid() anywhere else.

-- ---------- the agreed outline ----------
-- Seeds the curriculum Reichelle described at 54:18 into every workspace that
-- has none. Idempotent, and safe to run from the SQL editor where auth.uid()
-- is null, because it works from the workspaces table rather than my_workspace().
--
-- Day 1 is "foundations" because the spec says so. The split of the remaining
-- agreed topics across Days 2 and 3 is an arrangement, not a team decision, and
-- the app labels it as a draft for Reichelle to confirm. Lesson bodies are
-- scaffolding: FJ owns the real content and the videos (Rowena 52:34), and any
-- lesson without a video_url says so on screen rather than showing a play
-- button that does nothing.
do $seed$
declare
  w record;
  m1 uuid; m2 uuid; m3 uuid;
begin
  for w in select id from workspaces loop
    if exists (select 1 from academy_modules where workspace_id = w.id) then
      continue;
    end if;

    insert into academy_modules (workspace_id, day, title, summary, position, pass_pct)
    values (w.id, 1, 'Foundations',
      'How the Command Center works and what good EA output looks like here. Reichelle: Day 1 is foundations.', 1, 80)
    returning id into m1;

    insert into academy_modules (workspace_id, day, title, summary, position, pass_pct)
    values (w.id, 2, 'The AI toolkit',
      'AI tools beyond ChatGPT, Claude and Gemini, and what each one is actually for. Draft arrangement, pending Reichelle.', 2, 80)
    returning id into m2;

    insert into academy_modules (workspace_id, day, title, summary, position, pass_pct)
    values (w.id, 3, 'Simulation and practice',
      'Run a real day end to end, then navigate the app under time pressure. Draft arrangement, pending Reichelle.', 3, 80)
    returning id into m3;

    insert into academy_lessons (module_id, title, kind, minutes, position, body) values
      (m1, 'Welcome to Made Ready', 'video', 10, 1,
       'Why this course exists: you finish it before your first day with a client, so day one is not your training day.'),
      (m1, 'The Command Center in ten minutes', 'video', 15, 2,
       'Dashboard, Tasks, Communication, EOD. Where the day starts and where it ends.'),
      (m1, 'What good output looks like', 'reading', 20, 3,
       'Every client-facing piece of work follows an SOP. SOPs are what keep quality standard across EAs (Rowena 54:55).'),
      (m1, 'Your first task, start to finish', 'simulation', 25, 4,
       'Open Tasks, pick anything in To Do, move it through In Progress and Review, and leave a comment explaining what you did.'),

      (m2, 'Beyond the big three', 'video', 20, 1,
       'Most EAs only use ChatGPT, Claude and Gemini. That is the gap this closes (Reichelle 53:00).'),
      (m2, 'What each tool is for', 'reading', 30, 2,
       'Tool by tool: what it does well, what it does badly, and the EA task it belongs to. Content pending from FJ.'),
      (m2, 'Choosing the right tool', 'reading', 20, 3,
       'The assessment checks this: not whether you can name the tools, but whether you pick the right one for the job in front of you.'),

      (m3, 'A full day, simulated', 'simulation', 45, 1,
       'Morning brief through to EOD report, on a practice client, with the clock running.'),
      (m3, 'Navigation under pressure', 'simulation', 20, 2,
       'Find things fast. Command palette, search, filters.'),
      (m3, 'Handover and escalation', 'reading', 20, 3,
       'When to flag a blocker rather than push through it, and how to write it so somebody can act on it.');

    -- Draft questions so the gate is live the day the migration runs. Each one
    -- tests a rule this app or the spec actually states, so none of it is
    -- invented curriculum. Reichelle and FJ replace them from the admin tab.
    declare
      q uuid;
    begin
      insert into academy_questions (module_id, prompt, choices, explanation, position) values
        (m1, 'You finish a client task but you are not certain it is right. What happens next?',
         '["Move it straight to Done", "Move it to Review so an admin approves it", "Leave it in progress and mention it tomorrow", "Delete it and start again"]'::jsonb,
         'Review exists so uncertain work gets a second pair of eyes before the client sees it. Tasks marked as needing approval cannot reach Done without one.', 1)
        returning id into q;
      insert into academy_answer_key values (q, 1);

      insert into academy_questions (module_id, prompt, choices, explanation, position) values
        (m1, 'What is an EOD report for?',
         '["Proving you were online", "Showing the client what moved today and what is blocked", "Replacing the task board", "Logging your hours"]'::jsonb,
         'The EOD is the client-facing record of progress and blockers. Attendance and hours are tracked separately.', 2)
        returning id into q;
      insert into academy_answer_key values (q, 1);

      insert into academy_questions (module_id, prompt, choices, explanation, position) values
        (m1, 'A client asks you to do something no SOP covers. What is the right move?',
         '["Improvise and keep it to yourself", "Refuse until an SOP exists", "Do it, then write the SOP so the next person does it the same way", "Send it back to the client"]'::jsonb,
         'SOPs are how output stays consistent across EAs (Rowena 54:55). New work becomes a new SOP.', 3)
        returning id into q;
      insert into academy_answer_key values (q, 2);

      insert into academy_questions (module_id, prompt, choices, explanation, position) values
        (m1, 'Where do client logins belong?',
         '["A shared spreadsheet", "The Password Manager, encrypted", "A pinned chat message", "Your notes app"]'::jsonb,
         'Rowena 1:02:07. Credentials go in the vault, encrypted in the browser before they are stored. Better still, ask for delegated access instead of a password.', 4)
        returning id into q;
      insert into academy_answer_key values (q, 1);

      insert into academy_questions (module_id, prompt, choices, explanation, position) values
        (m1, 'A task recurs every Monday whether or not last Monday finished. What creates it?',
         '["A routine", "Marking the previous one done", "The client", "Nothing, you create it by hand"]'::jsonb,
         'Routines are calendar driven. Task recurrence is completion driven. Weekly reports are the first kind.', 5)
        returning id into q;
      insert into academy_answer_key values (q, 0);

      insert into academy_questions (module_id, prompt, choices, explanation, position) values
        (m2, 'An executive wants a 40 page contract summarised with the risky clauses called out. Which tool fits?',
         '["An image generator", "A long-context assistant that can read the whole document", "A scheduling tool", "A transcription tool"]'::jsonb,
         'Match the tool to the shape of the job. Long document in, structured summary out.', 1)
        returning id into q;
      insert into academy_answer_key values (q, 1);

      insert into academy_questions (module_id, prompt, choices, explanation, position) values
        (m2, 'You need the decisions and owners out of a recorded call. Which tool fits?',
         '["A spreadsheet formula", "A transcription and meeting-notes tool", "A design tool", "A password manager"]'::jsonb,
         'Transcription first, then extraction. Do not retype a call by hand.', 2)
        returning id into q;
      insert into academy_answer_key values (q, 1);

      insert into academy_questions (module_id, prompt, choices, explanation, position) values
        (m2, 'An AI tool gives you a client figure you cannot verify. What do you do?',
         '["Send it, it came from the AI", "Check it against the source before it leaves the building", "Round it down to be safe", "Ask the client to confirm it"]'::jsonb,
         'Anything client-facing is your output, not the tool''s. Unverified numbers do not go out.', 3)
        returning id into q;
      insert into academy_answer_key values (q, 1);

      insert into academy_questions (module_id, prompt, choices, explanation, position) values
        (m3, 'You are blocked at 3pm on the only task the client cares about. What happens?',
         '["Wait and mention it in the EOD", "Flag the blocker now with what you need to unblock it", "Work around it quietly", "Move it to Done and add a note"]'::jsonb,
         'A blocker is worth flagging the moment it exists. The EOD records it, it does not discover it.', 1)
        returning id into q;
      insert into academy_answer_key values (q, 1);

      insert into academy_questions (module_id, prompt, choices, explanation, position) values
        (m3, 'Your assignment with a client ends. What has to happen to their credentials?',
         '["Nothing, access was revoked", "Revoke access and rotate anything you opened", "Delete the vault", "Email them the passwords back"]'::jsonb,
         'Revoking access cannot un-know a password somebody already read. Rotation is the part that actually protects the client.', 2)
        returning id into q;
      insert into academy_answer_key values (q, 1);
    end;
  end loop;
end $seed$;
