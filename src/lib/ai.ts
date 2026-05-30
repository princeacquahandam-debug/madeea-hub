import { supabase, isSupabaseConfigured } from "@/lib/supabase";

export interface GeneratePayload {
  tool: "quick_action" | "studio" | "bookkeeping";
  format: string;
  inputs: Record<string, string>;
}

/**
 * Calls the `generate` Edge Function (OpenAI, server-side). The browser never
 * holds the model key. In demo mode (no Supabase configured) returns a clearly
 * labelled placeholder so the UX is exercisable end-to-end.
 */
export async function generate(payload: GeneratePayload): Promise<string> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.functions.invoke("generate", { body: payload });
    if (error) throw error;
    return (data as { output: string }).output;
  }
  // Demo fallback
  await new Promise((r) => setTimeout(r, 700));
  const filled = Object.entries(payload.inputs)
    .filter(([, v]) => v)
    .map(([k, v]) => `• ${k}: ${v}`)
    .join("\n");
  return [
    `[DEMO OUTPUT — ${payload.format}]`,
    "",
    "Connect Supabase + set OPENAI_API_KEY to generate real output.",
    "",
    "Inputs received:",
    filled || "(none)",
  ].join("\n");
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export async function assistantChat(messages: ChatMessage[]): Promise<string> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.functions.invoke("assistant-chat", { body: { messages } });
    if (error) throw error;
    return (data as { reply: string }).reply;
  }
  await new Promise((r) => setTimeout(r, 600));
  return "[DEMO] I'm the MadeEA assistant. Connect Supabase + OpenAI to enable live, context-aware replies that know Sarah's tasks and clients.";
}
