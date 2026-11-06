// Supabase Edge Function: generate  (deploy with the CLI: index.ts plus models.ts, prompts.ts and quickActions.ts)
// POST { tool, format, inputs, client_id? } -> { output }
// Generates an EA document with OpenAI and logs it to ai_generations.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { FALLBACK, TOPIC_GATE, isJsonObject, requestBody, usageOf, type ModelSpec } from "./models.ts";
import { OFF_TOPIC_REPLY, TOPIC_CHECK, specFor, systemFor, userFor } from "./prompts.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface LlmMessage { role: "system" | "user" | "assistant"; content: string }

/** What one model call spent, taken from the provider's own response. */
interface Spend {
  /* cached: the part of input billed at the cached rate (0101). */
  model: string; input: number; output: number; cached?: number;
  /* For PostHog only, never stored: seconds the call took, the provider's
     HTTP status, whether it failed (then tokens are 0 and no spend row is
     written), and a short fixed name for what the call was doing. */
  latency?: number; status?: number; error?: boolean; action?: string;
}

/* Recorded per call so Settings can show usage per account (migration 0069).
   Takes the auth header rather than a client so it works from anywhere in the
   handler, and builds its own: the row is written AS THE CALLER, which is what
   the insert policy pins spend to.

   Never throws and never blocks. A spend row that fails to write must not fail
   the request that earned it — the call has already been paid for by then, and
   losing the record is cheaper than losing the work.

   Inlined rather than shared because each function here deploys standalone,
   the same reason corsFor and aesKey are already duplicated across this
   directory. */
async function recordSpend(
  authHeader: string,
  feature: string,
  provider: "openai" | "anthropic",
  s: Spend,
  ph?: Ph,
): Promise<void> {
  const work = (async () => {
    // A failed call spent nothing, so it has no spend row; it only goes to PostHog.
    let cost: number | null = null;
    if (!s.error) {
      try {
        const db = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_ANON_KEY")!,
          { global: { headers: { Authorization: authHeader } } },
        );
        const row = {
          feature,
          provider,
          model: s.model,
          input_tokens: s.input,
          output_tokens: s.output,
          cached_input_tokens: s.cached ?? 0,
        };
        if (ph && PH_TOKEN) {
          /* Read back the price the ai_spend_priced trigger (0069) set, so
             PostHog shows the same cost as Settings and no price list is
             duplicated here. The select policy covers every row the insert
             policy allows (own row, own workspace). */
          const { data, error } = await db.from("ai_spend").insert(row).select("cost_usd").maybeSingle();
          if (error) console.error("ai_spend insert failed", error.message);
          else if (data?.cost_usd != null) cost = Number(data.cost_usd);
        } else {
          const { error } = await db.from("ai_spend").insert(row);
          if (error) console.error("ai_spend insert failed", error.message);
        }
      } catch (e) {
        console.error("ai_spend insert threw", e);
      }
    }
    phGeneration(ph, provider, s, cost, feature);
  })();
  phKeepAlive(work);
  return work;
}

/* ── PostHog LLM analytics, privacy mode (tracking plan, Oct 2026) ─────────
   One `$ai_generation` event per model call: model, tokens, cost, latency,
   status. NEVER the prompt or the answer: no $ai_input, no $ai_output_choices.
   Sent only when POSTHOG_TOKEN is set AND the caller said yes to analytics
   (profiles.analytics_consent = 'yes', read as the caller, once per request).
   Fire-and-forget with a short timeout: analytics never fails or slows a reply.
   Inlined for the same standalone-deploy reason as recordSpend. */
const PH_TOKEN = Deno.env.get("POSTHOG_TOKEN") ?? "";
const PH_HOST = (Deno.env.get("POSTHOG_HOST") ?? "https://eu.i.posthog.com").replace(/\/+$/, "");

interface PhWho { id: string; role: string | null; org: string | null }
/** Per request: the caller's token, which function this is, and one trace id. */
interface Ph { auth: string; feature: string; trace: string; who?: Promise<PhWho | null> }

function phStart(auth: string, feature: string): Ph {
  return { auth, feature, trace: crypto.randomUUID() };
}

/** Keep a background promise alive after the response is sent, where the runtime allows it. */
function phKeepAlive(p: Promise<unknown>): void {
  try {
    // deno-lint-ignore no-explicit-any
    (globalThis as any).EdgeRuntime?.waitUntil?.(p.catch(() => {}));
  } catch { /* not available: the promise simply runs un-awaited */ }
}

/** A short, fixed identifier or "other". Keeps free text out of event properties. */
function phSlug(v: unknown): string {
  const s = String(v ?? "");
  return /^[A-Za-z0-9_-]{1,40}$/.test(s) ? s : "other";
}

