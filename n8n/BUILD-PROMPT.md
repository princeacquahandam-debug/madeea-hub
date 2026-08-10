# Build prompts for n8n

Prompts for n8n's AI workflow builder (or any AI assistant) to construct the two
MadeEA Instagram workflows from scratch.

**Read this first.** An AI builder will get you the node graph, the HTTP calls
and the connections. It will *not* reproduce the seven safety guards, the SOP
system prompt, or the dedup logic — that's ~400 lines of specific JavaScript, and
regenerated approximations of it are what send an off-brand DM to a founder.

So the practical route is:

1. Run the prompt to generate the structure
2. Open each Code node and **paste the real body** from
   `madeea-ig-dm-setter.workflow.json` / `madeea-ig-followup-day1.workflow.json`

Or skip both and just import the JSON. The prompts below exist for when you want
to rebuild, adapt to a different CRM, or understand the thing by constructing it.

---

## Shared context

Paste this above either prompt if your builder keeps context separately.

```
CONTEXT

I am building an Instagram DM appointment setter in n8n for MadeEA, a service
that places full-time Executive Assistants with founders and executives.

Stack:
- CRM + Instagram inbox: GoHighLevel (LeadConnector API)
- Model: Anthropic Claude (claude-sonnet-5)
- No database other than GoHighLevel and n8n's own workflow static data

GoHighLevel API — base https://services.leadconnectorhq.com
All calls send headers: Version: 2021-07-28, Accept: application/json
Auth is an n8n "Header Auth" credential named `GHL MadeEA (IG)` supplying
Authorization: Bearer <private integration token>

  GET  /conversations/search?locationId={LOCATION_ID}&limit=30&sortBy=last_message_date&sort=desc
  GET  /conversations/{conversationId}/messages
  GET  /conversations/{conversationId}
  POST /conversations/messages          body: { type:"IG", contactId, message }
  POST /contacts/{contactId}/tags       body: { tags: [ ... ] }

Anthropic API
  POST https://api.anthropic.com/v1/messages
  Header: anthropic-version: 2023-06-01
  Auth: n8n "Anthropic" credential (do NOT put the key in a header by hand)
  Body is passed straight through from an upstream node as {{ $json.requestBody }}
  and is shaped:
    {
      model: 'claude-sonnet-5',
      max_tokens: 200,
      thinking: { type: 'disabled' },
      system: [ { type:'text', text: <SOP + gate>, cache_control:{ type:'ephemeral' } } ],
      stop_sequences: ['<budget','</budget','<antml'],
      messages: [ { role:'user'|'assistant', content: '...' } ]
    }

Two constraints that shape everything:
- Instagram will not deliver a message more than 24 hours after the lead's last
  one. Every timing decision lives inside that window.
- The setter must never send more than 2 sentences.
```

---

## Prompt 1 — the DM setter

