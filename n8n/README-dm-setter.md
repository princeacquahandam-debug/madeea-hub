# MadeEA — Instagram DM Setter (n8n)

Two workflows that work the MadeEA Instagram inbox: one replies to people who
write in, one chases the ones who go quiet. Both run on the **MadeEA DM Setting
SOP** as their brain — the five-phase flow, the Fact Pack, the three walls, and
the follow-up ladder are all inside the system prompt.

| File | What it does | Cadence |
|---|---|---|
| `madeea-ig-dm-setter.workflow.json` | Replies to new inbound IG DMs, phase by phase, until the lead is ready for the booking link | Every 2 min |
| `madeea-ig-followup-day1.workflow.json` | Sends the SOP's F/U 1 to leads who went quiet, then closes the loop | Every 30 min |

They are re-contexted from a working GoHighLevel + Instagram + Claude setup, so
the plumbing is proven. What changed is the context: the brain, the guardrails,
the tags, and every account it points at.

---

## How the setter works

```
Every 2 min
  │
  ├─ GHL: newest 30 IG conversations
  ├─ Qualify + Dedup ──── inbound only · inside IG's 24h window · ≥3 min old ·
  │                       not a teammate · not already handled · 1 per cycle
  ├─ GHL: full transcript
  ├─ Build LLM Request ── SOP + lead gate → system block (cached)
  │                       real transcript → messages
  ├─ Claude Sonnet 5
  ├─ Extract Draft ────── every guardrail lives here (see below)
  ├─ IF hold? ─── yes ──▶ tag only, send nothing
  │               no
  ├─ Re-check conversation ── did anyone reply while we were thinking?
  ├─ Send Bubbles ──────── ≤2 bubbles, 4s apart
  └─ Tag the contact
```

The follow-up workflow is the mirror image: it looks for threads where **we**
spoke last, waits for the SOP's 24-hour mark, and sends one nudge written for
whichever phase the conversation stalled in.

### Why the model is never trusted to be safe on its own

The SOP has rules a language model will break eventually — not maliciously, just
by drifting. `Extract Draft` enforces the ones that would cost real money if they
slipped through, and a draft that trips any of them is **held for a human rather
than softened**:

