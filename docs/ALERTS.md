# Alerts: proving the round trip

The first path out of the app. An SLA breach leaves the browser, crosses the
server, reaches n8n, and leaves a row behind saying what happened.

## State

Applied and deployed to `madeea-hub` (`bglduxferbjmoeqzyypx`) on 17 Aug 2026.
Migrations 0026 to 0036 are in. `emit-alert` is deployed, ACTIVE, and verified
end to end against production.

The route is live and reports **Not connected**, which is correct: no
destination is configured, so deliveries record as `skipped` and nothing claims
to have sent anything.

## The one thing left

```bash
supabase secrets set N8N_BASE_URL=https://your-n8n-host      # no trailing slash
supabase secrets set N8N_API_KEY=...
```

Then in the app: Settings, Alerts, channel `n8n webhook`, path `sla-breach`,
tick "Send these". Admins only. In n8n, a Webhook node on
`POST /webhook/sla-breach`.

## Prove it

Get a JWT for a signed-in user (devtools → Application → Local Storage →
`sb-*-auth-token` → `access_token`), then:

```bash
curl -i -X POST "$SUPABASE_URL/functions/v1/emit-alert" \
  -H "Authorization: Bearer $USER_JWT" \
  -H "Content-Type: application/json" \
  -d '{"event":"sla_breach","subject_id":"curl-test-1",
       "payload":{"client":"Vantage","waiting_hours":31.5}}'
```

Expected, with a destination configured:

```json
{"ok":true,"delivered":true,"attempts":1}
```

Expected, with none:

```json
{"ok":true,"delivered":false,"reason":"no destination configured"}
```

Then check it landed:

```sql
select event, subject_id, status, attempts, last_error, delivered_at
from alert_deliveries order by created_at desc limit 5;
```

`status` is `sent`, `skipped` or `failed`. Never anything else, and never
`sent` unless n8n returned 2xx.

Run the same curl twice. The second returns `{"ok":true,"deduped":true}` and
writes no second row. That is the unique index, and it is why five EAs opening
the dashboard at 9am produce one alert rather than five.

## Named failure case

**n8n is down, or the webhook path is wrong.**

A wrong path gives 404, which is not retried, because retrying it three times
only delays telling you the path is wrong. A 5xx or a hang is retried three
times with 400ms and 1200ms backoff, and each attempt is abandoned after 5s.

Either way the request returns 200 with `delivered: false`, and the row reads:

```
status = 'failed'   attempts = 3   last_error = 'timeout after 5000ms'
```

The dashboard render that triggered it is unaffected. Nothing retries later:
delivery is best-effort by design, and the record of the miss is the compensating
control.

**Not yet built:** a surface that shows failed deliveries. Today you find them
with the query above. `useAlertDeliveries()` exists and has no screen.

## What is verified, and how

| Claim | How |
|---|---|
| All 34 migrations apply in order | `npm run check:migrations` locally, then applied to production |
| The 20 new tables, 11 new columns, 5 functions and 2 buckets exist | 14 assertions against production after the fact |
| RLS on every new table; the answer key has no policy at all | Same production check |
| Thresholds shared, admin-only writes, tenant isolated | 15 assertions against real Postgres |
| One alert per breach under concurrency | Four racing inserts, one row |
| Nobody can forge or delete a delivery record | As EA and as admin |
| Retry, timeout and 4xx behaviour | 8 assertions against a real HTTP server |
| The deployed function rejects an unauthenticated call | 401 from production |
| A caller with no workspace gets no route | 404 from production |
| A real member gets 200, `delivered: false`, and a `skipped` row | Live, with a minted session |
| A repeat of the same breach is deduped | Live, second call returned `deduped: true` |

**Still not verified:** the hop to n8n itself. `N8N_BASE_URL` is unset, so the
last leg has only been exercised against a local server that behaves like n8n.
Everything up to that boundary is proven in production.
