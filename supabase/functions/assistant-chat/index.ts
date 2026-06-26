// Supabase Edge Function: assistant-chat  (self-contained — paste as-is)
// POST { messages: [{role, content}] } -> { reply }
// Context-aware EA assistant: injects the caller's tasks + clients into the prompt.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface LlmMessage { role: "system" | "user" | "assistant"; content: string }

async function complete(messages: LlmMessage[]): Promise<string> {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({ model: "gpt-4o", messages, temperature: 0.6 }),
  });
  if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    // Auth enforced in-code (so the function can run with Verify JWT off, which
    // is required for browser CORS preflight to pass).
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "unauthorized" }, 401);
    const { messages = [] } = await req.json();
    let context = "";

    {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } },
      );
      const { data: authed } = await supabase.auth.getUser();
      if (!authed?.user) return json({ error: "unauthorized" }, 401);
      const [{ data: tasks }, { data: clients }, { data: sops }] = await Promise.all([
        supabase.from("tasks").select("title,status,due_label").limit(20),
        supabase.from("clients").select("name,title,company,preferred_channel,tone").limit(20),
        supabase.from("sops").select("title,description,steps,success_criteria").limit(30),
      ]);
      const sopSummary = (sops ?? []).map((sop: any) => {
        const stepLabels = Array.isArray(sop?.steps)
          ? sop.steps
              .map((step: any) =>
                typeof step === "string" ? step : step?.label ?? step?.title ?? step?.text ?? "",
              )
              .filter((label: string) => !!label)
          : [];
        return {
          title: sop?.title ?? "",
          description: sop?.description ?? "",
          steps: stepLabels,
          success_criteria: sop?.success_criteria ?? "",
        };
      });
      context =
        `\n\nLive context for this user:\nTasks: ${JSON.stringify(tasks ?? [])}\n` +
        `Clients: ${JSON.stringify(clients ?? [])}\n` +
        `SOPs (the team's standard operating procedures): ${JSON.stringify(sopSummary)}`;
    }

    const system: LlmMessage = {
      role: "system",
      content:
        "You are the MadeEA AI Assistant for an elite executive assistant. Be concise, proactive and " +
        "British-English. Use the live context to ground answers; if data is missing, say so. " +
        "You also know the team's SOPs (standard operating procedures) provided in the context. When " +
        "asked how to do something, find the most relevant SOP and walk the user through its steps, " +
        "referencing the SOP's title and its success criteria so they know when it's done." +
        context,
    };

    const reply = await complete([system, ...(messages as LlmMessage[])]);
    return json({ reply });
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
