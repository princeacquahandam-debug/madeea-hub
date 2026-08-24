import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type { AdCampaign, AdLead, AdOffer, DmChannel, DmFollowUp, DmOpener, ThreadMsg } from "@/types/db";

/**
 * Client side of the Ads Setter. Mirrors lib/ai.ts: the browser hands facts to an
 * Edge Function and never holds a model key, and demo mode (no Supabase) returns
 * clearly-labelled placeholders so the flow is exercisable end-to-end.
 *
 * Persistence deliberately lives in the hooks, not here — this module only turns
 * an offer into words. Nothing it returns is saved until a caller decides to.
 */

interface CampaignDraft {
  name: string;
  objective: string;
  dailyBudget: string;
  targeting: AdCampaign["targeting"];
  creatives: AdCampaign["creatives"];
  qualifyingQuestions: string[];
}

export interface QualifyResult { score: number; reason: string; opener: string }
export interface ReplyResult { reply: string; readyToBook: boolean; shouldDisqualify: boolean; reasoning: string }

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase!.functions.invoke("ads-setter", { body });
  if (error) {
    // The function puts the real reason in the JSON body; supabase-js only
    // surfaces "non-2xx status" on the error itself, which tells a user nothing.
    let msg = error.message;
    try {
      const detail = await (error as { context?: { json?: () => Promise<{ error?: string }> } }).context?.json?.();
      if (detail?.error) msg = detail.error;
    } catch { /* keep the generic message */ }
    throw new Error(msg);
  }
  return data as T;
}

/** UTM string carrying the campaign id, so a lead traces back without manual tagging. */
export function utmFor(name: string, platform: string, id: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  return `?utm_source=${platform}&utm_medium=paid&utm_campaign=${slug}&utm_content=${id}`;
}

export async function draftCampaign(offer: AdOffer): Promise<CampaignDraft> {
  if (isSupabaseConfigured && supabase) {
    const { campaign } = await invoke<{ campaign: CampaignDraft }>({ action: "campaign", offer });
    return campaign;
  }
  await new Promise((r) => setTimeout(r, 700));
  return {
    name: `[DEMO] ${offer.name}`,
    objective: "Lead generation",
    dailyBudget: "—",
    targeting: { locations: [offer.geo || "—"], ageRange: "—", interests: [], keywords: [], exclusions: [] },
    creatives: [{
      angle: "demo",
      headline: "Connect Supabase to generate",
      primaryText: "Set OPENAI_API_KEY and deploy the ads-setter function to write real campaigns.",
      description: "This is placeholder copy.",
      cta: "Learn more",
    }],
    qualifyingQuestions: ["(demo) What's your budget?", "(demo) Who else decides?"],
  };
}

interface PlaybookDraft {
  name: string;
  objective: string;
  openers: DmOpener[];
  followUps: DmFollowUp[];
  qualifyingQuestions: string[];
}

export async function draftPlaybook(offer: AdOffer, channel: DmChannel): Promise<PlaybookDraft> {
  if (isSupabaseConfigured && supabase) {
    const { playbook } = await invoke<{ playbook: PlaybookDraft }>({ action: "playbook", offer, channel });
    return playbook;
  }
  await new Promise((r) => setTimeout(r, 700));
  return {
    name: `[DEMO] ${offer.name}`,
    objective: "Book calls from cold DMs",
    openers: [{ angle: "demo", message: "[DEMO] Connect Supabase to write real openers, {{first_name}}." }],
    followUps: [{ waitDays: 3, message: "[DEMO] follow-up" }],
    qualifyingQuestions: ["(demo) What's your budget?"],
  };
}

/** Personalises one opener for one prospect. Never invents a detail — see the function's prompt. */
export async function personaliseOpener(
  offer: AdOffer, opener: DmOpener, prospect: AdLead, channel: DmChannel,
): Promise<{ message: string; usedDetail: string }> {
  if (isSupabaseConfigured && supabase) {
    const { result } = await invoke<{ result: { message: string; usedDetail: string } }>({
      action: "dm_open", offer, opener, channel,
      prospect: { name: prospect.name, handle: prospect.handle, note: prospect.note },
    });
    return result;
  }
  await new Promise((r) => setTimeout(r, 400));
  return { message: `[DEMO] Hi ${prospect.name.split(" ")[0]} — connect Supabase to personalise this.`, usedDetail: "none" };
}

