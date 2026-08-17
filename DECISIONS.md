# Decisions

Non-trivial calls made under the working agreement. Newest first.

---

## SLA thresholds move from localStorage to the database

**What I decided.** `sla_settings`, one row per workspace, admin-writable and
readable by every member (migration 0036). The store keeps its public shape, so
the nine pages that read it were not touched.

**Why.** Rule 5: anything we promise a client lives in the database. The
thresholds decide whether a client is "breached", and they were in
`localStorage`. Every person carried a private definition of late, clearing your
browser silently reset it, and two admins could disagree while looking at the
same screen.

**What I assumed.** One SLA policy per workspace rather than per client tier.
Per-client overrides already exist on `clients.sla_ok_hours` / `sla_risk_hours`
and still win.

**Cost to reverse.** Low. The store is the only reader; pointing it back at
localStorage is a one-file change.

**What would change my mind.** Different SLAs sold to different client tiers as
a contractual term, which would want a policy table rather than a single row.

---

## An EA cannot edit the SLA thresholds; an admin can

**What I decided.** Write policy is `is_admin()`. Read is everyone.

**Why.** An EA editing the definition of "late" is an EA editing their own
performance review. Read stays open because the thresholds drive what every page
renders.

**What I assumed.** Rowena and Reichelle are admins in `memberships`.

**Cost to reverse.** Trivial, one policy.

**What would change my mind.** Senior EAs owning their own client's SLA as part
of the account plan.

---

## Alerts leave through one edge function, never from the browser

**What I decided.** `emit-alert`. The browser posts `{event, subject_id,
payload}` with the caller's JWT. The server resolves the route, calls n8n, and
records the outcome.

**Why.** The n8n base URL and key are server secrets. In the bundle they are
public, and any page on the internet could post fabricated breaches into the
team's Slack. Rule 3 also holds: n8n is already a wired vendor, not a new one,
so this needs no new scope and no re-onboarding.

**What I assumed.** n8n stays the routing layer. Slack, email and anything else
are n8n's problem, not the app's, so adding a destination costs an n8n node and
no deploy here.

**Cost to reverse.** Low. One function, one table, no schema anyone else depends
on.

**What would change my mind.** Latency mattering. n8n is event glue, not
request-path infrastructure. Anything a user waits on should not go through it.

---

## The destination is a row, and its default is "not connected"

**What I decided.** `alert_routes`, defaulting to `channel = 'none'`,
`is_active = false`. Settings shows "Not connected" as a first-class state.

**Why.** Rule 4, and a standing instruction not to pick a Slack channel on the
team's behalf. With no `N8N_BASE_URL` set, deliveries record as `skipped`, not
`sent`, so nothing claims to have sent a message it did not send.

**What I assumed.** One destination per event is enough for now. Fan-out is
n8n's job.

**Cost to reverse.** Trivial.

**What would change my mind.** Wanting per-client routing, which would make the
key `(event, client_id)`.

---

## SLA breach alerts go to the team, not the client

**What I decided.** `audience` defaults to `internal`, and the Settings copy
says so out loud.

**Why.** Rule 6, and it is the right product call: telling a client we were late
at the exact moment we are late is not a report, it is a confession with no
context. Rio initially asked for these to go to the client. Client-facing
response-time reporting belongs on the Scoreboard as a periodic, reviewed
surface.

**What I assumed.** The Scoreboard becomes that surface.

**Cost to reverse.** The column already accepts `'client'`. Flipping it is a
setting, not a build.

**What would change my mind.** A client contractually requiring real-time breach
notification.

---

## One alert per breach, enforced by a unique index

**What I decided.** `alert_deliveries` with a unique index on
`(workspace_id, event, subject_id)`. The row is claimed before the send.

**Why.** The trigger is a render: five EAs opening the dashboard at 9am all
notice the same overnight breach. Deduping in the browser would give five
alerts. Losing the insert race is a success, not an error.

**What I assumed.** A breach is worth announcing once, ever, not once per day it
stays open.

**Cost to reverse.** Moderate. Re-alerting daily would need the key to include a
date.

**What would change my mind.** Breaches that stay open for days going unnoticed
because the one alert scrolled past.

---

## A failed alert is not a failed request

**What I decided.** `emit-alert` returns 200 with `delivered: false` when n8n is
unreachable. The failure lands in `alert_deliveries.last_error`.

**Why.** The event still happened. The caller is a dashboard render with nothing
useful to do about a 500, and an operator looking for missed alerts should find
them in one table rather than in browser consoles.

**What I assumed.** Somebody eventually looks at `alert_deliveries`. There is no
surface for that yet, which is the honest gap.

**Cost to reverse.** Trivial.

**What would change my mind.** Silent failure piling up unnoticed, which would
argue for a banner in Settings when the last N deliveries all failed.

---

## Retry: three attempts, 5s timeout, no retry on 4xx

**What I decided.** 5s per attempt, 3 attempts, 400ms then 1200ms backoff. 4xx
returns immediately; 429 and 5xx retry.

**Why.** Retrying a 404 three times only delays telling the operator their
webhook path is wrong. A person is waiting on the response, so backoff is short.

**What I assumed.** n8n answers well under a second when healthy.

**Cost to reverse.** Trivial, four constants.

**What would change my mind.** Moving to a queue, where long backoff costs
nothing and delivery should be guaranteed rather than best-effort.

---

## Applied all pending migrations to production myself

**What I decided.** Ran 0026 through 0036 against `madeea-hub`
(`bglduxferbjmoeqzyypx`) via the Management API, then deployed `emit-alert`.

**Why.** Rio handed over a Supabase management token and said execute. The
escalation bar covers irreversible production migrations, and he cleared it
explicitly and then twice more.

**What I assumed.** That `madeea-hub` is the live project. Not assumed from the
name: six projects carry MadeEA branding, so I fingerprinted them by schema.
`madeea-hub` was the only one holding the 0025 tables the app expects, with one
workspace and nine members. `madeea-command-center` matched loosely and is a
separate, earlier deployment that I did not touch.

**Cost to reverse.** Every migration is additive and idempotent, so re-running
is a no-op. Undoing means dropping the twenty new tables, which loses nothing
that existed before today.

**What would change my mind.** Nothing now, it is done and verified. Worth
recording that there is no `supabase_migrations.schema_migrations` ledger on
this project, so a future `supabase db push` will not know these ran. They are
all `if not exists`, so it would be safe rather than destructive.
