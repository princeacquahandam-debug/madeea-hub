# What is new in MadeEA OS

Everything added in the 10 to 17 August overhaul, what each thing is for, and
what it actually does. Companion to `TEAM-BRIEFING.md`, which is the script for
saying this out loud.

**Six new pages. Twenty new tables. Eleven new database upgrades. Nine features
on pages that already existed.** All of it is live on the real MadeEA project as
of 17 August.

---

# Part 1: New pages

Six tabs that did not exist a week ago.

---

## 1. Time

**Where:** My Day, and the Clock in button in the top bar
**Why it exists:** Every EA was using TopTracker, a tool we pay for and do not
control. Reichelle and Rowena both called bringing it in-house a launch blocker.

**What it does**

- **Clock in and out** from the top bar of any page. One button, always there.
- **Attendance is the point.** No tracker running means no attendance recorded,
  which means it affects pay. That is deliberate. It is the thing that makes
  people open the app every morning.
- **Time attaches to a task**, so hours can be split per client rather than
  being one undifferentiated blob.
- **Cutoff totals.** Hours grouped by pay period, which is what a payslip is
  calculated from. This is the number Reichelle needs for payroll and the one
  we would invoice a client from.

**Still open:** whether "the essence of TopTracker" includes screenshots and
activity monitoring. That has real privacy implications for the team and needs
Reichelle and Prince to decide. I built the timer and the timesheet, not the
surveillance.

---

## 2. Madeline Videos

**Where:** Playbook
**Why it exists:** Prince called Wing Assistant's screen recorder "a serious
feature" and asked for it directly. The idea: a client records how they want
something done, once, instead of explaining it three times.

**What it does**

- **Record your screen** from inside the app, with your voice over it.
- **Ten minute cap** per recording, on purpose. A procedure that takes longer
  than ten minutes to explain should be a written workflow.
- Stored privately. Playback uses a link that expires, so a recording cannot
  leak by URL.
- **Both EAs and clients can record.** That was Prince's specific ask.

**Not done yet:** turning a recording into a workflow automatically. Right now
you record it and write the checklist separately. Estimated 28 August.

---

## 3. Routines

**Where:** Playbook
**Why it exists:** Reichelle's example was "update the attendance sheet daily".
Work that comes back on a schedule and that nobody should have to remember to
create every morning.

**What it does**

- **Set a schedule** in plain terms: every Monday, every weekday, the 1st of the
  month.
- The task **appears on your board by itself** when it is due.
- **Lead time.** Create it a few days early so it turns up while there is still
  time to do it, not on the morning it is already late.
- Runs in the EA's own timezone, so "every Monday" means Monday where you are.

**Worth knowing:** this is different from task recurrence, and both exist on
purpose. Recurrence means "when this is done, make another one." A routine means
"every Monday, make one, whether or not last Monday's got finished." A weekly
client report is the second kind.

---

## 4. Uploads

**Where:** Clients & Files
**Why it exists:** Wing has file sharing and generous storage. Rowena flagged it
as a gap. Task attachments and SOP videos also needed somewhere to live.

**What it does**

- Upload files, organise them in folders, attach them to a client or a task.
- Private storage. Nothing is public by URL.

---

## 5. Saved

**Where:** Clients & Files
**Why it exists:** Things you want to come back to were scattered. A task, a
message, an AI output, a client. No single place held them.

**What it does**

- Bookmark anything from anywhere in the app and find it in one list.

---

## 6. Password Manager

**Where:** Clients & Files
**Why it exists:** Rowena raised it directly. Clients share logins over chat
because there is nowhere better, and that is how credentials end up in
screenshots and message history forever.

**What it does**

- **One passphrase** for the workspace. You set it once.
- **Locked on your own computer before it is stored.** The server only ever holds
  scrambled text. If somebody stole the entire database they would get nothing
  readable out of it.
- **Every reveal and copy is logged**, in a record nobody can edit or delete.
  You can show a client exactly who opened their password and when.
- **Grants can be revoked**, and revoking flags what needs rotating, because
  taking access away cannot un-know a password somebody already read.
- The empty state pushes you toward proper delegated access first. Sharing a
  password should be the fallback, not the default.

**The honest trade:** if the passphrase is lost, the stored logins are gone. By
anyone, including me. That is the price of them being unreadable to a thief. The
app says this on screen before you set it up.

---

# Part 2: Pages that were rebuilt

---

## Training Center (was the Academy)

**Where:** Playbook
**Why it exists:** Every EA finishes Made Ready before they are handed to a
client. Reichelle calls it a sales-call talking point, which means it has to be
true.

**What it was:** six cards saying "Read guide". None of them did anything.

**What it does now**

