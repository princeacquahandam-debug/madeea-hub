-- 0096 · Made Ready: the simulation pack, trainer marking guides, and a
--        "not Made Ready yet" warning when a client is assigned.
--
-- Run once in the Supabase SQL editor, after 0095. Safe to run more than once.
--
-- 1. The final client simulation's materials now live in the lesson itself
--    (src/data/academySimulation.ts: CEO profile, calendar, 18 emails that
--    arrive while a 90-minute clock runs, and the files). The lesson text no
--    longer says the trainer hands them out.
--
-- 2. academy_trainer_notes: a marking guide per practical, for whoever reviews
--    it. Admins only, for the same reason the quiz key is hidden in 0034: the
--    learner being assessed shouldn't be able to read what a pass looks like
--    line by line. It is NOT in the JS bundle for that reason.
--
-- 3. academy_ready_roster(): who has finished the course, for the Client
--    Vault's Lead EA picker. Managers assign clients but can't read other
--    people's attempts (0034 keeps those to admins), so they would otherwise
--    see everyone as "not started". This returns counts and a yes/no only,
--    never scores or submissions, and only to owners, admins and managers.

-- ── 1. lesson text ─────────────────────────────────────────────────────────
update academy_lessons
   set body = replace(body,
     'Capstone. Your work is reviewed by an admin. Your trainer gives you the scenario materials when you start.',
     'Capstone. Your work is reviewed by an admin. Everything you need is on this page: the CEO''s profile, the calendar and the files. Press Start when you have 90 uninterrupted minutes. Emails keep arriving while the clock runs.')
 where kind = 'practical' and title like 'Final client simulation%';

-- ── 2. marking guides ──────────────────────────────────────────────────────
create table if not exists academy_trainer_notes (
  lesson_id uuid primary key references academy_lessons (id) on delete cascade,
  notes text not null
);

alter table academy_trainer_notes enable row level security;

drop policy if exists "trainer notes admin" on academy_trainer_notes;
create policy "trainer notes admin" on academy_trainer_notes for all to authenticated
  using (is_admin() and academy_lesson_in_my_workspace(lesson_id))
  with check (is_admin() and academy_lesson_in_my_workspace(lesson_id));

