# Deploying the DM setter

Getting the two Instagram workflows from JSON files to a live setter. Roughly an
hour of work, most of it waiting for a host to provision.

For what the setter *does*, read [README-dm-setter.md](README-dm-setter.md).
This file is only about standing it up.

---

## What you are deploying

An n8n instance running two scheduled workflows. That's it — no Vercel changes,
no Hub changes, no Supabase changes. The setter talks to GoHighLevel and
Anthropic and nothing else.

**Neither workflow has a webhook trigger.** Both are on timers, so n8n only ever
makes *outbound* calls. That means:

- No public URL required
- No reverse proxy, no TLS certificate, no DNS
- It can run behind NAT, on a home box, or on a private VPS

This removes most of the usual n8n deployment work. Ignore any guide that starts
with nginx and Let's Encrypt — you don't need it for this.

---

## Step 1 — Pick a host, and do the execution math first

This is the decision that costs money if you get it wrong.

The setter runs **every 2 minutes** and the follow-up **every 30 minutes**:

| Workflow | Interval | Runs/day | Runs/month |
|---|---|---|---|
| DM setter | 2 min | 720 | ~21,900 |
| Follow-up | 30 min | 48 | ~1,460 |
| | | | **~23,400** |

**Almost all of those do nothing.** When there's no one to reply to, `Qualify +
Dedup` returns an empty list and the run ends immediately. But n8n still counts
it as an execution — and n8n Cloud plans are metered by execution count, not by
work done.

So:

| Host | Cost shape | Verdict at this cadence |
|---|---|---|
| **Self-hosted** (Hetzner, Railway, Render, a spare box) | Flat — €4–15/mo, unlimited executions | **Recommended.** The 2-minute cadence is free here. |
| **n8n Cloud** | Metered per execution | Check the current included-execution count against 23,400/month before committing. You'll likely need a high tier, or a slower cadence. |

I said "managed, for speed" earlier. The execution math changes that — at 23,400
runs/month, self-hosting is materially cheaper, and this workload needs no public
URL, which is what usually makes self-hosting annoying.

**If you do want n8n Cloud**, slow the setter down first. Open the `Every 2 min`
trigger and set it to 5 minutes: that's ~8,800 runs/month instead of 21,900, and
it costs you almost nothing in responsiveness — `Qualify + Dedup` already waits
three minutes before replying to anything, deliberately, so the reply doesn't
land suspiciously fast.

### Self-hosting with Docker

```bash
docker run -d --name n8n --restart unless-stopped \
  -p 5678:5678 \
  -v n8n_data:/home/node/.n8n \
  -e N8N_ENCRYPTION_KEY="<a long random string you keep safe>" \
  -e GENERIC_TIMEZONE="Europe/London" \
  -e TZ="Europe/London" \
  -e EXECUTIONS_DATA_PRUNE=true \
  -e EXECUTIONS_DATA_MAX_AGE=168 \
  docker.n8n.io/n8nio/n8n
