import { supabase } from "@/lib/supabase";

/**
 * Instagram and WhatsApp, from the browser's side.
 *
 * ONE STATUS CALL FOR BOTH, because they share a Meta app, a business and
 * usually a token: asking twice would be two round trips for one answer, and
 * the two cards would be able to disagree about whether Meta is reachable.
 *
 * WHAT COMES BACK IS DELIBERATELY NAMES, NOT TICKS. "Configured" computed from
 * whether an environment variable is a non-empty string is a check that passes
 * with a typo in it. The Page name, the Instagram handle and the WhatsApp
 * display number come from Meta, so recognising your own account on the card is
 * proof the plumbing reaches the right business.
 */

export interface MetaStatus {
  ok: boolean;
  instagram: {
    configured: boolean;
    /** The Facebook Page the token belongs to. */
    page?: string | null;
    /** The Instagram Professional account linked to that Page. */
    username?: string | null;
    ig_id?: string | null;
    /** False means the Page has no IG account attached: the usual blocker. */
    linked?: boolean;
    error?: string;
  };
  whatsapp: {
    configured: boolean;
    number?: string | null;
    name?: string | null;
    quality?: string | null;
    /** Inbound is webhook-only, so these two decide whether anything arrives. */
    webhook_secret_set?: boolean;
    signature_check?: boolean;
    error?: string;
  };
  error?: string;
}

const EMPTY: MetaStatus = { ok: false, instagram: { configured: false }, whatsapp: { configured: false } };

async function reason(error: { message: string; context?: Response }): Promise<string> {
  const ctx = error.context;
  if (ctx && typeof ctx.text === "function") {
    try { return String(JSON.parse(await ctx.text())?.error ?? error.message); } catch { /* keep status */ }
  }
  return error.message;
}

export async function metaStatus(): Promise<MetaStatus> {
  if (!supabase) return { ...EMPTY, error: "no backend in demo mode" };
  const { data, error } = await supabase.functions.invoke("meta-status", { body: {} });
  if (error) return { ...EMPTY, error: await reason(error as { message: string; context?: Response }) };
  return data as MetaStatus;
}

/**
 * Pull recent Instagram DMs in.
 *
 * There is no WhatsApp equivalent and there cannot be: the Cloud API has no
 * endpoint for past messages, so WhatsApp arrives only through the webhook.
 * A syncWhatsApp() here would be a button that lies.
 */
export async function syncInstagram(): Promise<{
  ok: boolean; synced?: number; threads?: number; people?: string[]; detail?: string;
}> {
  if (!supabase) return { ok: false, detail: "no backend in demo mode" };
  const { data, error } = await supabase.functions.invoke("instagram-sync", { body: {} });
  if (error) return { ok: false, detail: await reason(error as { message: string; context?: Response }) };
  if (data?.error) return { ok: false, detail: String(data.error) };
  return { ok: true, synced: data.synced, threads: data.threads, people: data.people };
}
