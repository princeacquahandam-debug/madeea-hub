// Supabase Edge Function: voice-parse  (self-contained — paste as-is)
// POST { transcript, clients: [{ id, name, company }], today } -> { parsed }
//
// Turns a spoken note into structured task fields with Claude. Deliberately does
// NOT do date arithmetic it can't be trusted with: the client re-derives relative
// dates locally and overrides this response (see src/lib/voiceTask.ts). Anything
// returned here is treated as a suggestion and validated before it reaches a task.
//
// Deploy:  supabase functions deploy voice-parse
// Secret:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const MODEL = "claude-opus-4-8";

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
      "Speech-to-text output is messy — ignore filler words and self-corrections, and write a clean " +
      "imperative title. Priority is 'normal' unless urgency was expressed.";

    const user = [
      `Today is ${today ?? new Date().toISOString().slice(0, 10)}.`,
      "",
      roster ? `Known clients (use a name ONLY if it appears here):\n${roster}` : "There are no known clients.",
      "",
      `Spoken note: "${transcript}"`,
    ].join("\n");

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
    });

    if (!res.ok) return json({ error: `Anthropic error ${res.status}: ${await res.text()}` }, 502);
    const data = await res.json();

    if (data.stop_reason === "refusal") return json({ error: "request declined" }, 422);
    const text = (data.content ?? []).find((b: { type: string }) => b.type === "text")?.text ?? "";
    if (!text) return json({ error: "empty response" }, 502);

    return json({ parsed: JSON.parse(text) });
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
