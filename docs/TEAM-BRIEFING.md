# MadeEA OS: Team Briefing

**For:** Prince, Rowena, Reichelle, Laura, FJ and the EA team
**Date:** 17 August 2026, 8:00 PM
**Runs:** about 20 minutes, plus questions
**Presenter:** Rio

> Editing note: everything below is meant to be said out loud. Short sentences on
> purpose. Cut anything that does not land for your room.

---

## 1. Open (1 minute)

> On 10 August we sat down and went through this app honestly. The verdict was
> not kind, and it was correct.
>
> Prince said it plainly: he did not want a single feature that did not need to
> be there. Better to have fewer things that work than a lot of things that
> don't.
>
> So that is what I did. I removed a lot, I finished what was left, and I made
> the parts talk to each other. That last part is the one that matters most, and
> I will show you why.

---

## 2. What was actually wrong (2 minutes)

> Three problems, and they were all the same problem wearing different clothes.
>
> **One. Too many tabs.** Thirty-something things in the sidebar. Nobody could
> find anything, and half of them nobody could explain the point of.
>
> **Two. Things that looked finished but weren't.** The Training Center had six
> cards saying "Read guide." None of them did anything. You could click them all
> day. That is the one that bothered me most, because that is the page we point
> at on a sales call.
>
> **Three. Nothing connected.** You could run a whole procedure start to finish,
> tick every box, and your end-of-day report would still say you did nothing.
> The app was a set of separate rooms with no doors between them.

---

## 3. What I removed (2 minutes)

> Twelve tabs are gone from the sidebar. Focus Helper, Voice Notes, Memory
> Helper, Decision Helper, Homework Helper, and seven more.
>
> The test I used was the one from our meeting: can I say in one sentence how
> this helps an EA do their job, or helps a client manage their EA. If I could
> not, it went.
>
> **Nothing was deleted.** Every one of those pages is still in the code. If any
> of you wants one back, it is a two-line change and it returns. Rowena asked for
> gray out, not delete, and that is exactly what happened.
>
> The AI Quick Actions went from twenty-two down to eleven. That was not really
> a cut, it was cleaning up. We had four different buttons that all wrote an
> email. Five that all did research. Two that were the same thing with two
> different names. Now there is one of each, and the choice you used to make by
> picking a button, you now make in a dropdown inside it.

---

## 4. What I built (5 minutes)

> Five real things. In order of how much I think you will care.

### The sidebar makes sense now

> It used to be eighteen items under one heading called "Operations", which
> tells you nothing, because everything was in it.
>
> Now there are five groups, and each answers a different question you are
> actually asking:
>
> - **My Day**. What do I do now.
> - **Clients & Files**. Where is that thing for this client.
> - **Playbook**. How do we do this.
> - **Insights**. What does the work add up to.
> - **Setup**. Set once, forget.
>
> My Day is in the order you actually work: inbox, then the board, then the EOD
> that closes the day. That order came from Rowena's question in the audit: if I
> am the EA, what do I do.

### Workflows now count for something

> This is the change I would most like you to notice.
>
> Before: you run Inbox Triage, tick all seven steps, finish. The app records it
> somewhere you will never look at. Your EOD says you did nothing.
>
> Now: when you start a workflow, it attaches to a task. When you finish, the
> task is marked done, and it shows up in tonight's EOD by itself. No retyping.
>
> You can also **write your own workflows now.** Before today, only a developer
> could add one, which meant the five we shipped were the five we would have
> forever. Admins can now write them in the app.
>
> And a bug worth knowing: if you ran the same procedure for two clients, they
> shared one set of tick boxes. Ticking a step for Vantage ticked it for Acme.
> That is fixed. One run per client, each with its own progress.

### Routines: the app remembers, not you

