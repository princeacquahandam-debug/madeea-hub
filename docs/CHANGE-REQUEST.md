# Change requests

Every request that is not a hotfix lands here first and ships in the next
maintenance window. The window itself is in [RELEASE-CHECKLIST.md](RELEASE-CHECKLIST.md).

**Why a queue at all.** Requests arrive in chat, in meetings and in passing, and
two things happen to them: the small ones get built the same hour, and the rest
get lost. Building the same hour is the expensive one. Every unplanned change is
a separate manual SQL run, a separate function deploy and a separate chance to
apply a migration in the wrong order — which is exactly how uploads broke when
0067 went in ahead of the frontend that obeyed it.

Batching does not make anybody wait longer for the things that matter. It makes
the things that matter identifiable.

---

## The template

Copy this, fill it in, add it to the top of **Queued** below.

```
### <short title>

**Asked by:**
**Date asked:**
**What they want:** one or two sentences, in their words, not yours
**Why:** what goes wrong today without it
**Urgency:** window | hotfix
**Touches:** database | edge functions | frontend | none of these
**Done looks like:** the one thing you would check to know it works
**Open questions:** anything you would otherwise have to guess at
```

### On each field

**Urgency.** Hotfix means it stops an EA being paid or a client being served: a
clock-out that will not close a shift, a login that fails, one client able to see
another client's data. Everything else is `window`, including things that feel
urgent because somebody has asked twice. If the hotfix lane is used for
convenience it stops meaning anything, and then there is no lane.

**Touches.** This decides where the change sits in the release order, and whether
it has to be split into an additive half and a tightening half. A request that
touches the database *and* the frontend is the one that breaks when the halves
ship in the wrong order, so it is worth writing down before anyone starts.

**Done looks like.** The field people skip and the one that saves the most time.
It has to be something you can observe: "the client's name appears in the team
channel within a minute of the EA timing in", not "notifications work". If you
cannot write this line, the request is not understood well enough to build yet
and the honest move is to go back and ask.

**Open questions.** Ship these to the asker before the window opens, not during
it. A window spent waiting on an answer is a window wasted.

---

## Queued for the next window

_Nothing queued._

---

## Shipped

Move entries here after the window closes, with the date and anything that
surprised you. This is the record of what changed and when, which is what you
will want the next time something breaks and nobody remembers why.