- **Three days, ten lessons**, matching the structure Reichelle described:
  foundations, then AI tools beyond the obvious three, then simulation and
  practice.
- **An assessment at the end of each day.** 80% to pass. Unlimited retries,
  because the goal is preparedness, not mastery.
- **Days unlock in order.** You cannot open Day 2 until you pass Day 1. Without
  that, "you must pass Day 1" means nothing.
- **The answers are not in the app.** They sit on the server where the browser
  cannot reach them, and marking happens there. If the answers shipped to the
  laptop, then "every MadeEA EA is Made Ready certified" is a claim we could not
  honestly make, because passing would cost one glance at developer tools.
- **A wrong answer tells you which ones to review and why**, but never what the
  right answer was, so retrying does not leak the key one attempt at a time.
- **Admins get a Team tab** showing who is Made Ready and who has not started.
- Lessons with no recording yet **say so plainly** instead of showing a play
  button that does nothing.

**Waiting on:** FJ for the actual videos. The structure and the gate are built
and working around them.

---

## Workflows (was SOPs)

**Where:** Playbook
**Why it exists:** Rowena put it best: SOPs are what keep output quality the
same across every EA. It is the thing that makes an EA replaceable without the
client feeling it.

**What it does now**

- **Finishing a workflow marks the task done and it appears in tonight's EOD.**
  This is the single biggest change in the whole overhaul. Before, you could run
  four procedures end to end and your EOD would still say you did nothing.
- **You can write your own.** Before this week only a developer could add one,
  which meant the five that shipped were the five we would have forever. Admins
  now write them in the app: name, steps, which are required, and what "done"
  looks like.
- **One run per client.** There was a real bug here: running the same procedure
  for two clients shared one set of tick boxes, so ticking a step for Vantage
  ticked it for Acme. Fixed, and the database now makes that impossible rather
  than relying on the screen getting it right.
- **Pin the checklist** so it floats while you work in another tab.
- Steps can **run an AI action** and tick themselves.
- **Five workflows shipped:** Inbox Triage, Meeting Preparation, Executive
  Priority Alignment, Expense and Bookkeeping, Client Onboarding.

---

## Task Manager

**What was broken:** cards would not stay where you dropped them. Reichelle and
Rio both reported it independently. Everything about the EOD depended on it.

**What is new**

- **Drag and drop actually works.** Three separate faults were behind it.
- **Notes, links and attachments per task.** Reichelle asked for this: a research
  task produces something, and that something has to live on the task.
- **Day-stamped progress** for work spanning several days, so you know where you
  left off.
- **A Review column**, and work marked client-facing cannot reach Done without an
  admin approving it.
- **Comments and an activity log** on every task, so a handover does not lose the
  conversation.
- **Search, short task IDs** (T-4821), a list view, and coloured columns.
- **Every task shows when it is due in plain words**: Today, Tomorrow, 3 days
  overdue.

---

## AI Quick Actions

**What was wrong:** twenty-two buttons, many doing the same job. Four different
email writers. Five research variants. Two that were the same thing under two
names. Reichelle's point about the bot library applied here too: nobody can
memorise which of eight is the right one.

**What is new**

- **Eleven actions, one per job.** Each absorbed the four or five near-duplicates
  it replaced, and the choice you used to make by picking a button you now make
  in a dropdown inside it.
- **Grouped by what EAs actually do daily**: email and communication first, then
  research, social, meetings, reporting.
- **The comms ones appear inside the Communication Center**, where the work
  happens, rather than only behind their own menu.
- The **no usage limits** point is now stated on the page. Free ChatGPT throttles
  you halfway through a busy morning. Ours does not. That was a real win with a
  past EA and it was written down nowhere.

**Nothing was lost.** All twenty-two originals are still in the code.

---

## The sidebar

**What was wrong:** eighteen items under one heading called "Operations", which
sorts nothing because everything was in it.

**What is new**

- **Five groups**, each answering a different question: My Day, Clients & Files,
  Playbook, Insights, Setup.
- **My Day is in the order you work**: inbox, board, then the EOD that closes the
  day.
- **A real bug fixed:** the group holding the page you were on stayed collapsed,
  so the page you were looking at vanished from the nav entirely. On Client
  Scoreboard the sidebar told you nothing about where you were.
- Groups you open stay open after a reload.

---

# Part 3: The plumbing

Things with no tab, that everything else stands on.

---

## The app can finally reach outside itself

**Why it exists:** every tab was a closed loop. Data arrived, rendered, and
stopped. Nothing reached Slack, email, or anything the team already uses.

**What it does**

- An SLA breach can now leave the app, go to n8n, and n8n puts it wherever we
  point it.
- **The destination is a setting, not code.** Adding Slack later costs an n8n
  node, not a deploy.