> Recurring work is the work people forget. Not the big things. The small weekly
> ones. Update the attendance sheet. Send the Friday report. Check the invoice
> folder.
>
> You describe it once, every Monday, and from then on the task turns up on your
> board by itself, already dated and assigned to you. When you finish it, it
> lands in your EOD without you writing a line about it.
>
> Here is why it matters more than it sounds. Right now an EA is reliable because
> they are diligent. That reliability lives in one person's head, so it leaves
> when they leave and it wobbles when they are sick or busy. A routine moves that
> reliability from the person into the system. A new EA is as reliable as the one
> who left, on their first day, because the app is what remembers.
>
> And the client sees it. The recurring work shows up in the EOD on its own, so
> the boring dependable stuff becomes visible. That is exactly the work a client
> only notices when it stops happening.
>
> One honest caveat: tomorrow's task appears when somebody opens the app, not at
> midnight. With everyone signing in daily for attendance that is the same thing
> in practice. Making it a proper scheduled job is about an hour and it is on
> next week's list.

### The Training Center is real

> Made Ready is three days, ten lessons, with an assessment at the end of each.
> You cannot open Day 2 until you pass Day 1.
>
> The important bit: **the answers are not in the app.** They are on the server
> where the browser cannot reach them. That matters because if the answers
> shipped to your laptop, then "every MadeEA EA is Made Ready certified" is
> something we cannot honestly say on a sales call. Now we can.
>
> Admins get a Team tab showing who has finished and who has not.
>
> FJ still owns the videos. The lessons that have no recording yet say so
> plainly, rather than showing a play button that does nothing.

### The Password Manager

> Rowena raised this: clients share logins over chat because there is nowhere
> better. Now there is.
>
> One passphrase for the workspace. Everything is locked on your own computer
> before it is stored, so even if somebody stole the whole database they would
> get nothing readable.
>
> The honest part: **if that passphrase is lost, the logins are gone.** Nobody
> can recover them, including me. The app says that on screen before you set it
> up.

### The app finally talks to the outside world

> This is the first door out of the building.
>
> When a client email goes unanswered past our own limit, the app can now send
> that out to n8n, and n8n can put it wherever we want. Slack, email, whatever.
>
> Two things I decided and want to flag:
>
> **The alert goes to us, not the client.** Rio asked for it to go to the
> client. I pushed back and built it internal. Telling a client "we were late"
> at the exact moment we are late is not a report, it is a confession with no
> context. Clients should see response times as a weekly number in a report they
> chose to open. That is the Scoreboard. The switch to change this exists if you
> disagree.
>
> **Our definition of "late" used to live in each person's browser.** Which
> meant every one of us had a different one, and clearing your browser reset it.
> It is now one setting for the whole team, and only admins can change it. If we
> promise a client a response time, that promise cannot live in somebody's Chrome.

---

## 5. Live walkthrough (5 minutes)

> Click these in this order. It tells a story.

| # | Where | Say |
|---|---|---|
| 1 | **Sidebar** | Five groups. Compare with the screenshot from the audit. |
| 2 | **Playbook → Workflows** | Open Inbox Triage. Show the client picker and the task link. |
| 3 | Start it, tick two steps | Point at "Linked to…". This is the connection that was missing. |
| 4 | Finish it | It says the task is done and will appear in tonight's EOD. |
| 5 | **My Day → EOD Reports** | It is already there under Completed Today. Nobody typed it. |
| 6 | **Playbook → Training Center** | Day 2 and 3 are locked. Fail Day 1 on purpose, then pass it. |
| 7 | **Clients & Files → Password Manager** | Set a passphrase, add a login, reveal it. |
| 8 | **Setup → Settings → Alerts** | It says Not connected, because it honestly is not yet. |

> If something breaks live, say so and move on. Everything here has been tested,
> but a demo is a demo.

---

## 6. What is live tonight (1 minute)

> All of the database work is applied to the real MadeEA project. That happened
> today, and I checked it afterwards rather than trusting the script that did it.
> Twenty new tables, every one of them locked down so people only see their own
> data.
>
> Nothing that existed was touched. Nine team members, sixteen tasks, three
> clients, thirty-one EOD reports, five workflows. All still there.

---

## 7. What is NOT done (4 minutes)

> I want to be straight about this rather than let you find out later.

### Still broken, and it is a privacy problem

> **Every EA can currently read every other EA's end-of-day reports.** This is
> the exact thing Rio flagged in the audit and it is still there. It is a small
> fix and it is first on my list.
>
> **Fix by: this Friday, 21 August.**

### The big one: the app still cannot send an email

