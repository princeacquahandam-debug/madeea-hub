// Edge Function: integration-oauth-url   (Verify JWT: ON. Default)
//
// Turns "press Connect" into "sign in with the account you own", for the four
// channels that used to be a token pasted into the Supabase dashboard.
//
// ONE FUNCTION FOR FOUR PROVIDERS, because the differences are a URL, a scope
// list and one query parameter each. What is NOT different is everything that
// has to be right: the redirect target must be validated against APP_ORIGINS
// rather than trusted from the browser, the state must be short-lived and
// single-use, and the workspace has to be decided HERE, while the caller still
// has a session, because the callback runs with none. Four copies of that is
// four chances to get one of them wrong.
//
// WHAT STILL LIVES IN SUPABASE SECRETS, and why it is not the thing that was
// wrong before. Each provider needs MadeEA's own app id and secret. That is the
// application's identity, registered once by whoever owns this deployment, and
// it is not the customer's credential. The change is that nobody pastes a Slack
// bot token or a Facebook Page token any more: they press Connect, sign in as
// themselves, and the token arrives over TLS carrying the name of what they
// just authorised.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const APP_ORIGINS = (Deno.env.get("APP_ORIGINS") ?? "")
  .split(",").map((o) => o.trim()).filter(Boolean);

type Provider = "slack" | "discord" | "meta" | "linkedin";

/**
 * What each provider needs, and the one thing worth knowing about each.
 *
 *   slack     bot scopes, not user scopes. The bot reads channels it is invited
 *             to; a user token would read everything the installer can see,
 *             which is far more than this app should ever hold.
 *   discord   `bot` plus `applications.commands`, with a permissions integer.
 *             1024+2048+65536 = View Channels, Send Messages, Read Message
 *             History: exactly what discord-sync and discord-send use.
 *   meta      one Facebook login covering the Page, the Instagram account
 *             attached to it and the WhatsApp number, because Meta issues them
 *             against the same token.
 *   linkedin  lead-gen only. LinkedIn's messaging API does not exist for us at
 *             any price, and this scope set does not pretend otherwise.
 */
const PROVIDERS: Record<Provider, {
  authorize: string;
  scopeParam: string;
  scopes: string;
  clientIdEnv: string;
  extra?: Record<string, string>;
}> = {
  slack: {
    authorize: "https://slack.com/oauth/v2/authorize",
    scopeParam: "scope",
    scopes: [
      "channels:read", "groups:read",
      "channels:history", "groups:history",
      "users:read", "chat:write", "chat:write.public",
    ].join(","),
    clientIdEnv: "SLACK_CLIENT_ID",
  },
  discord: {
    authorize: "https://discord.com/oauth2/authorize",
    scopeParam: "scope",
    scopes: "bot applications.commands",
    clientIdEnv: "DISCORD_CLIENT_ID",
    extra: { permissions: "68608" },
  },
  meta: {
    authorize: "https://www.facebook.com/v21.0/dialog/oauth",
    scopeParam: "scope",
    scopes: [
      "pages_show_list",
      "pages_manage_metadata",
      "pages_read_engagement",
      "pages_messaging",
      "instagram_basic",
      "instagram_manage_messages",
      "whatsapp_business_messaging",
      "whatsapp_business_management",
      "business_management",
    ].join(","),
    clientIdEnv: "META_APP_ID",
  },
  linkedin: {
    authorize: "https://www.linkedin.com/oauth/v2/authorization",
    scopeParam: "scope",
    scopes: "r_organization_admin rw_organization_admin r_marketing_leadgen_automation",
    clientIdEnv: "LINKEDIN_CLIENT_ID",
  },
};

function corsFor(req: Request) {
  const origin = req.headers.get("Origin") ?? "";
  return {
    "Access-Control-Allow-Origin": APP_ORIGINS.includes(origin) ? origin : (APP_ORIGINS[0] ?? "null"),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

Deno.serve(async (req) => {
  const CORS = corsFor(req);
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "unauthorized" }, 401);

    const user = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: u } = await user.auth.getUser();
    if (!u?.user) return json({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const provider = String(body.provider ?? "") as Provider;
    const spec = PROVIDERS[provider];
    if (!spec) return json({ error: `unknown provider: ${provider}` }, 400);

    const clientId = Deno.env.get(spec.clientIdEnv);
    /* Said here, in words naming the missing secret. An unconfigured app
       otherwise sends somebody to a provider login that fails with the
       provider's own error code and no hint that the fix is in Supabase. */
    if (!clientId) {
      return json({ error: `${spec.clientIdEnv} is not configured, so ${provider} cannot be connected yet.` }, 400);
    }

    // Never trust a redirect target from the request body.
    const redirectTo = APP_ORIGINS.includes(String(body.origin ?? "")) ? String(body.origin) : APP_ORIGINS[0];
    if (!redirectTo) return json({ error: "APP_ORIGINS is not configured" }, 500);

    const admin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    /* The workspace, resolved while there is still a session to resolve it
       from. The callback runs as the service role, where my_workspace() is
       null, and a shared channel filed into the wrong workspace is one agency
       reading another's messages. */
    const { data: member } = await admin
      .from("memberships").select("workspace_id").eq("user_id", u.user.id).limit(1).maybeSingle();
    if (!member?.workspace_id) return json({ error: "You are not in a workspace yet." }, 400);

    const { data: st, error } = await admin
      .from("oauth_states")
      .insert({
        user_id: u.user.id,
        workspace_id: member.workspace_id,
        redirect_to: redirectTo,
        provider,
        popup: body.popup !== false,
        /* Whose connection this will be, decided by the person pressing the
           button because only they know which account they are attaching. The
           callback cannot ask, so the answer travels with the state. */
        private: body.private === true,
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      })
      .select("state")
      .single();
    if (error) return json({ error: error.message }, 500);

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: `${SUPABASE_URL}/functions/v1/integration-oauth-callback`,
      response_type: "code",
      [spec.scopeParam]: spec.scopes,
      state: st.state,
      ...(spec.extra ?? {}),
    });

    return json({ url: `${spec.authorize}?${params.toString()}` });
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
