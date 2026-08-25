// Edge Function: integration-readiness   (Verify JWT: ON)
//
// Which providers can be connected at all, and what is missing from the ones
// that cannot.
//
// WHY THIS EXISTS. "Why can't I connect Slack?" was answerable only by pressing
// Connect and reading the refusal, one card at a time, and the answer was
// always the same shape: an app registered with that provider, and two secrets
// in Supabase. Six providers means six clicks to learn six facts that could
// have been one screen.
//
// WHAT IT RETURNS, AND WHAT IT CANNOT. Whether each secret is SET. Never its
// value, and never a claim that the value is correct: a client id with a typo
// in it is present and wrong, and only the provider can tell you that. So this
// answers "is anything missing", which is the question at setup time, and the
// consent screen answers "is it right", which is the question a second later.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const APP_ORIGINS = (Deno.env.get("APP_ORIGINS") ?? "")
  .split(",").map((o) => o.trim()).filter(Boolean);

function corsFor(req: Request) {
  const origin = req.headers.get("Origin") ?? "";
  return {
    "Access-Control-Allow-Origin": APP_ORIGINS.includes(origin) ? origin : (APP_ORIGINS[0] ?? "null"),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

/**
 * What each provider needs, in the words its own dashboard uses.
 *
 * `any` means the value is called different things in different places and we
 * accept whichever one somebody has: Meta prints "App ID" and its API says
 * client_id, and a product that insists on one spelling is a spelling test.
 */
const NEEDS: Record<string, { label: string; id: string[]; secret: string[]; where: string }> = {
  google: {
    label: "Google (Gmail, Calendar)",
    id: ["GOOGLE_CLIENT_ID"],
    secret: ["GOOGLE_CLIENT_SECRET"],
    where: "console.cloud.google.com → APIs & Services → Credentials",
  },
  microsoft: {
    label: "Microsoft (Outlook, Teams)",
    id: ["MICROSOFT_CLIENT_ID", "MICROSOFT_APP_ID"],
    secret: ["MICROSOFT_CLIENT_SECRET"],
    where: "portal.azure.com → App registrations",
  },
  slack: {
    label: "Slack",
    id: ["SLACK_CLIENT_ID"],
    secret: ["SLACK_CLIENT_SECRET"],
    where: "api.slack.com/apps → Basic Information",
  },
  discord: {
    label: "Discord",
    id: ["DISCORD_CLIENT_ID", "DISCORD_APP_ID"],
    secret: ["DISCORD_CLIENT_SECRET"],
    where: "discord.com/developers → OAuth2",
  },
  meta: {
    label: "Meta (Instagram, WhatsApp)",
    id: ["META_CLIENT_ID", "META_APP_ID", "FACEBOOK_APP_ID"],
    secret: ["META_CLIENT_SECRET", "META_APP_SECRET"],
    where: "developers.facebook.com → your app → Settings → Basic",
  },
  linkedin: {
    label: "LinkedIn",
    id: ["LINKEDIN_CLIENT_ID"],
    secret: ["LINKEDIN_CLIENT_SECRET"],
    where: "linkedin.com/developers → Auth",
  },
};

const firstSet = (names: string[]) => names.find((n) => (Deno.env.get(n) ?? "").trim().length > 0) ?? null;

Deno.serve(async (req) => {
  const CORS = corsFor(req);
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "Sign in first.", code: "AUTH_REQUIRED" }, 401);
    const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: u } = await supa.auth.getUser();
    if (!u?.user) return json({ error: "Sign in first.", code: "AUTH_REQUIRED" }, 401);

    const providers = Object.entries(NEEDS).map(([slug, need]) => {
      const idSet = firstSet(need.id);
      const secretSet = firstSet(need.secret);
      const missing: string[] = [];
      if (!idSet) missing.push(need.id.join(" or "));
      if (!secretSet) missing.push(need.secret.join(" or "));
      return {
        provider: slug,
        label: need.label,
        ready: missing.length === 0,
        missing,
        where: need.where,
      };
    });

    return json({
      ok: true,
      providers,
      /* The two that are not per-provider and break everything rather than one
         thing: no key means a connection refuses rather than storing a token in
         the clear, and no origins means every redirect is rejected. */
      encryption_key: Boolean(Deno.env.get("INTEGRATION_ENCRYPTION_KEY")),
      app_origins: APP_ORIGINS.length > 0,
      /* Registered once per provider, and the commonest thing to get wrong,
         so it is stated rather than left to be remembered. */
      redirect_uri: `${Deno.env.get("SUPABASE_URL")}/functions/v1/integration-oauth-callback`,
    });
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