-- Every workspace's copy of each practical, matched by title.
insert into academy_trainer_notes (lesson_id, notes)
select l.id, g.notes
  from academy_lessons l
  join (values
('Mini exercise: organize a client workspace', $n$PASS when:
• The folder structure is simple (about 4–7 top-level folders) and makes sense for a founder: e.g. Admin, Clients, Finance, Legal, Marketing, Personal, Archive.
• The naming convention puts the date first (YYYY-MM-DD), then what the file is, then a version, and the three examples follow it.
• Each Gmail label or filter says what it catches (e.g. from:bank → Finance; has:attachment invoice → Finance/Invoices; newsletters → skip inbox).
• The AI idea is sensible (e.g. Gemini to summarise long threads, AI to suggest names for scanned files) AND they name something they wouldn't use AI for (passwords, bank or ID documents, anything not approved).

SEND BACK when: names have no date or version, folders are too many or too deep to use, or the AI answer would put sensitive documents into an unapproved tool.$n$),
('Prompt writing practical', $n$PASS when:
• The improved email is short, polite and specific: it apologises for moving Tuesday, offers two or three concrete alternatives with a time zone, and asks for the document by name. No "thx"/"u".
• Their prompt for it gives context (who it's to, what changed), the goal and limits (tone, length).
• Each of the three prompts has a role or audience, the task, the context, the output format, and boundaries such as "don't invent dates or owners; flag what's missing".
  – Summary prompt: one page, for an executive, key points + decisions + risks.
  – Minutes prompt: decisions, action items with owners and deadlines, open questions.
  – SOP prompt: trigger, steps, tools, what "done" looks like, travel policy limits.

SEND BACK when: prompts are one line with no context or format, or none of them asks the AI not to invent information.$n$),
('Day 2 practical assessment', $n$PASS when all five are there and:
• Research report: about a real company, with sources that open and say what the report claims.
• Executive briefing: one page; overview, leadership, recent news, discussion points and questions to ask. Facts match the sources.
• Meeting summary: decisions, action items with owners and deadlines; anything missing is flagged rather than invented.
• Follow-up email: short, professional, matches the summary.
• Presentation: 5–7 slides, readable, consistent with the briefing.
• They list which AI tool they used for each part and what they checked by hand.

Spot-check two facts against the sources. SEND BACK when facts are wrong or unsourced, deadlines or owners were invented, or there's no note of what was verified.$n$),
('Final client simulation (90 minutes)', $n$WHAT A STRONG ANSWER DOES (it doesn't have to match exactly; the reasons matter):

FIRST, in minutes:
• #14 gift cards "from Daniel" on a gmail address: do NOT buy anything. Treat it as a scam: don't reply to it, report it to Daniel/IT through a known channel. Any action on it is an automatic send-back.
• #6 Chicago trip: urgent and time-sensitive. Flight Wednesday after the 3pm all-hands (around 5–7pm), back Thursday afternoon after 11am; aisle, economy plus, up to $600; hotel up to $300 near 200 W Madison. Booking within policy (under $500 each, no OK needed) or holding options is fine; anything over policy needs Daniel's OK.

CALENDAR:
• #5 Halvorsen asks to move. Tomorrow 10:00 clashes with board prep, so 3:30–4:15 today is the better option. BUT #18 (arrives at 55 min) puts a deck review with Priya at 4:00 – a strong answer notices this clash and either keeps Halvorsen at 3:30 and moves Priya's review to 4:15/4:30 (internal, can be moved) or explains the trade-off to Daniel.
• #3 Marketing sync 2:00 clashes with the FleetParts vendor call 2:00–2:30 (external). Keep the external call; move the internal marketing sync (allowed without asking).
• #17 Move the 4:30 with Sam to Wednesday (not 10:00–11:30 or 2:00–3:00, and before the trip). Tell Sam.
• #9 Add the dentist to Friday 8:00 AM.
• #15 Offer Lena 15 minutes before Thursday (e.g. Wednesday morning) – useful, she has the pricing for the deck.

PRIORITY ORDER (roughly): scam → travel → Halvorsen reply and briefing (due 1:30) → Lakeside reply → calendar fixes → deck (due 3:30 after #18; they should re-prioritise when it arrives) → minutes (today) → research (before Wednesday) → the rest.

THE PIECES:
• Briefing for Halvorsen: one page, uses ONLY the figures in the notes (22% growth, 18% margin, top-3 clients = 41%); likely questions (margin, concentration, holiday peak, the two enterprise clients); honest answers on risks (Newark capacity → Secaucus approved today; Lakeside's two late deliveries; Meridian pitch Thursday). Invented numbers = send back.
• #13 Lakeside: acknowledge today, apologise, give the facts from the transcript (truck broke down; replacement loads Wednesday, delivery Thursday), say who will call; tell Daniel and Marcus. Don't promise compensation.
• Minutes (#7): decisions (Secaucus go-ahead; hire two seasonal drivers); actions with owners (Marcus: lease to legal by Friday; Marcus: overtime plan next week; HR: post driver jobs – no deadline given). Flag what's missing: who calls Lakeside, and the driver deadline.
• Deck: 5–6 slides following Priya's outline; NO pricing (Lena has it); the 98.5% on-time figure checked with Marcus or flagged, not stated as fact this month.
• #11 Elena: holding reply – Daniel will send Q3 numbers before Friday – and flag to Daniel/Priya. Don't send numbers yourself.
• Low priority: #4 newsletter (archive), #8 invoice (forward to finance, not pay), #10 recruiter (archive or polite no), #16 speaking invite (summarise for Daniel, deadline next week).
• Research (#12): real cold-chain trends with sources they've checked.

PASS when: the scam is not acted on, the trip is within policy, both conflicts are resolved with reasons, nothing is invented in the briefing or minutes, the replies are professional, and the priority list is defensible. AI use should be visible but checked.$n$)
  ) as g (title, notes) on g.title = l.title
 where l.kind = 'practical'
on conflict (lesson_id) do update set notes = excluded.notes;

-- ── 3. who is Made Ready, for the Lead EA picker ───────────────────────────
create or replace function academy_ready_roster()
returns table (user_id uuid, modules_passed integer, modules_total integer,
               practicals_passed integer, practicals_total integer, made_ready boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  with ws as (select my_workspace() as id),
  totals as (
    select (select count(*) from academy_modules am, ws where am.workspace_id = ws.id and am.is_published)::int as modules,
           (select count(*) from academy_lessons l join academy_modules am on am.id = l.module_id, ws
             where am.workspace_id = ws.id and am.is_published and l.kind = 'practical')::int as practicals
  ),
  people as (
    select m.user_id,
           (select count(distinct a.module_id) from academy_attempts a join academy_modules am on am.id = a.module_id
             where a.user_id = m.user_id and a.passed and am.is_published and am.workspace_id = ws.id)::int as modules_passed,
           (select count(*) from academy_submissions s join academy_lessons l on l.id = s.lesson_id
              join academy_modules am on am.id = l.module_id
             where s.user_id = m.user_id and s.status = 'passed' and am.is_published and l.kind = 'practical'
               and am.workspace_id = ws.id)::int as practicals_passed
      from memberships m, ws
     where m.workspace_id = ws.id
       -- Managers and up assign clients; nobody else gets rows.
       and my_role() in ('owner', 'admin', 'manager')
  )
  select p.user_id, p.modules_passed, t.modules, p.practicals_passed, t.practicals,
         t.modules > 0 and p.modules_passed >= t.modules and p.practicals_passed >= t.practicals
    from people p, totals t
$$;

revoke execute on function academy_ready_roster() from public;
grant execute on function academy_ready_roster() to authenticated;