/** The caller's user id, role and workspace, or null when they have not consented. */
function phWho(ph: Ph): Promise<PhWho | null> {
  ph.who ??= (async (): Promise<PhWho | null> => {
    // The JWT's subject. Not trusted on its own: the reads below go through
    // PostgREST with the same token, which verifies it, and RLS only returns
    // the caller's own profile row for it.
    const part = ph.auth.replace(/^Bearer\s+/i, "").split(".")[1] ?? "";
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const sub = String(JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)))?.sub ?? "");
    if (!sub) return null;
    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: ph.auth } } },
    );
    const [{ data: prof }, { data: mem }] = await Promise.all([
      db.from("profiles").select("analytics_consent").eq("id", sub).maybeSingle(),
      db.from("memberships").select("workspace_id, role").eq("user_id", sub)
        .order("created_at", { ascending: true }).limit(1).maybeSingle(),
    ]);
    if (prof?.analytics_consent !== "yes") return null;
    return { id: sub, role: mem?.role ?? null, org: mem?.workspace_id ?? null };
  })().catch(() => null);
  return ph.who;
}

/** Send one event as the caller. Never throws, never awaited by the reply. */
function phSend(ph: Ph | undefined, event: string, props: Record<string, unknown>): void {
  if (!ph || !PH_TOKEN) return;
  const timestamp = new Date().toISOString();
  phKeepAlive((async () => {
    const who = await phWho(ph);
    if (!who) return;
    await fetch(`${PH_HOST}/i/v0/e/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: PH_TOKEN,
        event,
        distinct_id: who.id,
        timestamp,
        properties: {
          ...props,
          feature: ph.feature,
          role: who.role,
          organization: who.org,
          ...(who.org ? { $groups: { organization: who.org } } : {}),
          $lib: "madeea-edge",
        },
      }),
      signal: AbortSignal.timeout(3_000),
    });
  })().catch(() => {}));
}

/** `$ai_generation` for one model call. Counts only: no prompt, no output. */
function phGeneration(
  ph: Ph | undefined,
  provider: "openai" | "anthropic",
  s: Spend,
  cost: number | null,
  feature: string,
): void {
  if (!ph) return;
  phSend(ph, "$ai_generation", {
    $ai_trace_id: ph.trace,
    $ai_model: s.model,
    $ai_provider: provider,
    $ai_input_tokens: s.input,
    $ai_output_tokens: s.output,
    ...(cost != null ? { $ai_total_cost_usd: cost } : {}),
    ...(s.latency != null ? { $ai_latency: s.latency } : {}),
    $ai_http_status: s.status ?? 200,
    $ai_is_error: !!s.error,
    action: phSlug(s.action ?? (feature !== ph.feature ? feature.replace(/-/g, "_") : "call")),
  });
}


/** One model call. Throws on an HTTP error. */
async function callModel(messages: LlmMessage[], spec: ModelSpec, onUsage?: (s: Spend) => void): Promise<string> {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");
  const t0 = Date.now();
  const failed = (status: number) =>
    onUsage?.({ model: spec.model, input: 0, output: 0, latency: (Date.now() - t0) / 1000, status, error: true });
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify(requestBody(spec, messages)),
  }).catch((e) => { failed(0); throw e; });
  // Log upstream detail, don't return it, the catch below sends the message to
  // the browser, and OpenAI's error bodies echo request internals.
  if (!res.ok) {
    failed(res.status);
    console.error("openai error", spec.model, res.status, await res.text());
    throw new Error("The writing engine is unavailable right now. Please try again.");
  }
  const data = await res.json();
  onUsage?.({ model: spec.model, ...usageOf(data), latency: (Date.now() - t0) / 1000, status: res.status });
  return data.choices?.[0]?.message?.content ?? "";
}

/* The small model first; on a failure, or an empty or unparseable answer where
   JSON was asked for, the same request once more on the larger model
   (models.ts, the deck's switch rule). */
async function complete(messages: LlmMessage[], spec: ModelSpec, onUsage?: (s: Spend) => void): Promise<string> {
  try {
    const out = await callModel(messages, spec, onUsage);
    if (out.trim() && (!spec.json || isJsonObject(out))) return out;
    console.error("small model answer unusable, retrying on the fallback", spec.model);
  } catch (e) {
    if (spec.model === FALLBACK.model) throw e;
    console.error("small model failed, retrying on the fallback", spec.model, e);
  }
  return await callModel(messages, { ...FALLBACK, maxTokens: Math.max(FALLBACK.maxTokens, spec.maxTokens), json: spec.json }, onUsage);
}

// Cap the prompt so one request can't burn an unbounded number of tokens.
const MAX_INPUT_CHARS = 12_000;

/* Only the tools a person types free text into. The rest are fed facts the app
   computed itself, so screening them would cost a call and catch nothing. */
const SCREENED_TOOLS = new Set(["quick_action", "studio"]);

/* Fails OPEN: a broken classifier must not take generation down with it, and
   SCOPE in the system prompt still holds the line. */
async function isOnTopic(text: string, onUsage?: (s: Spend) => void): Promise<boolean> {
  if (!OPENAI_API_KEY || !text.trim()) return true;
  const t0 = Date.now();
  const failed = (status: number) =>
    onUsage?.({ model: TOPIC_GATE.model, input: 0, output: 0, latency: (Date.now() - t0) / 1000, status, error: true });
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify(requestBody(TOPIC_GATE, [
        { role: "system", content: TOPIC_CHECK },
        { role: "user", content: text.slice(0, 2_000) },
      ])),
    });
    if (!res.ok) {
      failed(res.status);
      console.error("topic check failed", res.status, await res.text());
      return true;
    }
    const data = await res.json();
    onUsage?.({ model: TOPIC_GATE.model, ...usageOf(data), latency: (Date.now() - t0) / 1000, status: res.status, action: "topic_check" });
    return !String(data.choices?.[0]?.message?.content ?? "").trim().toUpperCase().startsWith("OFF");
  } catch (e) {
    failed(0);
    console.error("topic check threw", e);
    return true;
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    // Auth enforced in-code (so the function can run with Verify JWT off, which
    // is required for browser CORS preflight to pass).
    const authHeader0 = req.headers.get("Authorization");
    if (!authHeader0) return json({ error: "unauthorized" }, 401);
    // One PostHog trace per request; sends nothing without consent (0093).
    const ph = phStart(authHeader0, "generate");
    const authClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader0 } } },
    );
    const { data: authed } = await authClient.auth.getUser();
    if (!authed?.user) return json({ error: "unauthorized" }, 401);

    // Per-user quota. Identity is taken from auth.uid() inside the function, so
    // this cannot be spoofed from the body. Without it, one valid login could
    // loop this endpoint and drain the OpenAI budget.
    // Fails CLOSED: `allowed !== true` also catches an RPC error or a null,
    // which is what you get if 0016 hasn't been applied yet. Checking only for
    // `=== false` would let every request through whenever the limiter itself is
    // broken. I.e. exactly when it's needed. Deploy the migration before this.
    /* Per day: 150 AI calls or $0.50 per person (0101, deck slide 12). Until
       0101 runs the old hourly limiter answers instead, so the order of
       deploying the function and running the migration doesn't matter. */
    let { data: allowed, error: rlErr } = await authClient.rpc("check_ai_daily_budget", { p_fn: "generate" });
    if (rlErr) {
      console.error("check_ai_daily_budget failed, using the hourly limit", rlErr.message);
      ({ data: allowed, error: rlErr } = await authClient.rpc("check_ai_rate_limit", { p_fn: "generate", p_max: 40 }));
      if (rlErr) console.error("check_ai_rate_limit failed", rlErr.message);
    }
    if (allowed !== true) {
      return json({ error: "You've reached today's AI limit. It resets tomorrow." }, 429);
    }

    const { tool, format, inputs = {}, client_id = null } = await req.json();
    if (!tool || !format) return json({ error: "tool and format are required" }, 400);

    const prompt = userFor(String(format), inputs);
    if (prompt.length > MAX_INPUT_CHARS) return json({ error: "Input is too long." }, 413);

    const onUsage = (sp: Spend) => void recordSpend(authHeader0, "generate", "openai", { ...sp, action: sp.action ?? phSlug(tool) }, ph);
    const messages: LlmMessage[] = [
      { role: "system", content: systemFor(tool, format) },
      { role: "user", content: prompt },
    ];

    /* Screen what the person typed, IN PARALLEL with the answer (deck slide 12):
       an off-topic request still gets the redirect, but on-topic ones no longer
       wait for the check. Keys starting "_" (e.g. _context, the previous AI
       answer) are the app's own, so they are left out of it. */
    let gate: Promise<boolean> = Promise.resolve(true);
    if (SCREENED_TOOLS.has(String(tool))) {
      const typed = Object.entries(inputs as Record<string, string>)
        .filter(([k, v]) => !k.startsWith("_") && v && String(v).trim())
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n");
      gate = isOnTopic(
        `Action: ${format}\n${typed}`,
        (sp) => void recordSpend(authHeader0, "topic-check", "openai", sp, ph),
      );
    }
    const answer = complete(messages, specFor(String(tool), String(format)), onUsage);
    if (!(await gate)) {
      answer.catch(() => {});
      phSend(ph, "topic_gate_blocked", { category: "generate", tool: phSlug(tool) });
      return json({ output: OFF_TOPIC_REPLY });
    }
    const output = await answer;

    // Best-effort history log (SUPABASE_URL / SUPABASE_ANON_KEY are auto-injected by the platform).
    const authHeader = req.headers.get("Authorization");
    if (authHeader) {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } },
      );
      const { data: u } = await supabase.auth.getUser();
      if (u?.user) {
        await supabase.from("ai_generations").insert({
          owner_id: u.user.id, client_id, tool, format, inputs, output,
        });
      }
    }

    return json({ output });
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
