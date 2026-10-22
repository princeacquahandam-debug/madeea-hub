// Supabase Edge Function: voice-parse  (self-contained. Paste as-is)
// POST { transcript, clients: [{ id, name, company }], today } -> { parsed }
//
// Turns a spoken note into structured task fields with Claude. Deliberately does
// NOT do date arithmetic it can't be trusted with: the client re-derives relative
// dates locally and overrides this response (see src/lib/voiceTask.ts). Anything
// returned here is treated as a suggestion and validated before it reaches a task.
//
// Deploy:  supabase functions deploy voice-parse
// Secret:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...

// Imported solely to record what a call spent; the parse itself talks to
// Anthropic directly and needs nothing from Supabase.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const MODEL = "claude-opus-4-8";

/** What one model call spent, taken from the provider's own response. */
interface Spend {
  model: string; input: number; output: number;
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
   losing the record is cheaper than losing the work. */
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


const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "Imperative, concise task title. No 'remind me to' scaffolding." },
    due_date: {
      type: ["string", "null"],
      description: "YYYY-MM-DD, or null if no date was stated. Do not guess a date that wasn't mentioned.",
    },
    client_tag: {
      type: ["string", "null"],
      description: "Exact name of a client from the supplied list, or null. Never invent a name.",
    },
    priority: { type: "string", enum: ["urgent", "high", "normal", "low"] },
  },
  required: ["title", "due_date", "client_tag", "priority"],
  additionalProperties: false,
} as const;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    // Auth enforced in-code so the function can run with Verify JWT off, which the
    // browser's CORS preflight requires. Same pattern as the `generate` function.
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "unauthorized" }, 401);
    // One PostHog trace per request; sends nothing without consent (0093).
    const ph = phStart(auth, "voice-parse");

    const { transcript, clients = [], today } = await req.json();
    if (!transcript || typeof transcript !== "string") return json({ error: "transcript is required" }, 400);
    if (!ANTHROPIC_API_KEY) return json({ error: "ANTHROPIC_API_KEY is not set" }, 500);

    const roster = (clients as { name: string; company?: string }[])
      .map((c) => `- ${c.name}${c.company ? ` (${c.company})` : ""}`)
      .join("\n");

    const system =
      "You convert an executive assistant's spoken note into a single structured task. " +
      "Extract ONLY what the speaker actually said. Never invent a due date, a client, or detail " +
      "that was not stated or clearly implied. If something wasn't mentioned, return null. " +
      "Speech-to-text output is messy. Ignore filler words and self-corrections, and write a clean " +
      "imperative title. Priority is 'normal' unless urgency was expressed.";

    const user = [
      `Today is ${today ?? new Date().toISOString().slice(0, 10)}.`,
      "",
      roster ? `Known clients (use a name ONLY if it appears here):\n${roster}` : "There are no known clients.",
      "",
      `Spoken note: "${transcript}"`,
    ].join("\n");

    const t0 = Date.now();
    const meta = () => ({ model: MODEL, latency: (Date.now() - t0) / 1000, action: "parse_task" });
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system,
        messages: [{ role: "user", content: user }],
        output_config: { format: { type: "json_schema", schema: SCHEMA } },
      }),
    }).catch((e) => {
      void recordSpend(auth, "voice-parse", "anthropic", { ...meta(), input: 0, output: 0, status: 0, error: true }, ph);
      throw e;
    });

    if (!res.ok) {
      // A failed call writes no spend row; it is only reported to PostHog.
      void recordSpend(auth, "voice-parse", "anthropic", { ...meta(), input: 0, output: 0, status: res.status, error: true }, ph);
      return json({ error: `Anthropic error ${res.status}: ${await res.text()}` }, 502);
    }
    const data = await res.json();

    void recordSpend(auth, "voice-parse", "anthropic", {
      ...meta(),
      input: data.usage?.input_tokens ?? 0,
      output: data.usage?.output_tokens ?? 0,
      status: res.status,
    }, ph);

    if (data.stop_reason === "refusal") return json({ error: "request declined" }, 422);
    const text = (data.content ?? []).find((b: { type: string }) => b.type === "text")?.text ?? "";
    if (!text) return json({ error: "empty response" }, 502);

    return json({ parsed: JSON.parse(text) });
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