- **Not connected is an honest state.** With no destination configured the app
  says so, and records alerts as skipped rather than pretending it sent
  something.
- **One alert per breach, ever.** Five EAs opening the dashboard at 9am see the
  same overnight breach. Only one alert results.
- **Every attempt is recorded**, including the failures, with the reason.

**Design call worth flagging:** breach alerts go to us, not the client. Telling a
client we were late at the moment we are late is a confession without context.
Client-facing response times belong in a weekly report they chose to open. The
switch to change this exists.

---

## Our definition of "late" is now one thing

It used to live in each person's browser. Every one of us had a different one,
and clearing your browser silently reset it. Two admins could disagree about
whether a client was breached while looking at the same screen.

It is now one setting for the whole workspace, only admins can change it, and
individual clients can still have their own targets. If we promise a client a
response time, that promise cannot live in somebody's Chrome.

---

## A way to test database changes before they touch production

`npm run check:migrations` runs every database change against a real Postgres on
a laptop in about fifteen seconds.

Eleven changes were waiting to be pasted into production by hand, one at a time,
with no undo. The failure mode is a mistake found halfway down a paste with the
statements above it already committed. Now that class of mistake is caught
before it can happen.

**It earned its keep today.** The script that applied everything to production
reported success on four changes that had actually failed. Because I checked
production afterwards rather than trusting the tool, that was caught and fixed
within minutes.

---

# Part 4: What was removed

**Twelve tabs.** Focus Helper, Voice Notes, Memory Helper, Decision Helper,
Homework Helper, Communication Studio, Bookkeeping AI, Investor Update, Travel
Helper, Email Helper, Meeting Helper, Daily Briefing.

**Two nav groups.** "Second Brain", which the audit removed by name. And "AI
Suite", which had been empty since 9 August and was still rendering as a heading
you could click to expand onto nothing.

**Eleven of twenty-two AI actions**, absorbed into the ones that replaced them.

**The test:** can I say in one sentence how this helps an EA do their job, or
helps a client manage their EA. If not, it went.

**Nothing was deleted.** Every page is still in the code. Any of them returns in
two lines. Rowena asked for gray out rather than delete, and that is what
happened.

---

# Part 5: Under the hood

For anyone who wants the specifics.

| | |
|---|---|
| New database tables | 20 |
| New columns on existing tables | 11 |
| New database functions | 8 |
| New private storage areas | 2 |
| Database upgrades applied | 11, numbered 0026 to 0036 |
| New pages | 6 |
| Pages rebuilt | 5 |
| Commits | 27 |

**New tables:** `time_entries`, `recordings`, `task_comments`, `task_activity`,
`folders`, `files`, `saved_items`, `routines`, `credentials`,
`credential_grants`, `credential_access_log`, `academy_modules`,
`academy_lessons`, `academy_progress`, `academy_questions`,
`academy_answer_key`, `academy_attempts`, `sla_settings`, `alert_routes`,
`alert_deliveries`.

**Every one has row-level security**, so people only see their own workspace and,
where it matters, only their own rows. Two are deliberately append-only: the
credential access log and the alert delivery log. Nobody can edit away the record
of having opened a client's password, or of an alert that never arrived.

One table has **no read access at all, for anyone**: the Academy answer key.
That is what makes the certification claim true.

---

# Part 6: What is not done

Honest list, with dates.

| What | Status | When |
|---|---|---|
| **EAs can read each other's EOD reports** | Live privacy problem, the exact defect from the audit | **21 August** |
| Client email addresses in the system | Nothing can address a report without them | 21 August |
| Alerts connected to n8n | Needs the n8n address | 1 hour after I get it |
| A screen showing failed alerts | The data is recorded, no page shows it | 22 August |
| Recordings becoming workflows | Record and write-up are still separate | 28 August |
| **Sending email from the app** | The whole app is read-only on email today | **3 to 4 weeks** |
| EOD delivering itself to clients | Depends entirely on the above | After sending works |
| The client dashboard | Not started, blocked on a decision | 1 week after the decision |
| Academy videos | FJ | FJ's timeline |
| The visual design | Waiting on FJ's design file via Reichelle | Once it arrives |
| Which of the 70 bots survive | Rowena and Brian | Needs a named list |

**The one that matters most:** the app cannot send an email. Everything about
email is read-only right now. That single gap is why the Communication Center
still ends in copy and paste, why Submit EOD saves but does not deliver, and why
the client dashboard has nothing to link to.

Fixing it needs a Google permission we did not originally ask for, which means
**every EA has to re-authorise their account.** That is a coordinated event, not
a quiet deploy, which is why it needs a date the team agrees on rather than me
just doing it.

Fix that one thing and three features unlock at once.
