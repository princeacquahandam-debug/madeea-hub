// Edge Function: meta-status   (Verify JWT: ON, the default. Auth is ALSO enforced in code,
// so this is safe either way; leaving verification on is simply stricter. Only
// the two endpoints an outsider calls directly need it off: the OAuth callback
// and whatsapp-webhook.)
//
// What is actually configured on the Meta side, asked of Meta rather than of a
// checklist. One call, two answers: Instagram and WhatsApp.
//
// WHY THIS EXISTS AS ITS OWN FUNCTION. Both Meta channels have a long, ordered
// list of things that must be true before a single message moves: a business,
// a Page, an Instagram Professional account linked to it, a system-user token
// with the right permissions, a phone number registered to the Cloud API. Any
// one of them missing produces the same symptom, which is nothing happening.
//
// The card could list all of that as prose and leave somebody to check each
// item by hand. Instead this asks Meta what it can see and reports it: the Page
// name, the Instagram username, the WhatsApp display number. Recognising your
// own account on screen is a much stronger signal that the plumbing is right
// than a green tick computed from whether an env var is a non-empty string.
//
// TOKENS NEVER LEAVE THE SERVER. Only names and ids come back, and only to a
// signed-in caller.
//
// ENV
//   META_PAGE_ID, META_PAGE_ACCESS_TOKEN        Instagram
//   WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_TOKEN    WhatsApp Cloud API

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

/* Pinned. Meta deprecates a Graph version roughly every two years and an
   unpinned call starts failing on their schedule rather than ours. Bumping this
   is a deliberate edit in three files (here, instagram-*, whatsapp-*). */
export const GRAPH = "https://graph.facebook.com/v21.0";

async function graph(path: string, token: string) {
  const r = await fetch(`${GRAPH}${path}${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`);
  const body = await r.json().catch(() => null);
  if (!r.ok) {
    /* Meta's error codes are worth keeping: 190 is an expired or revoked token,
       200 is a missing permission, and they are fixed in completely different
       places (regenerate vs. app review). */
    const e = body?.error;
    throw new Error(`${e?.message ?? r.status}${e?.code ? ` (code ${e.code})` : ""}`);
  }
  return body;
}


/**
 * The workspace's meta connection, or null.
 *
 * Read with the service role because access_token is revoked from the
 * `authenticated` role (0056): the browser can see THAT a channel is connected
 * and never the token behind it, which also means the caller's own client
 * cannot read it here. The workspace is resolved from the caller's membership,
 * so this can only ever return the connection of a workspace they are in.
 *
 * Falls back to the environment when there is no row. That fallback is what
 * lets a deployment that was configured the old way (a token pasted into
 * Supabase secrets) keep working until somebody presses Connect, rather than
 * every channel going dark the moment this ships.
 */
async function integration(admin: ReturnType<typeof createClient>, userId: string) {
  const { data: m } = await admin
    .from("memberships").select("workspace_id").eq("user_id", userId).limit(1).maybeSingle();
  if (!m?.workspace_id) return null;
  const { data } = await admin
    .from("workspace_integrations")
    .select("access_token, external_id, account_label, details")
    .eq("workspace_id", m.workspace_id)
    .eq("provider", "meta")
    .maybeSingle();
  return (data ?? null) as
    | { access_token: string | null; external_id: string | null; account_label: string | null; details: Record<string, string | null> }
    | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "unauthorized" }, 401);
    const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: u } = await supa.auth.getUser();
    if (!u?.user) return json({ error: "unauthorized" }, 401);

    /* The workspace's Facebook install first, the old environment secrets
       second. Both shapes hold the same four facts; only one of them was
       pasted through a chat window. */
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const conn = await integration(admin, u.user.id);

    const pageId = conn?.details?.page_id ?? Deno.env.get("META_PAGE_ID");
    const pageToken = conn?.access_token ?? Deno.env.get("META_PAGE_ACCESS_TOKEN");
    const waPhoneId = conn?.details?.whatsapp_phone_number_id ?? Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
    const waToken = conn?.access_token ?? Deno.env.get("WHATSAPP_TOKEN") ?? pageToken;

    const instagram: Record<string, unknown> = { configured: Boolean(pageId && pageToken) };
    if (pageId && pageToken) {
      try {
        /* instagram_business_account is the link between the Page and the IG
           Professional account. Its absence is the single commonest reason
           Instagram messaging does nothing, and it is invisible from the IG app
           itself, so it is worth reporting as its own state. */
        const page = await graph(`/${pageId}?fields=name,instagram_business_account{username,id}`, pageToken);
        instagram.page = page?.name ?? null;
        instagram.username = page?.instagram_business_account?.username ?? null;
        instagram.ig_id = page?.instagram_business_account?.id ?? null;
        instagram.linked = Boolean(page?.instagram_business_account?.id);
        if (!instagram.linked) {
          instagram.error = "This Page has no Instagram Professional account linked to it, so Instagram messages cannot be read or sent.";
        }
      } catch (e) {
        instagram.error = e instanceof Error ? e.message : String(e);
      }
    }

    const whatsapp: Record<string, unknown> = { configured: Boolean(waPhoneId && waToken) };
    if (waPhoneId && waToken) {
      try {
        const num = await graph(`/${waPhoneId}?fields=display_phone_number,verified_name,quality_rating`, waToken);
        whatsapp.number = num?.display_phone_number ?? null;
        whatsapp.name = num?.verified_name ?? null;
        whatsapp.quality = num?.quality_rating ?? null;
      } catch (e) {
        whatsapp.error = e instanceof Error ? e.message : String(e);
      }
    }
    /* Stated rather than implied. A WhatsApp integration with no webhook
       configured looks connected (the token works, the number resolves) and
       receives nothing for ever, because inbound has no other route. */
    whatsapp.webhook_secret_set = Boolean(Deno.env.get("META_VERIFY_TOKEN"));
    whatsapp.signature_check = Boolean(Deno.env.get("META_APP_SECRET"));

    return json({ ok: true, instagram, whatsapp });
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
