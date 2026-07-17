// Supabase Edge Function: generate  (self-contained — paste as-is)
// POST { tool, format, inputs, client_id? } -> { output }
// Generates an EA document with OpenAI and logs it to ai_generations.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const MODELS = { premium: "gpt-4o", cheap: "gpt-4o-mini" } as const;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface LlmMessage { role: "system" | "user" | "assistant"; content: string }

async function complete(messages: LlmMessage[], model: keyof typeof MODELS = "premium"): Promise<string> {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({ model: MODELS[model], messages, temperature: 0.6, max_tokens: 2000 }),
  });
  // Log upstream detail, don't return it — the catch below sends the message to
  // the browser, and OpenAI's error bodies echo request internals.
  if (!res.ok) {
    console.error("openai error", res.status, await res.text());
    throw new Error("The writing engine is unavailable right now. Please try again.");
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

// Cap the prompt so one request can't burn an unbounded number of tokens.
const MAX_INPUT_CHARS = 12_000;

const BASE =
  "You are MadeEA, an elite executive-assistant writing engine. Write in clear British English. " +
  "Be concise, precise and immediately usable. Never invent facts that weren't supplied; mark unknowns as [TBC].";

function systemFor(tool: string, format: string): string {
  if (tool === "studio")
    return `${BASE} You are producing a "${format}". Match the requested tone exactly. Return only the finished document, no preamble.`;
  if (tool === "bookkeeping")
    return `${BASE} You are producing a finance document: "${format}". Use clean structured layout, show totals, flag anything over budget. Currency as provided (default £).`;
  return `${BASE} Action: "${format}". Produce the most useful one-shot output for an EA serving senior executives.`;
}

function userFor(format: string, inputs: Record<string, string>): string {
  const lines = Object.entries(inputs)
    .filter(([, v]) => v && String(v).trim())
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  return `Task: ${format}\n\nDetails:\n${lines || "(no specific details — use sensible defaults, mark gaps [TBC])"}`;
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
    const { data: allowed } = await authClient.rpc("check_ai_rate_limit", { p_fn: "generate", p_max: 40 });
    if (allowed === false) {
      return json({ error: "Rate limit reached — please try again in a little while." }, 429);
    }

    const { tool, format, inputs = {}, client_id = null } = await req.json();
    if (!tool || !format) return json({ error: "tool and format are required" }, 400);

    const prompt = userFor(String(format), inputs);
    if (prompt.length > MAX_INPUT_CHARS) return json({ error: "Input is too long." }, 413);

    const output = await complete([
      { role: "system", content: systemFor(tool, format) },
      { role: "user", content: prompt },
    ]);

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