/** Parse pasted DM prospects: "handle, name, note" or a header row. */
export function prospectsFromCsv(csv: string): { name: string; handle: string; note: string }[] {
  const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];

  const split = (l: string) => l.split(/,|\t/).map((c) => c.trim().replace(/^["']|["']$/g, ""));
  const first = split(lines[0]).map((c) => c.toLowerCase());
  const hasHeader = first.some((c) => ["handle", "username", "name", "note", "profile"].includes(c));
  const col = (n: string) => first.indexOf(n);
  const idx = hasHeader
    ? { handle: Math.max(col("handle"), col("username")), name: col("name"), note: Math.max(col("note"), col("profile")) }
    : { handle: 0, name: 1, note: 2 };

  const out: { name: string; handle: string; note: string }[] = [];
  for (const line of lines.slice(hasHeader ? 1 : 0)) {
    const c = split(line);
    const at = (i: number) => (i >= 0 && i < c.length ? c[i] : "");
    const handle = at(idx.handle).replace(/^@/, "");
    const name = at(idx.name);
    if (!handle && !name) continue;
    out.push({ name: name || handle, handle, note: at(idx.note) });
  }
  return out;
}

export async function qualify(offer: AdOffer, lead: AdLead, questions: string[]): Promise<QualifyResult> {
  if (isSupabaseConfigured && supabase) {
    const { result } = await invoke<{ result: QualifyResult }>({
      action: "qualify", offer, questions,
      lead: { name: lead.name, email: lead.email, phone: lead.phone, note: lead.note },
    });
    return result;
  }
  await new Promise((r) => setTimeout(r, 500));
  return { score: 50, reason: "[DEMO] Connect Supabase to score leads.", opener: `[DEMO] Hi ${lead.name} — what made you click?` };
}

export async function nextReply(
  offer: AdOffer, thread: ThreadMsg[], message: string, questions: string[],
): Promise<ReplyResult> {
  if (isSupabaseConfigured && supabase) {
    const { result } = await invoke<{ result: ReplyResult }>({ action: "reply", offer, thread, message, questions });
    return result;
  }
  await new Promise((r) => setTimeout(r, 500));
  return { reply: "[DEMO] Connect Supabase to draft replies.", readyToBook: false, shouldDisqualify: false, reasoning: "demo" };
}

/**
 * Parse pasted rows into leads. Accepts a header row (name/email/phone/note in any
 * order) or bare "name, email, phone" lines. Duplicates are settled by the
 * database's dedupe key, not here — this only reads what was pasted.
 */
export function leadsFromCsv(csv: string): { name: string; email: string; phone: string; note: string }[] {
  const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];

  const split = (l: string) => l.split(/,|\t/).map((c) => c.trim().replace(/^["']|["']$/g, ""));
  const first = split(lines[0]).map((c) => c.toLowerCase());
  const hasHeader = first.some((c) => ["name", "email", "phone", "note", "message"].includes(c));
  const col = (n: string) => first.indexOf(n);
  const idx = hasHeader
    ? { name: col("name"), email: col("email"), phone: col("phone"), note: Math.max(col("note"), col("message")) }
    : { name: 0, email: 1, phone: 2, note: 3 };

  const out: { name: string; email: string; phone: string; note: string }[] = [];
  for (const line of lines.slice(hasHeader ? 1 : 0)) {
    const c = split(line);
    const at = (i: number) => (i >= 0 && i < c.length ? c[i] : "");
    const name = at(idx.name), email = at(idx.email), phone = at(idx.phone);
    if (!name && !email && !phone) continue;
    out.push({ name: name || email || phone, email, phone, note: at(idx.note) });
  }
  return out;
}