```
Build an n8n workflow called "MadeEA — IG DM Setter" with 15 nodes.

TRIGGER
1. Schedule Trigger, every 2 minutes.

FETCH
2. HTTP Request "Get IG Conversations" — GET the conversations/search endpoint
   with the GHL headers and credential.

3. Code node "Qualify + Dedup" (run once for all items). At the top put a
   CONTROL PANEL object: { dryRun: true, allowList: [], maxPerCycle: 1,
   replyDelayMin: 3, businessDays: [0..6], hours: { start: 0, end: 24 } }.
   Read $input.first().json.conversations and keep only conversations where:
     - lastMessageDirection === 'inbound'
     - lastMessageType === 'TYPE_INSTAGRAM'
     - the last message is under 24h old (Instagram's window)
     - the last message is at least replyDelayMin minutes old, so the reply does
       not land suspiciously fast
     - the contact name does not match a bot list or a team exclusion list
     - $getWorkflowStaticData('global').handled[conversationId] !== lastMessageDate
   Also hard-stop the whole run if the current hour in a configured timezone is
   outside the allowed window. Emit at most maxPerCycle items carrying
   conversationId, contactId, contactName, lastMessageDate, dryRun.

4. HTTP Request "Get Transcript" — GET conversations/{{ $json.conversationId }}/messages.

PROMPT
5. Code node "Build LLM Request" (run once for all items). Hold the full MadeEA
   DM Setting SOP in a SYSTEM_PROMPT constant and a routing gate in a GATE
   constant. Pair each transcript with its context item from
   $('Qualify + Dedup').all() by index. Convert the GHL messages into Anthropic
   turns: drop TYPE_ACTIVITY messages, reverse to chronological order, map
   inbound to role 'user' and outbound to role 'assistant', merge consecutive
   same-role turns, drop leading assistant turns, and skip the item entirely
   unless the last turn is 'user'.
   Add a no-context guard: if our side never sent any real text AND the lead's
   words look like a request for a resource promised in another funnel ("I
   commented", "send the link", "please send"), skip the item and say nothing.
   Prepend a CURRENT DATE line to the system text so the model never treats a
   past date as upcoming. Output requestBody in the Anthropic shape above, plus
   lastInbound, allInbound and noContext.

6. HTTP Request "Call Anthropic" — POST with jsonBody {{ $json.requestBody }},
   using the Anthropic credential and the anthropic-version header.

GUARDS
7. Code node "Extract Draft" (run once for all items). Pair responses with
   $('Build LLM Request').all() by index and read the text out of
   r.content[].text.
   First recognise four silent-exit tokens the model may return instead of a
   message — <SKIP>, <HOLD>, <NOTREADY>, <HANDOFF> — and blank the draft for each.
   Then clean the draft: strip namespaced control tags, collapse whitespace,
   convert em dashes to commas, and keep at most one emoji.
   Then run these guards, and blank the draft if ANY fires:
     - isBannedCategory: rejects "VA", "virtual assistant", "outsourcing",
       "offshore" (allow the word "value")
     - isUnapprovedPrice: only $3,000 and $2,250 may appear; any other currency
       figure, or any "N% off", is rejected
     - isTooLong: more than 2 sentences, unless the draft quotes $3,000 or $2,250
     - hasPlaceholder: any [BRACKET], {{var}}, <tag> or "first name"
     - isIdentityLeak: any claim to be an AI, a bot, or explicitly not human
     - isFalsePromise: claims something was emailed or sent when nothing was
     - nolink: never include the booking link in a no-context thread
   Set hold = dryRun OR any exit token OR any guard OR empty draft.
   Build a tags array: a namespaced lifecycle tag (madeea-setter-engaged /
   -not-a-fit / -deciding / -not-ready / -needs-human) plus, when the lead has
   said enough, one of madeea-wall-capacity, madeea-wall-trust,
   madeea-wall-burned-before, madeea-has-assistant, and ready_to_book when the
   booking link is present.
   Split the draft into at most 2 bubbles on newlines.

BRANCH
8. IF node "IF dry-run" on {{ $json.hold }} is true.

   TRUE branch (no send):
   9.  Code node "Hold (mark skip)" — for live (non-dryRun) items only, record
       them as handled in static data and pass them on for tagging.
   10. HTTP Request "Tag: skip" — POST contacts/{{ $json.contactId }}/tags with
       {{ { tags: $json.tags } }}.

   FALSE branch (send):
   11. HTTP Request "Re-check Conversation" — GET conversations/{{ $json.conversationId }}.
   12. Code node "Confirm Unanswered" — pair with the non-held items from
       $('Extract Draft'). Drop any item where the conversation's last message is
       now outbound (a human replied) or is newer than the one we drafted
       against. This is the last gate before a human sees anything.
   13. Code node "Send Bubbles" — a TOKEN constant holds the GHL private
       integration token (n8n credentials are not reachable from
       this.helpers.httpRequest). For each item POST up to 2 bubbles to
       conversations/messages with { type:'IG', contactId, message }, waiting
       4000ms between them so it reads like typing. Wrap each send in try/catch
       so one failure cannot kill the run.
   14. Code node "Mark Handled" — record conversationId -> lastMessageDate in
       static data for the items that actually sent.
   15. HTTP Request "Tag: engaged" — POST contacts/{{ $json.contactId }}/tags.

CONNECTIONS
Trigger → Get IG Conversations → Qualify + Dedup → Get Transcript →
Build LLM Request → Call Anthropic → Extract Draft → IF dry-run.
IF true → Hold (mark skip) → Tag: skip.
IF false → Re-check Conversation → Confirm Unanswered → Send Bubbles →
Mark Handled → Tag: engaged.

Set onError "continueRegularOutput" on Call Anthropic so one model failure does
not abort the batch.
```

---

## Prompt 2 — the day-1 follow-up

