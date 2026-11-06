import { generate, type GenerateTool } from "@/lib/ai";
import { isSupabaseConfigured } from "@/lib/supabase";
import { track } from "@/lib/analytics";

/**
 * One ✦ quick action call (Abder's "AI quick actions and cost" deck, 6 Nov
 * 2026). The page works out the facts and every number in code, sends them as
 * `inputs`, and gets back the action's fixed JSON shape (the prompts are in
 * supabase/functions/generate/quickActions.ts).
 *
 * The answer is checked before anything is shown: `check` must accept it, or
 * the call throws and the page shows its error state. In demo mode (no
 * Supabase) `demo` builds the answer from the same facts, so every button can
 * be tried without the live AI.
 */
export interface QuickResult<T> { data: T; ai: boolean; ms: number }

export async function runQuickAction<T>(opts: {
  tool: GenerateTool;
  format: string;
  inputs: Record<string, string>;
  /** Narrow the parsed JSON to T, or throw. */
  check: (v: unknown) => T;
  /** The answer in demo mode, from the same facts. */
  demo: () => T;
  /** For PostHog: the page it ran on. */
  page: string;
}): Promise<QuickResult<T>> {
  const t0 = performance.now();
  /* Same action, same facts, within 15 minutes: reuse the answer rather than
     pay for it again (deck slide 14, "reuse a result for 15 min if nothing
     changed"). Any change in the data changes the inputs, and so the key. */
  const key = `${opts.tool}\u0000${JSON.stringify(opts.inputs)}`;
  const hit = recent.get(key);
  if (hit && Date.now() - hit.at < REUSE_MS) {
    track("ai_result_shown", { action: opts.tool, page: opts.page, latency_ms: 0, used_ai: hit.ai, reused: true });
    return { data: hit.data as T, ai: hit.ai, ms: 0 };
  }
  let data: T;
  let ai = false;
  if (!isSupabaseConfigured) {
    await new Promise((r) => setTimeout(r, 450));
    data = opts.demo();
  } else {
    const out = await generate({ tool: opts.tool, format: opts.format, inputs: opts.inputs });
    data = opts.check(parseJson(out));
    ai = true;
  }
  const ms = Math.round(performance.now() - t0);
  if (ai) recent.set(key, { at: Date.now(), data, ai });
  track("ai_result_shown", { action: opts.tool, page: opts.page, latency_ms: ms, used_ai: ai });
  return { data, ai, ms };
}

const REUSE_MS = 15 * 60_000;
const recent = new Map<string, { at: number; data: unknown; ai: boolean }>();

export function parseJson(out: string): unknown {
  const raw = String(out ?? "").trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Madeline's answer couldn't be read. Try again.");
  }
}

/* ── Small checkers for the JSON shapes ── */
type Obj = Record<string, unknown>;
export const obj = (v: unknown): Obj => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("Madeline's answer couldn't be read. Try again.");
  return v as Obj;
};
export const str = (v: unknown, max = 400): string => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const strs = (v: unknown, max = 200): string[] => arr(v).map((x) => str(x, max)).filter(Boolean);

/** Line-per-item input, trimmed so one long email can't blow the request size. */
export const lines = (items: string[], maxChars = 9000): string => {
  let out = "";
  for (const l of items) {
    if (out.length + l.length + 1 > maxChars) break;
    out += "\n" + l;
  }
  return out;
};

/** "just now" / "3 min ago". */
export function ago(at: Date): string {
  const m = Math.round((Date.now() - at.getTime()) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}