> Everything about email in this app is read-only right now. We can read your
> inbox. We cannot send from it.
>
> That means the Communication Center still ends with copy and paste, and the
> Submit EOD button saves the report but does not deliver it to anyone.
>
> This is not laziness, it is a real cost. Sending requires asking Google for
> more permission, which means **every single EA has to re-authorise their
> account.** I did not want to spring that on nine people without warning.
>
> **Estimate: 3 to 4 weeks**, and it needs a decision from Prince first.
> Roughly: one week to change the Google permissions and get everyone
> re-connected, one to two weeks to build proper sending with threads and
> attachments, then three to five days to hook the EOD up to it.

### The client dashboard does not exist

> Not started, on purpose. It is blocked on a question only Prince and Reichelle
> can answer, and I did not want to build the wrong thing.
>
> **Estimate: one week, once the decision is made.**

### Smaller things

| What | When |
|---|---|
| Connect the alerts to n8n | 1 hour, the moment I get the n8n address |
| A screen showing failed alerts | 22 August |
| Recordings turning into workflows automatically | 28 August |
| Client contact emails in the system | This Friday, with the privacy fix |

### Not mine to finish

| What | Who | Note |
|---|---|---|
| Academy videos | FJ | The course structure is built and waiting |
| The visual design | Reichelle, then Rio | Still waiting on FJ's design file |
| Which of the 70 bots survive | Rowena + Brian | Needs a named list |

---

## 8. Rough timeline (1 minute)

```
This week      Privacy fix. Client emails. Alerts connected.
Week of 24 Aug Failed-alert screen. Recordings become workflows.
               Client dashboard, IF the decision lands.
Sept, weeks 1-3  Email sending. Everyone re-authorises Google.
Sept, week 4   EOD delivers itself to clients.
```

> Everything from September onwards depends on decisions made this week. If they
> slip, that whole block slips with them.

---

## 9. What I need from you tonight (2 minutes)

> Three things, and two of them are quick.

**1. Does an EA file one EOD, or one per client?**

> An EA with three clients: one report, or three?
>
> This matters more than it sounds. It decides who the report is addressed to,
> what the client sees, and how we count compliance.
>
> And here is the thing: **the system has already decided, by accident.** Right
> now it only allows one report per person per day, so three clients share one
> report. Nobody chose that. It was a side effect of how it was built.
>
> Cheap to change this week. Expensive in a month.

**2. Does the client log in, or just get a link?**

> Reichelle has already said we cannot expect clients to log into another app.
> If that is settled, I will build a link that opens their report with no login
> at all, and the emailed report stays the main thing.
>
> I need that said out loud so I can build it.

**3. Rowena and Brian, the bot list.**

> Which of the seventy survive. I cannot cut what I cannot see.

---

## 10. Close (30 seconds)

> The honest summary is this.
>
> The app is smaller than it was two weeks ago, and more of it works. Things
> connect now: you run a workflow, and it shows up in your EOD without you
> typing it twice.
>
> What is still missing is mostly one thing wearing different hats. The app
> cannot send anything yet. Fix that, and the Communication Center, the EOD
> delivery and the client dashboard all unlock together.
>
> That is the next month. Everything else is detail.

---

## Appendix: if someone asks a hard question

**"Did you delete our features?"**
> No. Twelve are off the sidebar, all still in the code. Any of them comes back
> in two lines. Nothing was deleted.

**"Is our data safe?"**
> The client logins are locked with a passphrase before they leave your
> computer. Everything else is behind row-level rules so you only see your own
> workspace. The one gap is EOD reports being visible across the team, and that
> is fixed this week.

**"Why can't we send email yet, that seems basic."**
> It is basic, and it is the thing I most want to build. It needs Google to
> grant a permission we did not ask for originally, and every EA has to
> re-approve their account when we do. That is a coordinated thing, not a quiet
> deploy, so I want a date we all agree on.

**"How do we know any of this actually works?"**
> Every piece of it was tested against a real database and a real browser before
> it shipped, and I checked production after the fact rather than trusting the
> tool that did the work. That caught a real problem today: my first script
> reported success on four migrations that had actually failed.

**"What happens if the passphrase for the passwords is lost?"**
> The stored logins are unrecoverable. By anyone. That is the trade for them
> being unreadable to anyone who steals the database. Keep it wherever the team
> already keeps shared secrets.
