// Edge Function: ads-setter   (Verify JWT: ON)
//
// The writing half of the Ads Setter. Three actions, all returning JSON:
//   { action: "campaign", offer }              -> ad angles, copy, targeting, qualifying questions
//   { action: "qualify",  offer, lead }        -> { score, reason, opener }
//   { action: "reply",    offer, thread, message } -> { reply, readyToBook, shouldDisqualify, reasoning }
//
// It never touches the database. The browser owns persistence through RLS, which
// keeps this function stateless and means a bad generation can't corrupt a row —
// the caller decides what, if anything, to save.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const MODEL = "gpt-4o-mini";   // a setter makes a call per reply; a heavy default gets expensive fast
const MAX_INPUT_CHARS = 8000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

async function complete(system: string, user: string, maxTokens: number, temperature: number): Promise<string> {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      response_format: { type: "json_object" },
      temperature,
      max_tokens: maxTokens,
    }),
  });
  if (!res.ok) {
    console.error("openai failed", res.status, await res.text());
    throw new Error("The writing model is unavailable right now.");
  }
  const j = await res.json();
  return String(j?.choices?.[0]?.message?.content ?? "");
}

function parseJson<T>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("The model returned something unreadable — try again.");
  }
}

// ── prompts ──────────────────────────────────────────────────────────────────

const CAMPAIGN_SYSTEM = `You are a direct-response media buyer. You write campaigns that attract the RIGHT
people and repel the wrong ones — a cheap lead who can never buy is a loss, not a win.

Return ONLY JSON:
{
  "name": string, "objective": string, "dailyBudget": string,
  "targeting": { "locations": string[], "ageRange": string, "interests": string[], "keywords": string[], "exclusions": string[] },
  "creatives": [{ "angle": string, "headline": string, "primaryText": string, "description": string, "cta": string }],
  "qualifyingQuestions": string[]
}

Rules:
- Exactly 5 creatives, each a genuinely DIFFERENT angle (pain-led, proof-led, contrarian,
  outcome-led, objection-led). Five rewordings of one idea is a failure.
- Headlines under 40 characters, descriptions under 90, primary text 2-4 short lines.
- Write for the named platform: Google needs keywords, Meta needs interests.
- "exclusions": who NOT to show it to, so budget stops leaking.
- qualifyingQuestions: 3-5 things the setter must learn before booking. Make them
  disqualifying, not chatty — they decide who gets a slot.
- No emojis unless the tone asks. Never invent statistics, guarantees or case studies.`;

const QUALIFY_SYSTEM = `You qualify inbound leads that came from a paid ad, for an appointment setter.

Return ONLY JSON: { "score": number, "reason": string, "opener": string }
- score 0-100 for fit against the stated audience. Be harsh: someone who clearly cannot
  buy scores under 30 no matter how enthusiastic they are.
- reason: one sentence for the human reading the queue. Say what decided it.
- opener: the first message to send. They clicked an ad, so reference what it promised.
  Ask exactly ONE question — the most disqualifying one. Under 45 words. No pitch,
  no links, no calendar link yet, no emojis. Sound like a busy helpful person, not a script.`;

const REPLY_SYSTEM = `You are an appointment setter continuing a conversation with a lead from a paid ad.
Your only goal is to book the right people and politely release the wrong ones.

Return ONLY JSON: { "reply": string, "readyToBook": boolean, "shouldDisqualify": boolean, "reasoning": string }
- reply: under 50 words, one question at a time, no emojis. Never invent prices,
  availability, guarantees or case studies you were not given.
- readyToBook: true only once every qualifying question is genuinely answered. When true,
  the reply asks for a time instead of qualifying further.
- shouldDisqualify: true when they cannot or should not buy (no budget, wrong role, wrong
  geography, hostile). The reply then closes the loop politely, with no pitch.
- reasoning: one sentence for the human, never shown to the lead.

Answer an objection plainly once, then return to your question. Never argue, never stack
pitches, never send a wall of text.`;

const PLAYBOOK_SYSTEM = `You write cold DM outreach playbooks for an appointment setter working social channels.

Return ONLY JSON:
{
  "name": string, "objective": string,
  "openers": [{ "angle": string, "message": string }],
  "followUps": [{ "waitDays": number, "message": string }],
  "qualifyingQuestions": string[]
}

Rules:
- Exactly 5 openers, each a genuinely DIFFERENT angle (specific-compliment, observed-problem,
  mutual-context, useful-gift, direct-ask). Five rewordings of one idea is a failure.
- An opener is UNDER 35 WORDS, asks nothing bigger than a yes/no, and pitches nothing.
  Anyone can tell a mass-blast from a real message: no "Hope you're well!", no fake
  familiarity, no compliment that would fit any account.
- Use {{first_name}} and {{detail}} as placeholders where personalisation belongs.
  {{detail}} is the one specific thing the setter observed about that prospect.
- Exactly 3 followUps, increasingly brief, the last one a clean break-up. waitDays 2-5.
- No links in the opener — most platforms suppress reach on first-touch links.
- Never invent statistics, results or shared connections.`;

const DM_OPEN_SYSTEM = `You personalise one cold DM opener for one specific prospect.

Return ONLY JSON: { "message": string, "usedDetail": string }
- Fill the chosen opener's placeholders using ONLY facts given about the prospect.
- If there is no real detail to use, rewrite the line so it needs none. NEVER invent a
  detail, a mutual connection, or something you "saw" — a fabricated compliment is worse
  than a generic one, because it is checkable.
- Under 35 words. No links. No pitch. One easy question.
- usedDetail: the specific thing you leaned on, or "none" if you had nothing.`;

