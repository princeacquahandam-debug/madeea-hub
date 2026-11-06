// Model settings (Abder's "AI quick actions and cost" deck, 6 Nov 2026, slide 12).
//
// KEEP IN SYNC: the same file lives in generate/ and assistant-chat/, because
// each function deploys on its own. Edit one, copy it to the other.
//
//   Madeline chat     gpt-5-mini · reasoning low · max 1,000
//   Topic gate        gpt-4.1-nano · runs in parallel with the answer
//   Quick actions     gpt-5-mini · reasoning minimal · JSON output · max 600
//   Writing & drafts  gpt-4.1-mini · temp 0.5 · max 150-600 per action
//
// Switch rule (slide 12): keep the larger model wherever the small one is not
// good enough. Enforced here at run time too: if a small-model call fails, or a
// JSON action comes back unparseable, the same request is retried once on
// gpt-4o, so a bad answer costs a retry rather than a broken screen. Every
// call is logged with its model, so PostHog shows how often that happens.

export type Reasoning = "minimal" | "low" | "medium";

export interface ModelSpec {
  model: string;
  /** gpt-5 family only. */
  reasoning?: Reasoning;
  /** Non-reasoning models only (gpt-5 accepts only its default). */
  temperature?: number;
  /** Output cap. For gpt-5 models this includes the reasoning tokens. */
  maxTokens: number;
  /** Ask for a JSON object back (the prompt must say JSON). */
  json?: boolean;
}

export const CHAT: ModelSpec = { model: "gpt-5-mini", reasoning: "low", maxTokens: 1000 };
export const TOPIC_GATE: ModelSpec = { model: "gpt-4.1-nano", temperature: 0, maxTokens: 2 };
export const QUICK_ACTION: ModelSpec = { model: "gpt-5-mini", reasoning: "minimal", maxTokens: 600, json: true };
export const writing = (maxTokens: number): ModelSpec => ({ model: "gpt-4.1-mini", temperature: 0.5, maxTokens });

/** The larger model a failed or malformed small-model answer falls back to. */
export const FALLBACK: ModelSpec = { model: "gpt-4o", temperature: 0.6, maxTokens: 1500 };

const isReasoningModel = (m: string) => /^(gpt-5|o\d)/.test(m);

/** The Chat Completions body for a spec: each model family takes different knobs. */
export function requestBody(spec: ModelSpec, messages: unknown[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  const body: Record<string, unknown> = { model: spec.model, messages, ...extra };
  if (isReasoningModel(spec.model)) {
    body.max_completion_tokens = spec.maxTokens;
    if (spec.reasoning) body.reasoning_effort = spec.reasoning;
  } else {
    body.max_tokens = spec.maxTokens;
    body.temperature = spec.temperature ?? 0.6;
  }
  if (spec.json) body.response_format = { type: "json_object" };
  return body;
}

/** Tokens from OpenAI's usage block. `cached` is part of `input`, billed at the cached rate. */
// deno-lint-ignore no-explicit-any
export function usageOf(data: any): { input: number; cached: number; output: number } {
  return {
    input: data?.usage?.prompt_tokens ?? 0,
    cached: data?.usage?.prompt_tokens_details?.cached_tokens ?? 0,
    output: data?.usage?.completion_tokens ?? 0,
  };
}

/** True when the text is one JSON object (fences tolerated). */
export function isJsonObject(text: string): boolean {
  try {
    const v = JSON.parse(String(text ?? "").trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
    return !!v && typeof v === "object" && !Array.isArray(v);
  } catch {
    return false;
  }
}
