# Reichelle review: what is built, what is not

Status of the 22 items from the review, as of 18 August 2026.
For Laura's EOS update (item 17) and for Rio's own tracking.

Legend: **Done** shipped and verified · **Partial** shipped with a stated limit · **Not code** a people or process action · **Blocked** needs something we do not have

---

## Time Tracker

| # | Item | Status |
|---|---|---|
| 1 | Clock in / clock out, new session on re-clock-in, total hours | **Done** |
| 2 | No separate lunch feature | **Done** (none existed; clock out for lunch, clock back in) |
| 3 | Early clock-out reason, free text not a picklist | **Done** |
| 4 | Client dropdown, scoped to the EA's own clients | **Done**, but see *Nothing to pick from* below |
| 5 | Remove "What are you working on?", use Client + Notes | **Done** |
| 6 | Today and Custom Date Range | **Done** |
| 7 | Totals as 8:32, not seconds | **Done** |
| 10 | EAs cannot add time manually | **Done** |
| 11 | Hard to manipulate | **Done**, see below |
| 12 | Timer UI moving | **Done** |
| 8, 9 | Screenshots every 10 minutes | **Partial**, see below |

### What "hard to manipulate" now means

The old policy granted an EA insert, update and delete on their own rows without
limit. Six ways to fake a timesheet were open. All six were closed and then
tested by impersonating an EA, rather than by reading the policy back:

| Attempt | Result |
|---|---|
| Clock in backdated three hours | Blocked |
| Create a session already closed | Blocked |
| Clock out nine hours in the future | Blocked |
| Delete your own entry | Blocked |
| Extend a finished session | Blocked |
| Move the start time of a running session | Blocked |

Corrections are an admin action, which is the workflow Reichelle asked for: the
EA requests, management applies.

### Nothing to pick from yet

The client dropdown works and is correctly scoped, but it is **empty for
everyone**, because the only three clients in the system are test records
(Maple Syrup, Oak, Rio) and none has an assigned EA.

To use it: create the real clients and set each one's lead EA. CandyPay assigned
to an EA will then be the only thing that EA sees.

### Screenshots: what is real and what is not

Built and working: capture on an interval while clocked in, stored in a private
bucket, visible to the EA and to admins, deletable by admins only. The interval
is a workspace setting defaulting to 10 minutes and refusing anything above 20,
matching what Reichelle asked for.

**The limit, stated plainly.** A web page cannot screenshot a desktop silently.
Browsers require a permission prompt, show a persistent "sharing your screen"
indicator, and let the user stop at any time from browser chrome our code cannot
reach. That is a security boundary, not a gap to engineer around.

So this is **disclosed monitoring**: the EA grants once per session, then frames
are captured without further prompting. It cannot be covert and it cannot be
tamper-proof. If an EA stops sharing or closes the tab, capture stops; the
record shows that it stopped, but nothing prevents it.

One trap worth knowing: an EA can share a single browser tab instead of the
whole screen, which would make the evidence worthless. The surface type is
recorded on every frame and the screen warns when a tab was shared.

**For tamper-proof capture** the options are a native desktop agent
(Electron/Tauri) or an existing product such as Hubstaff, Time Doctor or
TopTracker. The database side was built agent-agnostic on purpose, so an agent
can post to the same table later and nothing downstream changes. That is a
separate build and needs a decision first.

---

## Integrations

| # | Item | Status |
|---|---|---|
| 13 | Remove personal Gmail from production | **Done** |
| 14 | Communication Center supports Gmail, Slack, WhatsApp, Discord | **Partial** |
| 15 | WhatsApp | **Blocked**, needs Carlo and Brian |
| 16 | Discord | **Blocked**, needs a bot token |

### Personal Gmail (13)

Two personal accounts were connected: `princeacquahandam@gmail.com` and
`bryansumait.automate@gmail.com`. Both are gone. Specifically:

- The OAuth grants were **revoked at Google**, not merely forgotten locally.
  Deleting our row alone would have left the app listed as having access to
  their personal mail inside their Google accounts.
- 30 personal calendar events removed (backed up first).
- Sync state and stored credentials removed.
- Their email had already been removed in a separate pass.

Only `rio.castillo@madeeas.com` remains connected.

A related leak was found and fixed in the same area: every EA could read every
other EA's inbox, because the rule on `messages` scoped by workspace rather than
by person. Now Gmail is private to its owner and Slack stays shared, because a
channel belongs to a channel.

### Communication Center (14, 15, 16)

Gmail and Slack are connected and working. Slack reads and posts. WhatsApp and
Discord appear in the channel rail, greyed, with what each one needs, rather
than being hidden.

- **Discord** is close. A bot token, the bot invited to the server, and the
  token stored as `DISCORD_BOT_TOKEN`. The app has to be created under a Discord
  account we control.
- **WhatsApp** is not close. A verified Meta Business account, a phone number
  never used on WhatsApp, and Meta's approval of the Business API. Days, not
  minutes. This is the conversation for Carlo and Brian.

---

## Platform

| # | Item | Status |
|---|---|---|
| 17 | EOS items updated for Laura | **Done**, this document |
| 18 | Google Calendar | **Not started** |
| 19 | Video recording | **No change needed** |
| 20, 21, 22 | Made Ready Academy | **Not code** |

**Calendar (18).** The Google connection and backend already exist; a
`calendar-sync` function is deployed and the OAuth scope is granted. What is
missing is the Calendar surface itself. This is the largest remaining piece.

**Academy (20, 21, 22).** Reichelle completes the document and the assessments
and sends it to Rio; Rio sends his own material back for consolidation. Nothing
to build until the content and the assessments exist, since the point is that an
EA must demonstrate competence, not read slides.

---

## What is waiting on someone

1. **Create the real clients and assign a lead EA to each.** Until then the Time
   Tracker's client dropdown is empty for every EA.
2. **Decide on screenshots.** Disclosed browser capture as built, or fund a
   native agent for tamper resistance.
3. **Carlo and Brian on WhatsApp.**
4. **A Discord bot token**, if any client actually uses Discord.
5. **Reichelle's Academy document**, with the assessments.
6. **Delete the three test clients** (Maple Syrup, Oak, Rio) once real ones exist.