```

Four of those matter more than they look:

- **`N8N_ENCRYPTION_KEY`** encrypts your stored credentials. Lose it and every
  credential in the instance becomes unreadable — you re-enter the GHL token and
  the Anthropic key by hand. Put it in a password manager now, before you have
  anything to lose.
- **`GENERIC_TIMEZONE`** is what schedule triggers fire against. Set it to the
  same zone you set inside the workflows (see step 5), or the quiet-hours logic
  and the trigger will disagree with each other.
- **`EXECUTIONS_DATA_PRUNE` / `MAX_AGE`** stop the execution log growing without
  limit. At ~780 runs a day, an unpruned SQLite file gets unpleasant within
  weeks. Seven days of history is plenty once you're past the dry run.
- **The named volume** is where SQLite and the dedup state live. Without it, a
  container restart forgets which leads it has already messaged, and the setter
  will message them again.

For anything beyond a single low-volume instance, point n8n at Postgres
(`DB_TYPE=postgresdb` plus the `DB_POSTGRESDB_*` vars) instead of the default
SQLite. For this workload SQLite on a persistent volume is genuinely fine.

---

## Step 2 — Create the GoHighLevel token

Both workflows read and write conversations and contacts in GHL.

1. In GHL: **Settings → Private Integrations → Create new integration**
2. Give it scopes covering, at minimum:
   - conversations — read and write
   - conversation messages — read and write
   - contacts — read and write
3. Copy the token. It starts `pit-`.
4. Grab the **location id** while you're there — it's the long id in the GHL
   dashboard URL.

Keep both somewhere safe; you'll paste each of them twice.

---

## Step 3 — Create the Anthropic key

From [console.anthropic.com](https://console.anthropic.com) → API keys. Put a
small monthly budget on it while you're testing — see the cost note at the
bottom, but it's low enough that a cap is cheap insurance against a loop.

---

## Step 4 — Import and wire up

1. In n8n: **Workflows → Import from file** for each of:
   - `madeea-ig-dm-setter.workflow.json`
   - `madeea-ig-followup-day1.workflow.json`
2. **Credentials → Add credential → Header Auth**
   - Name: `GHL MadeEA (IG)`
   - Header name: `Authorization`
   - Header value: `Bearer pit-…` — the `Bearer ` prefix is required
3. **Credentials → Add credential → Anthropic**
   - Name: `Anthropic account`
   - Your API key
4. **Re-select both credentials on every node that uses them.** The imported ids
   are the string `REPLACE_ME`, and n8n will not warn you — the node just fails
   at runtime with a 401. There are six in the setter and nine in the follow-up;
   any node showing a credential warning triangle needs attention.

---

## Step 5 — Fill in the placeholders

Search both workflows for `REPLACE_WITH_`. There are two:

| Placeholder | Where | Value |
|---|---|---|
| `REPLACE_WITH_MADEEA_GHL_LOCATION_ID` | The URL of `Get IG Conversations` / `Get Conversations` | Your GHL location id |
| `REPLACE_WITH_MADEEA_GHL_PRIVATE_INTEGRATION_TOKEN` | The `TOKEN` constant in `Send Bubbles` | The same `pit-…` token |

The second one is a plain constant in a Code node rather than a credential
because n8n credentials aren't reachable from `this.helpers.httpRequest`. Fill it
in inside n8n and **don't commit the filled-in file** — that's how a token ends
up in git history.

Then, in the same pass:

**Set the timezone.** Both workflows have a hardcoded `Europe/London`. Search for
it. This clock decides what counts as an unsociable hour to DM a founder, so
point it at wherever your lead base actually is, and make it match
`GENERIC_TIMEZONE` from step 1.

**Fill the exclusion lists.** In `Qualify + Dedup` (setter) and `Pre-filter
Candidates` (follow-up):

```js
const EXCLUDE_CONTACT_IDS = [];                     // add your team's GHL contact ids
const EXCLUDE_NAMES = ["madeea","prince andam"];    // confirm the IG display names
```

Until you do this, the setter can DM your own people. Do it before the first live
run, not after.

---

## Step 6 — Dry run

**Both workflows ship with `dryRun: true`** in the CONTROL PANEL at the top of
`Qualify + Dedup` and `Decide`. In that state everything executes and every draft
is written to the execution log, but nothing sends and no tag is written.

Activate the setter and leave it alone for a few hours, then read the executions.

Open `Extract Draft` on runs that produced something and read the `draft` field.
What you're checking:

- **Does it sound like your team?** This is the main thing. Tone is tuned in the
  `SYSTEM_PROMPT` constant, not in the guards.
- **Is it on the right phase?** A setter that jumps to the invite before a wall
  has surfaced is the most common SOP violation, and it's a prompt fix.
- **Which drafts got held, and were the guards right?** Check `hold`, `category`,
  `badprice` and `toolong`. A guard firing constantly usually means the prompt is
  steering somewhere the SOP forbids — fix the prompt rather than loosening the
  guard.
- **Is it skipping people it shouldn't?** `skip` on a genuine prospect means the
  lead gate is too tight.

Read twenty or thirty before flipping anything. This is the cheapest point in the
whole project to change your mind.

> **One gotcha while testing.** Dedup state lives in `$getWorkflowStaticData`,
> which n8n persists on *production* runs of an **active** workflow — not
> reliably on manual "Execute workflow" clicks from the editor. So if you test by
> hand and see the same lead offered up repeatedly, that's the editor, not a bug.
> Verify dedup only once the workflow is switched on.

---

## Step 7 — Go live

1. Flip `dryRun` to `false` in the setter's `Qualify + Dedup`. Save. Leave the
   follow-up in dry run.
2. Watch the first few real sends land in GHL. Confirm the bubbles arrive
   separately, four seconds apart, and that tags are written to the contact.
3. Give it **a full day alone**.
4. Then flip `dryRun` in the follow-up's `Decide` and activate it.

The order matters: the follow-up can only chase conversations the setter has
already started, so there is nothing for it to do on day one, and running both
from cold just doubles what you have to debug.

---

## Week one

Things worth actually looking at:

- **Held drafts** — filter contacts on `madeea-setter-needs-human`. Every one is
  a conversation waiting on a person. If this grows, the setter is being blocked
  more than it's sending, and the prompt needs work.
- **`madeea-setter-pricing-asked`** — how often price comes up early tells you
  whether the Fact Pack answer is landing or scaring people off.
- **The wall split** — `capacity` vs `trust` vs `burned-before` across your leads
  is genuinely useful marketing information, independent of the setter.
- **Link sent vs actually booked.** Nothing in these workflows watches a
  calendar, so this gap is invisible unless you check it manually. It's the
  number that decides whether the contact-form booking link is costing you
  conversions.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| Nothing ever sends, but drafts look fine | `dryRun` still `true` |
| 401 from GoHighLevel | Credential still `REPLACE_ME` on that node, or the header value is missing the `Bearer ` prefix |
| 401 from Anthropic | Anthropic credential not re-selected on `Call Anthropic` |
| `Send Bubbles` silently does nothing | The `TOKEN` constant is still the placeholder. This node swallows its own errors by design so one bad send can't kill the run — check the token first |
| The same lead gets messaged twice | Static data isn't persisting: the workflow isn't active, or the container has no persistent volume |
| Executions run but never find anyone | `lastMessageType !== 'TYPE_INSTAGRAM'` is filtering everything out. Log one conversation from `Get IG Conversations` and check what GHL actually returns for the type |
| Sends stop for a specific lead | Instagram's 24-hour window closed. Expected, not a fault |
| Execution list is enormous | Set `EXECUTIONS_DATA_PRUNE` / `EXECUTIONS_DATA_MAX_AGE` from step 1 |

---

## What it costs to run

**Anthropic.** The SOP is ~4,500 tokens and rides in the system block with
`cache_control`, so after the first call each run reads it from cache at a tenth
of the price instead of paying full rate. A single reply is roughly 1,000
effective input tokens plus ~200 output — on the order of **half a cent**. A
hundred replies is well under a dollar.

Critically, **an execution that finds no one to reply to calls Anthropic zero
times.** The model only runs when there is a real lead waiting, so the 2-minute
cadence costs nothing in model spend — only in execution count, which is step 1's
problem, not this one.

**Hosting.** €4–15/mo self-hosted. n8n Cloud depends entirely on where 23,400
executions/month lands on their current plans.

**GoHighLevel.** No incremental cost; it's your existing account.
