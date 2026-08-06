# Team Email Organizer (n8n)

Sorts **every team member's** inbox into the four categories the Hub already
uses — Urgent, Reply, Delegate, Archive — on a schedule, without anyone pressing
"Sync now".

Nothing is written back to Gmail. The real inbox is untouched: no labels, no
archiving, no drafts. That's what keeps the existing **read-only** OAuth scopes
sufficient and means **no teammate has to reconnect Google**.

---

## How it works

```
n8n (every 15 min)
  │
  ├─ POST action:"members"  ─────▶  everyone with Google connected in the Hub
  │
  └─ for each member:
       ├─ POST action:"fetch"  ──▶  pulls new Gmail since that mailbox's cursor,
       │                            stores it, and returns everything still unfiled
       ├─ rules pass (free, instant)      ──┐
       ├─ AI pass, only what rules missed ──┤
       └─ POST action:"commit" ◀────────────┘  writes the category + the reason
```

Everything privileged happens inside the `n8n-inbox-triage` Edge Function.
**n8n never sees a Google refresh token or access token** — it sends a user id
and gets back message metadata.

### Why the workflow is self-healing

`fetch` doesn't return "the mail I just pulled" — it returns **everything still
unfiled for that mailbox**. If a run dies halfway, or OpenAI rate-limits, or n8n
restarts, the next run picks up the leftovers automatically. No dead-letter
queue, no manual replay.

### Rules run before the AI

Every message a rule catches is one the model never sees — cheaper, instant, and
predictable. Rules live in the `triage_rules` table and are **edited in the
database, not in the workflow**, so tuning the organizer never means touching
n8n.

The starter set (installed by migration `0022`):

| Priority | Rule | Result |
|---|---|---|
| 10 | Subject contains "urgent" | Urgent |
| 15 | Subject contains "asap" | Urgent |
| 30 | Sender is a known client | Reply |
| 40 | Bulk mail (List-Unsubscribe / Gmail category label) | Archive |
| 50–60 | `noreply` / `no-reply` / `notifications@` senders | Archive |

Lowest priority number wins and the first match stops evaluation. **"Known
client" deliberately sits above the archive rules**: if a client's address also
trips the newsletter heuristic, the safe failure is a needless "Reply", never a
buried client email.

Add your own:

```sql
insert into triage_rules (name, match_type, match_value, category, priority)
values ('Board mail is always urgent', 'sender_domain', 'boardco.com', 'urgent', 5);
```

`match_type` is one of `sender_email`, `sender_email_contains`, `sender_domain`,
`subject_contains`, `is_newsletter`, `is_client`. Set `mailbox_owner_id` to scope
a rule to one person; leave it null for the whole team.

### A human's decision always wins

When a member re-files a message in the Communication Center, a database trigger
sets `category_locked`, and the organizer skips that row **forever**. This is
enforced in the DB rather than in the workflow, so it holds no matter what n8n
does. The UI shows those as "Your call"; robot-sorted ones show "Auto-filed"
with the reason on hover.

---

## Setup

### 1. Database

```bash
supabase db push        # applies 0022_email_organizer.sql
```

### 2. Secret

Pick a long random string — this is the only thing standing between the internet
and the function:

```bash
openssl rand -hex 32
supabase secrets set N8N_SHARED_SECRET=<that value>
```

### 3. Deploy the function

**Order matters** — `db push` first, then deploy. The function writes columns
that `0022` creates.

```bash
supabase functions deploy n8n-inbox-triage --no-verify-jwt
```

`--no-verify-jwt` is required: n8n has no user session. The gateway's JWT check
is replaced by the `x-n8n-secret` check inside the function, which **fails closed
when the secret is unset** — an unconfigured deploy rejects everything rather
than allowing everything.

### 4. n8n credentials

Create two credentials in your self-hosted n8n:

| Credential | Type | Value |
|---|---|---|
| `MadeEA n8n secret` | **Header Auth** | Name: `x-n8n-secret` · Value: the secret from step 2 |
| `OpenAI account` | **OpenAI** | Your existing OpenAI key |

The workflow uses OpenAI (`gpt-4o-mini`) to match what the Hub's `generate`
function already uses — no second AI vendor to manage.

### 5. Import the workflow

Import `madeea-email-organizer.workflow.json`, then:

1. Open the **Config** node and set `supabaseUrl` to your project URL
   (no trailing slash). `model`, `maxPerMailbox` and the triage prompt are also
   there — the prompt is in one place on purpose, so tuning tone doesn't mean
   editing an expression.
2. Re-select both credentials on the four HTTP nodes (imported ids won't match
   yours — they're placeholders).
3. Run once manually and check the output, then **Activate**.

### 6. Confirm

Integrations → **Team email organiser** lists every connected mailbox with its
last run, how many messages it has sorted, and any error. Communication Center
shows the new "Auto-filed" / "Unsorted" / "Your call" pills.

---

## Operational notes

- **First run per mailbox** looks back 2 days, not to the beginning of time. After
  that each run resumes from that mailbox's own cursor.
- **A broken mailbox doesn't stall the team.** If one member's Google token has
  expired, `fetch` returns a 200 with an `error` field, records it against that
  mailbox, and the loop moves on. It surfaces as "Needs attention" in
  Integrations, and that member reconnects in the Hub as usual.
- **Cost.** Only rule-misses reach the model, and it only sees sender, subject
  and preview — never the message body. At 25 messages/mailbox/run with a normal
  rule hit rate, this is cents per day.
- **Tuning cadence.** Every 15 minutes suits an inbox that's actively watched.
  Hourly is plenty for most teams and cuts API calls 4×; change it in the
  Schedule Trigger.

## One thing to be aware of

The Hub is a **single shared workspace** — by design, every member sees all
clients, tasks and messages. That applies here: mail pulled from one EA's mailbox
is readable by every other member, exactly as it already is when someone presses
"Sync now" today. The organizer doesn't change that rule, it just makes it happen
on a schedule for everyone.

If you'd rather each EA only saw their own synced mail, that's a change to the
`messages` RLS policy (scope to `owner_id` instead of workspace) — a deliberate
decision to make, not a side effect to stumble into. Say the word and it's a
short follow-up migration.