| Guard | Enforces |
|---|---|
| `isBannedCategory` | SOP non-negotiable #5 — never say *VA*, *virtual assistant*, *outsourcing*, or *offshore*. One wrong noun puts MadeEA in the category it spent the whole SOP escaping. |
| `isUnapprovedPrice` | SOP non-negotiable #7 — the only figures that may appear are **$3,000/month** and **$2,250/month**. An invented rate, a made-up range, or any `% off` is blocked. |
| `isTooLong` | SOP non-negotiable #4 — max 2 sentences, unless the message is quoting the pricing tiers. |
| `hasPlaceholder` | Never ship a live DM containing `[FIRST NAME]` or `{{var}}`. |
| `isIdentityLeak` | Never claim to be an AI. (The SOP's own bot-hater reply passes this — it acknowledges volume filtering without claiming to be either.) |
| `isFalsePromise` | Never say "just sent that over" when nothing was sent. |
| keyword-funnel guard | If our side never wrote real text and the lead's message only makes sense as a reply to a freebie promised elsewhere, stay out entirely. |

Unlike a generic setter, **pricing is allowed here** — the SOP publishes its
numbers, so the gate lets the model answer a money question plainly and then
steer back to the call. The guard exists to cap *which* numbers, not to forbid
the topic.

### The four silent exits

The model answers with a bare token instead of a message when the right move is
silence:

- `<SKIP>` — not a prospect (job seeker, agency pitching us, spam, or a freebie
  chaser from another funnel)
- `<HOLD>` — they are talking it over with a co-founder or need to think
- `<NOTREADY>` — purely disengaging, no question attached
- `<HANDOFF>` — custom scope, legal/contractual, an existing client, a competitor
  comparison, press/partnerships, or anything needing a claim outside the Fact Pack

Each maps to its own `madeea-setter-*` tag so the team can see why the bot went
quiet.

### Tags it writes

Lifecycle tags are namespaced so they can never trip an existing GHL automation:

`madeea-setter-engaged` · `-not-a-fit` · `-deciding` · `-not-ready` ·
`-needs-human` · `-nudged` · `-no-reply` · `-pricing-asked`

Lead intelligence uses the SOP's own vocabulary — the Phase 4 walls, which are
what decide the Phase 5 bridge:

`madeea-wall-capacity` · `madeea-wall-trust` · `madeea-wall-burned-before` ·
`madeea-has-assistant`

---

## Setup

### 1. Credentials

Create three in n8n. The imported ids are placeholders — **re-select all of them
on every node after import.**

| Credential | Type | Value |
|---|---|---|
| `GHL MadeEA (IG)` | Header Auth | Name `Authorization`, value `Bearer <private integration token>` |
| `Anthropic account` | Anthropic | Your Anthropic API key |

### 2. Fill in the placeholders

Search both files for `REPLACE_WITH_` — there are two:

- `REPLACE_WITH_MADEEA_GHL_LOCATION_ID` — in the two "Get conversations" URLs
- `REPLACE_WITH_MADEEA_GHL_PRIVATE_INTEGRATION_TOKEN` — in `Send Bubbles`

The second one is a plain constant in a Code node because n8n credentials aren't
reachable from `this.helpers.httpRequest`. Treat it as a secret: fill it in
inside n8n, and don't commit the filled-in file.

### 3. Confirm the two open questions

Both come straight from the SOP's own "gaps to confirm before go-live" list:

1. **Booking link.** Currently `https://madeeas.com/madeea-contact`, which is a
   contact form. A form between a warm DM and a booked call is where most of the
   conversion leaks — swap in a direct Calendly the moment you have one. It
   appears in the system prompt (Phase 5) and in the `nolink` guard regex.
2. **Timezone.** Set to `Europe/London` in both files as a placeholder. This
   clock decides what counts as an unsociable hour to DM a founder, so set it to
   wherever the lead base actually is before going live.

### 4. Add the team to the exclusion lists

In `Qualify + Dedup` and `Pre-filter Candidates`, fill in `EXCLUDE_CONTACT_IDS`
and confirm `EXCLUDE_NAMES`. Until you do, the setter can DM your own people.

### 5. Run in dry-run first

**Both workflows ship with `dryRun: true`.** In that state everything runs and
drafts are visible in the execution log, but nothing is sent. Read 20–30 drafts,
tune the SOP text in the `SYSTEM_PROMPT` constant, then flip `dryRun` to `false`
in the CONTROL PANEL at the top of `Qualify + Dedup` and `Decide`.

Activate the setter first and let it run alone for a day. Only then activate the
follow-up — it can only chase conversations the setter has already started.

---

## Tuning

**The SOP is the product.** It lives in one place per workflow: the
`SYSTEM_PROMPT` constant at the top of `Build LLM Request` (setter) and `Decide`
(follow-up). Change the openers, the objection scripts, or the Fact Pack there —
not in the guards, and not in the gate.

Two rules when editing it:

- **Keep both copies in sync.** The setter and the follow-up must share the same
  brain, or the nudge will contradict the conversation it is chasing.
- **If you add a claim, add it to the Fact Pack.** The gate tells the model it
  may only say what is in the Fact Pack, so a claim added anywhere else is a
  claim the model has been told not to make.

The prompt is sent with `cache_control: ephemeral`, so after the first call each
run reads the ~4.5k-token brain from cache rather than paying for it again.
Editing the SOP invalidates that cache once, then it re-warms.

### Rate of contact

`maxPerCycle: 1` on both. At a 2-minute cadence that is a ceiling of 30
replies/hour, but in practice it is far lower — the setter only ever replies to
people who wrote to us first. Raise it only if the queue is genuinely backing up;
Instagram is unforgiving about volume from a single handle.

---

## Two things to know

**Instagram's 24-hour window governs everything.** Meta will not deliver a
message more than 24 hours after the lead's last one. That is why the follow-up
fires at ~20 hours rather than the SOP's stated 24 — it is the latest we can
honour the cadence and still be allowed to send. It is also why F/U 2 (3 days)
and F/U 3 (7 days) from the SOP have **no workflow yet**: they fall outside the
window and would need a different channel (email, or a paid Meta message tag) to
deliver at all. Right now the sequence is: reply → one nudge at ~20h → close the
loop. Everything past that is manual.

**The setter never books anything.** It sends the link. Nothing in these two
workflows watches a calendar, so "link sent" and "call booked" are still
different facts, and the gap between them is the number worth watching.