const offerBlock = (o: Record<string, unknown>) =>
  [
    `Offer: ${o.name ?? ""}`,
    `Audience: ${o.audience ?? ""}`,
    `Problem: ${o.problem ?? ""}`,
    `Outcome: ${o.outcome ?? ""}`,
    `Price: ${o.price ?? ""}`,
    `Geography: ${o.geo ?? ""}`,
    `Platform: ${o.platform ?? "meta"}`,
    `Tone: ${o.tone || "direct, confident, no hype"}`,
    o.notes ? `Notes: ${o.notes}` : "",
  ].filter(Boolean).join("\n");

// ── entrypoint ───────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "unauthorized" }, 401);

    const authClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: u } = await authClient.auth.getUser();
    if (!u?.user) return json({ error: "unauthorized" }, 401);

    // Fails CLOSED, same as `generate`: anything other than an explicit true —
    // an RPC error, a null, a missing migration — blocks rather than allows.
    const { data: allowed, error: rlErr } = await authClient.rpc("check_ai_rate_limit", { p_fn: "ads-setter", p_max: 60 });
    if (rlErr) console.error("check_ai_rate_limit failed", rlErr.message);
    if (allowed !== true) return json({ error: "Rate limit reached — please try again in a little while." }, 429);

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "");
    const offer = (body?.offer ?? {}) as Record<string, unknown>;

    if (action === "campaign") {
      if (!offer.name || !offer.audience) return json({ error: "Describe the offer and who it's for." }, 400);
      const out = await complete(CAMPAIGN_SYSTEM, offerBlock(offer).slice(0, MAX_INPUT_CHARS), 2200, 0.75);
      const campaign = parseJson<{ creatives?: unknown[] }>(out);
      if (!Array.isArray(campaign.creatives) || !campaign.creatives.length) {
        return json({ error: "No usable campaign came back — try a more specific offer." }, 502);
      }
      return json({ campaign });
    }

    if (action === "playbook") {
      if (!offer.name || !offer.audience) return json({ error: "Describe the offer and who it's for." }, 400);
      const channel = String(body?.channel ?? "instagram");
      const user = `${offerBlock(offer)}\nChannel: ${channel}`.slice(0, MAX_INPUT_CHARS);
      const out = await complete(PLAYBOOK_SYSTEM, user, 2000, 0.75);
      const playbook = parseJson<{ openers?: unknown[] }>(out);
      if (!Array.isArray(playbook.openers) || !playbook.openers.length) {
        return json({ error: "No usable playbook came back — try a more specific offer." }, 502);
      }
      return json({ playbook });
    }

    if (action === "dm_open") {
      const prospect = (body?.prospect ?? {}) as Record<string, unknown>;
      const opener = (body?.opener ?? {}) as Record<string, unknown>;
      if (!opener.message) return json({ error: "Pick an opener angle first." }, 400);
      const user = [
        offerBlock(offer),
        `Channel: ${body?.channel ?? "instagram"}`,
        "",
        `Opener template (angle: ${opener.angle ?? ""}): ${opener.message}`,
        "",
        `Prospect name: ${prospect.name ?? ""}`,
        `Handle: ${prospect.handle ?? ""}`,
        `What we know about them: ${prospect.note || "(nothing)"}`,
      ].filter(Boolean).join("\n").slice(0, MAX_INPUT_CHARS);
      return json({ result: parseJson(await complete(DM_OPEN_SYSTEM, user, 400, 0.6)) });
    }

    if (action === "qualify") {
      const lead = (body?.lead ?? {}) as Record<string, unknown>;
      const questions = Array.isArray(body?.questions) ? (body.questions as string[]).join("; ") : "";
      const user = [
        offerBlock(offer),
        questions ? `Must learn before booking: ${questions}` : "",
        "",
        `Lead name: ${lead.name ?? ""}`,
        `Email: ${lead.email ?? ""}`,
        `Phone: ${lead.phone ?? ""}`,
        `What they submitted: ${lead.note || "(nothing)"}`,
      ].filter(Boolean).join("\n").slice(0, MAX_INPUT_CHARS);
      return json({ result: parseJson(await complete(QUALIFY_SYSTEM, user, 500, 0.5)) });
    }

    if (action === "reply") {
      const message = String(body?.message ?? "").trim();
      if (!message) return json({ error: "Paste what the lead said." }, 400);
      const thread = Array.isArray(body?.thread) ? body.thread as { role: string; text: string }[] : [];
      const questions = Array.isArray(body?.questions) ? (body.questions as string[]).join("; ") : "";

      const transcript = [...thread, { role: "lead", text: message }]
        .map((m) => `${m.role === "lead" ? "Lead" : "You"}: ${m.text}`)
        .join("\n");

      const user = [
        offerBlock(offer),
        questions ? `Still must learn: ${questions}` : "",
        "",
        "Conversation so far:",
        transcript,
      ].filter(Boolean).join("\n").slice(0, MAX_INPUT_CHARS);
      return json({ result: parseJson(await complete(REPLY_SYSTEM, user, 500, 0.6)) });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unexpected error." }, 500);
  }
});
