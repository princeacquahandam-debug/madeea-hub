// Edge Function: emit-alert
//
// The one place anything in this app talks OUT to the world. Called by the
// browser with the caller's JWT; posts to n8n; records what happened.
//
// WHY IT EXISTS. Every tab in the Hub was a closed loop. This is the seam that
// opens: the app emits a named event, a row in `alert_routes` decides where it
// goes, and n8n does the routing. Adding "SLA breaches also go to Slack" then
// costs an n8n node and no deploy here.
//
// WHY THE BROWSER DOES NOT CALL n8n DIRECTLY. The webhook base and its key are
// server secrets. Putting them in the bundle publishes them to anyone who opens
// devtools, and lets any page on the internet post fake breaches into your
// Slack. So the browser says "this happened", and the server decides whether
// that is true and where it goes.
//
// ENV
//   N8N_BASE_URL   e.g. https://n8n.example.com   (no trailing slash)
//   N8N_API_KEY    sent as X-N8N-API-KEY
// Unset is a supported state, not an error: the route reports itself as not
// connected and deliveries are recorded as 'skipped'. Nothing pretends to send.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const N8N_BASE_URL = (Deno.env.get("N8N_BASE_URL") ?? "").replace(/\/+$/, "");
const N8N_API_KEY = Deno.env.get("N8N_API_KEY") ?? "";
const APP_ORIGINS = (Deno.env.get("APP_ORIGINS") ?? "").split(",").map((o) => o.trim()).filter(Boolean);

/** One attempt gets this long. n8n webhooks answer in well under a second when
 *  healthy; anything slower is a problem we should record, not wait out. */
const TIMEOUT_MS = 5_000;
/** Three tries total. Beyond that the failure is not transient and the row
 *  saying so is more useful than another attempt. */
const MAX_ATTEMPTS = 3;
/** 400ms, 1200ms. Short, because a person is waiting on the response. */
const BACKOFF_MS = [400, 1200];

function corsFor(req: Request) {
  const origin = req.headers.get("Origin") ?? "";
  return {
    "Access-Control-Allow-Origin": APP_ORIGINS.includes(origin) ? origin : (APP_ORIGINS[0] ?? "null"),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsFor(req), "Content-Type": "application/json" },
  });

/** POST with a hard timeout. Retries only what is worth retrying. */
async function postWithRetry(url: string, body: unknown): Promise<{ ok: boolean; status: number; error?: string; attempts: number }> {
  let lastError = "";
  let lastStatus = 0;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(N8N_API_KEY ? { "X-N8N-API-KEY": N8N_API_KEY } : {}),
        },
        body: JSON.stringify(body),
        signal: abort.signal,
      });
      lastStatus = res.status;
      if (res.ok) return { ok: true, status: res.status, attempts: attempt };

      /* 4xx means we sent something wrong. Sending it again more slowly will
         not make it right, and retrying a 404 three times just delays telling
         the operator their webhook path is wrong. 429 is the exception. */
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        return { ok: false, status: res.status, error: `n8n rejected: ${res.status}`, attempts: attempt };
      }
      lastError = `n8n ${res.status}`;
    } catch (e) {
      lastError = e instanceof Error && e.name === "AbortError"
        ? `timeout after ${TIMEOUT_MS}ms`
        : (e instanceof Error ? e.message : String(e));
    } finally {
      clearTimeout(timer);
    }

    if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt - 1] ?? 1200));
  }
  return { ok: false, status: lastStatus, error: lastError, attempts: MAX_ATTEMPTS };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsFor(req) });
  if (req.method !== "POST") return json(req, { error: "POST only" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json(req, { error: "unauthorized" }, 401);

  let body: { event?: string; subject_id?: string; payload?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return json(req, { error: "invalid json" }, 400);
  }
  const event = (body.event ?? "").trim();
  const subjectId = (body.subject_id ?? "").trim();
  if (!event || !subjectId) return json(req, { error: "event and subject_id are required" }, 400);

  /* Two clients. The caller's, to establish who they are and which workspace
     they belong to under RLS. And the service role, to write alert_deliveries,
     which has no insert policy on purpose: only the thing that performed the
     send may record that it happened. */
  const asCaller = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
    global: { headers: { Authorization: authHeader } },
  });
  const asService = createClient(SUPABASE_URL, SERVICE_ROLE);

  const { data: route, error: routeErr } = await asCaller
    .from("alert_routes")
    .select("workspace_id,event,channel,target,audience,is_active")
    .eq("event", event)
    .maybeSingle();

  if (routeErr || !route) return json(req, { error: "no route for this event" }, 404);

  const workspaceId = route.workspace_id as string;
  const configured = route.is_active && route.channel === "n8n" && Boolean(N8N_BASE_URL);

  /* Claim the delivery BEFORE sending. The unique index on
     (workspace_id, event, subject_id) is what makes one breach produce one
     alert however many browsers recalculate it at 9am. Losing the race is a
     success, not an error: somebody else already has it. */
  const { data: claimed, error: claimErr } = await asService
    .from("alert_deliveries")
    .insert({
      workspace_id: workspaceId,
      event,
      subject_id: subjectId,
      payload: body.payload ?? {},
      status: configured ? "pending" : "skipped",
    })
    .select("id")
    .maybeSingle();

  if (claimErr) {
    // 23505 is the unique index doing its job.
    const dup = (claimErr as { code?: string }).code === "23505";
    return json(req, { ok: true, deduped: dup, error: dup ? undefined : claimErr.message }, dup ? 200 : 500);
  }

  if (!configured) {
    /* The honest path. No destination is set, so nothing was sent and the row
       says 'skipped' rather than 'sent'. The UI reads this and shows "not
       connected" instead of implying an alert went somewhere. */
    return json(req, { ok: true, delivered: false, reason: "no destination configured" });
  }

  const url = `${N8N_BASE_URL}/webhook/${String(route.target ?? event).replace(/^\/+/, "")}`;
  const result = await postWithRetry(url, {
    event,
    subject_id: subjectId,
    workspace_id: workspaceId,
    audience: route.audience,
    payload: body.payload ?? {},
    sent_at: new Date().toISOString(),
  });

  await asService
    .from("alert_deliveries")
    .update({
      status: result.ok ? "sent" : "failed",
      attempts: result.attempts,
      last_error: result.ok ? null : (result.error ?? `status ${result.status}`),
      delivered_at: result.ok ? new Date().toISOString() : null,
    })
    .eq("id", claimed!.id);

  /* A failed alert is not a failed request. The event happened, we recorded
     that we could not pass it on, and the caller has nothing useful to do with
     a 500. The failure is visible in alert_deliveries, which is where an
     operator would look for it. */
  return json(req, {
    ok: true,
    delivered: result.ok,
    attempts: result.attempts,
    error: result.ok ? undefined : result.error,
  });
});