```
Build a second n8n workflow called "MadeEA — IG Follow-up (day 1)" with 20 nodes.
It chases leads who went quiet after the setter spoke, using the same SOP.

TRIGGER
1. Schedule Trigger, every 30 minutes.

FETCH
2. HTTP Request "Get Conversations" — same conversations/search endpoint, limit 40.

3. Code node "Pre-filter Candidates" — keep Instagram conversations where
   lastMessageDirection === 'outbound' (we spoke last), the contact is not a bot
   or a teammate, and the last message is under 30 hours old. Apply the same
   timezone day/hour gate as the setter. Emit conversationId, contactId,
   contactName, convLastMsgDate.

4. HTTP Request "Get Transcript" — GET conversations/{{ $json.conversationId }}/messages.

DECIDE
5. Code node "Decide" — CONTROL PANEL: { dryRun: true, maxPerCycle: 1,
   delayH: 20, windowH: 24 }.
   delayH is 20, not 24, deliberately: the SOP's first follow-up is a 24-hour
   touch but Instagram closes the window at exactly 24h, so 20 is the latest we
   can honour the cadence and still be allowed to send.
   Include an ageText(hours) helper returning "about an hour" / "about N hours" /
   "about a day" / "about N days".
   For each thread find the most recent inbound message. Skip if our side never
   sent real text. Then:
     - if static data says this lead was already nudged AND the thread is now
       past windowH, emit a { action: 'close' } item and forget the nudge flag
     - if already nudged and still inside the window, skip (never re-nudge)
     - if the last inbound is younger than delayH, skip (not due)
     - if it is past windowH, skip (unreachable)
     - otherwise emit a { action: 'nudge' } item
   For nudges build the same Anthropic requestBody as the setter, but append one
   extra user turn: an internal directive telling the model the lead has gone
   quiet for <ageText(ageH)>, to pick the follow-up rung matching whichever phase
   the conversation stalled in (Engagement / Situation / Goal / Problem /
   Invite), to reference something specific they said, never to guilt-trip or
   send a bare "just checking in", never to say VA/outsourcing/offshore, never to
   quote a price other than $3,000 or from $2,250, and to output only the message
   text — or exactly <SKIP> if the lead is consulting a partner or needs time.
   IMPORTANT: build that directive with real string concatenation
   ("...quiet for " + ageText(ageH) + " since...") — nesting it in mismatched
   quote styles silently ships the literal source text to the model.
   Also skip the thread if a message newer than the lead's last one exists by
   more than 30 minutes, which means a human already handled it.

6. IF node "IF action" on {{ $json.action }} equals "nudge".

NUDGE BRANCH (IF true)
7.  HTTP Request "Call Anthropic".
8.  Code node "Extract Follow-up" — same cleaning as the setter, and drop the
    nudge entirely if it returns <SKIP>, contains a placeholder, uses banned
    category words, quotes an unapproved price, or runs over 2 sentences.
9.  IF node "IF dry-run (nudge)" on {{ $json.dryRun }} is true.
    TRUE  → 10. NoOp "DRY RUN (no send)".
    FALSE → 11. HTTP Request "Re-check Conversation"
            → 12. Code node "Confirm Quiet" — drop the nudge if the lead replied
                  or anyone messaged since we decided
            → 13. Code node "Mark Nudged" — write conversationId -> lastInboundMs
                  into static data
            → 14. HTTP Request "Send Nudge" — POST conversations/messages with
                  {{ { type:'IG', contactId: $json.contactId, message: $json.message } }}
            → 15. HTTP Request "Tag: nudged" — tags ["madeea-setter-nudged"].

CLOSE BRANCH (IF false)
16. IF node "IF dry-run (close)" on {{ $json.dryRun }} is true.
    TRUE  → 17. NoOp "CLOSE (dry-run)".
    FALSE → 18. HTTP Request "Tag: no-response" — tags
                ["madeea-setter-no-reply","follow up"]
            → 19. HTTP Request "Find Opp" — GET opportunities/search filtered by
                  contact and pipeline (optional; delete these last two nodes if
                  you do not track opportunities)
            → 20. HTTP Request "Move to Closed" — PUT the opportunity to a closed
                  pipeline stage.
```

---

## After the builder finishes

Whatever it generated, check these five things — they are the ones an AI builder
reliably gets wrong:

1. **Index pairing.** Every Code node that reads `$('Some Node').all()` assumes
   1:1 index alignment with `$input.all()`. If the builder rewrote those into
   loops or lookups, the setter will reply to the wrong lead.
2. **The guards.** Paste them from the real file. Regenerated regexes look right
   and let real violations through.
3. **`$getWorkflowStaticData('global')`.** If the builder replaced it with a
   local variable, dedup silently stops working and leads get messaged twice.
4. **The 4-second delay** between bubbles in `Send Bubbles`, and the `try/catch`
   around each send.
5. **`dryRun: true`** still set in both CONTROL PANELs before you activate
   anything.

Then follow [DEPLOY.md](DEPLOY.md) from step 2.
