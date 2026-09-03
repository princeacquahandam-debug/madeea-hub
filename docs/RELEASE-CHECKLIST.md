# Release checklist

One maintenance window, roughly every 24 hours, shipping everything queued in
[CHANGE-REQUEST.md](CHANGE-REQUEST.md).

Work through this top to bottom. The order is not a preference.

---

## Before you open the window

**Pick the hour.** Outside EA shift hours, always.

A deploy reloads the app in every open tab, and the screen-capture stream does
not survive a reload — the browser will not hand it back without a fresh click
from the person sitting there. An EA deployed on mid-shift either notices and
re-authorises, or does not notice and stops producing screenshots for the rest of
the day. That is the same failure as the eight-hours-five-screenshots report, and
we would be causing it ourselves.

**Read the queue.** Anything with an unanswered open question comes out of this
window and goes into the next. Do not open a window you intend to spend waiting.

**Split anything that touches both the database and the frontend.** It needs an
additive migration now and a tightening migration at the end. If it cannot be
split that way it is not ready to ship in a window — see step 4.

---

## Pre-flight

Run from the repo root. On Windows use `npm.cmd`, not `npm` — PowerShell's
execution policy blocks `npm.ps1` and the error it gives you is about scripts
being disabled, which reads like something worse than it is.

```
npm.cmd run check:migrations
npm.cmd run check:access
npm.cmd run check:functions
npm.cmd run check:gates
npm.cmd run check:schedule
npm.cmd run check:names
npm.cmd run check:isolation
npm.cmd run build
```

All of them pass, or the window does not open. `check:access` is the one to care
about most: it runs the real policies against a real Postgres and it has caught a
genuine leak before, so a failure there is a finding and not a flaky test.

**`npm run lint` is broken repo-wide** and has nothing to do with your change.
ESLint 9 wants an `eslint.config.*` and the repo still has the old format. Do not
spend the window on it; it belongs in the queue like anything else.

---

## The four steps

Each step has to leave the system working with the *previous* step's version
still live, because for a few minutes it will be. That single rule is what makes
a batch safe, and breaking it is what broke uploads when 0067 was applied while
the deployed frontend still wrote flat keys.

### 1. Additive migrations

New tables, new columns, new policies that only widen what is allowed. Paste them
into the Supabase SQL editor in ascending number order, one file at a time, and
read the result of each before starting the next.

Nothing here may tighten a rule, drop a column, or narrow a policy. If a
migration in this step would break the frontend that is currently live, it is in
the wrong step.

*Rollback:* additive changes are inert until something uses them. Leave them.

### 2. Edge functions

```
npm.cmd run deploy:functions
```

This deploys every function, not only the changed ones, so what is live afterwards
is exactly what is in the repo. Expect the full count in the output.

*Rollback:* check out the previous commit and run it again.

### 3. Frontend

Merge the PR. Vercel builds from `main`.

Wait for the deployment to go green and load the app yourself before moving on.
Not the preview URL — the one the team actually uses.

*Rollback:* revert the merge, or promote the previous deployment in Vercel, which
is faster.

### 4. Tightening migrations

The ones that remove a temporary allowance or narrow a policy now that the
frontend obeying it is live. `0068_restore_strict_upload_policy.sql` is the
worked example: it exists only because its own header says to run it after the
deploy and not before.

*Rollback:* this is the step with real blast radius. Have the widening statement
ready to paste back before you run the narrowing one.

---

## After

- Use each shipped feature once, as a normal user would, in the live app.
- Move the entries from **Queued** to **Shipped** in `CHANGE-REQUEST.md`.
- Post what changed in the team channel, in plain language. The EAs find out the
  app changed by using it otherwise, which is how small changes turn into
  support questions.

---

## The hotfix lane

A 24-hour cadence is right for features and wrong for a broken clock-out.

Hotfixes skip the queue and skip the window. They still go through steps 1 to 4
in order, because the ordering rule is about correctness and not about ceremony —
there is just nothing else in the batch. Afterwards, write the entry in
`CHANGE-REQUEST.md` under **Shipped** anyway, so the record stays complete.

If you find yourself using this lane more than occasionally, the cadence is wrong
rather than the requests. Shorten the interval instead of quietly abandoning it.
