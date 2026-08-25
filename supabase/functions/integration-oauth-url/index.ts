// Edge Function: integration-oauth-url   (Verify JWT: ON. Default)
//
// Starts a connection for the SIGNED-IN PERSON. One function, every provider.
//
// ── THE RULE THIS FUNCTION ENFORCES ──────────────────────────────────────
//
// The identity of a connection is (workspace, person, provider, third-party
// account). Three of those are decided here, while the caller still has a
// session, and carried through the round trip in the state row. The fourth
// comes back from the provider.
//
// None of them is ever read from the request body. A browser that could name
// its own user_id or workspace_id could file somebody else's Google account
// against itself, which is the whole attack this shape exists to prevent.
//
// ── WHAT THE CLIENT ID IS, SINCE IT IS ROUTINELY MISREAD ─────────────────
//
// GOOGLE_CLIENT_ID is MadeEA's identity with Google, registered once. It is not
// a per-person credential and it is not a limit: every member signs in through
// the same application and Google returns tokens for whichever account THEY
// authorised. John gets john@gmail.com; Sarah gets sarah@gmail.com; the rows
// differ by user_id.
//
// ── PKCE ─────────────────────────────────────────────────────────────────
//
// Sent to every provider that supports it. The verifier is stored encrypted
// with the same key as the tokens, because for the ten minutes it lives it is
// exactly as sensitive: whoever holds it and an intercepted code can complete
// somebody else's authorisation.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const APP_ORIGINS = (Deno.env.get("APP_ORIGINS") ?? "")
  .split(",").map((o) => o.trim()).filter(Boolean);

type Provider = "google" | "microsoft" | "slack" | "discord" | "meta" | "linkedin";

const TENANT = Deno.env.get("MICROSOFT_TENANT") ?? "common";

/**
 * Per-provider configuration, in one place rather than scattered through the
 * routes that use it.
 *
 * `pkce` is per provider because sending a code_challenge to something that
 * does not understand it is not always harmless: some providers echo it back as
 * an error rather than ignoring it.
 */
const PROVIDERS: Record<Provider, {
  authorize: string;
  scopes: string;
  scopeSeparator: string;
  /* Names this provider is CALLED in the dashboard people copy it from, in
     order of preference. Meta labels the same value "App ID" on its own screen
     and "client_id" in its API, and somebody following either is right; a
     product that accepts only one of them is just a spelling test. */
  clientIdEnv: string[];
  pkce: boolean;
  extra?: Record<string, string>;
}> = {
  google: {
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    /* One Google authorisation covering Gmail and Calendar, rather than asking
       the same person for the same account twice (spec §50). */
    scopes: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/calendar.readonly",
      "openid", "email", "profile",
    ].join(" "),
    scopeSeparator: " ",
    clientIdEnv: ["GOOGLE_CLIENT_ID"],
    pkce: true,
    // offline_access equivalent: without it there is no refresh token and the
    // connection dies in an hour.
    extra: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
  },
  microsoft: {
    authorize: `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize`,
    scopes: [
      "offline_access", "openid", "email", "profile",
      "https://graph.microsoft.com/Mail.ReadWrite",
      "https://graph.microsoft.com/Mail.Send",
      "https://graph.microsoft.com/Chat.Read",
      "https://graph.microsoft.com/ChatMessage.Send",
    ].join(" "),
    scopeSeparator: " ",
    clientIdEnv: ["MICROSOFT_CLIENT_ID", "MICROSOFT_APP_ID"],
    pkce: true,
    /* select_account, because the mailbox being connected is frequently not the
       account the browser is already signed into. */
    extra: { response_mode: "query", prompt: "select_account" },
  },
  slack: {
    authorize: "https://slack.com/oauth/v2/authorize",
    scopes: [
      "channels:read", "groups:read", "channels:history", "groups:history",
      "users:read", "chat:write", "chat:write.public",
    ].join(","),
    scopeSeparator: ",",
    clientIdEnv: ["SLACK_CLIENT_ID"],
    pkce: false,
  },
  discord: {
    authorize: "https://discord.com/oauth2/authorize",
    scopes: "bot applications.commands identify",
    scopeSeparator: " ",
    clientIdEnv: ["DISCORD_CLIENT_ID", "DISCORD_APP_ID"],
    pkce: false,
    // View Channels + Send Messages + Read Message History: what the sync uses.
    extra: { permissions: "68608" },
  },
  meta: {
    authorize: "https://www.facebook.com/v21.0/dialog/oauth",
    scopes: [
      "pages_show_list", "pages_manage_metadata", "pages_read_engagement", "pages_messaging",
      "instagram_basic", "instagram_manage_messages",
      "whatsapp_business_messaging", "whatsapp_business_management", "business_management",
    ].join(","),
    scopeSeparator: ",",
    clientIdEnv: ["META_CLIENT_ID", "META_APP_ID", "FACEBOOK_APP_ID"],
    pkce: false,
  },
  linkedin: {
    authorize: "https://www.linkedin.com/oauth/v2/authorization",
    scopes: "openid profile email r_organization_admin r_marketing_leadgen_automation",
    scopeSeparator: " ",
    clientIdEnv: ["LINKEDIN_CLIENT_ID"],
    pkce: false,
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

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** SHA-256, base64url. Used for both the state hash and the PKCE challenge. */
async function sha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return b64url(new Uint8Array(digest));
}

/**
 * AES-256-GCM, key from INTEGRATION_ENCRYPTION_KEY (base64, 32 bytes).
 *
 * Duplicated in integration-oauth-callback and in every function that spends a
 * token. Supabase Edge Functions here are deployed one file at a time, so a
 * shared module is not available: if this changes, it changes everywhere.
 */
async function encrypt(plain: string): Promise<string> {
  const raw = Deno.env.get("INTEGRATION_ENCRYPTION_KEY");
  if (!raw) throw new Error("INTEGRATION_ENCRYPTION_KEY is not configured");
  const key = await crypto.subtle.importKey(
    "raw", Uint8Array.from(atob(raw), (c) => c.charCodeAt(0)),
    { name: "AES-GCM" }, false, ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain)),
  );
  // iv || ciphertext(+tag), base64. The iv is not secret and must travel with it.
  const out = new Uint8Array(iv.length + cipher.length);
  out.set(iv);
  out.set(cipher, iv.length);
  return btoa(String.fromCharCode(...out));
}

Deno.serve(async (req) => {
  const CORS = corsFor(req);
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "Sign in first.", code: "AUTH_REQUIRED" }, 401);

    const user = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: u } = await user.auth.getUser();
    if (!u?.user) return json({ error: "Sign in first.", code: "AUTH_REQUIRED" }, 401);

    const body = await req.json().catch(() => ({}));
    const provider = String(body.provider ?? "") as Provider;
    const spec = PROVIDERS[provider];
    if (!spec) return json({ error: `Unknown provider: ${provider}`, code: "PROVIDER_NOT_SUPPORTED" }, 400);

    const admin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Is the provider switched on at all? LinkedIn's messaging is the case this
    // exists for: better a card that says so than a login that fails afterwards.
    const { data: reg } = await admin
      .from("integration_providers").select("enabled").eq("slug", provider).maybeSingle();
    if (reg && reg.enabled === false) {
      return json({ error: `${provider} is not available yet.`, code: "PROVIDER_NOT_SUPPORTED" }, 400);
    }

    /* The first of the accepted names that is actually set. */
    const clientId = spec.clientIdEnv.map((n) => Deno.env.get(n)).find(Boolean);
    if (!clientId) {
      return json({
        /* Names every accepted spelling, because "META_CLIENT_ID is not
           configured" sends somebody to look for a value Meta does not call
           that. */
        error: `Set ${spec.clientIdEnv.join(" or ")} in Supabase before connecting ${provider}.`,
        code: "PROVIDER_NOT_SUPPORTED",
      }, 400);
    }

    /* THE WORKSPACE COMES FROM MEMBERSHIP, NOT FROM THE BROWSER. This is the
       §36 rule: the server derives identity from the session. A workspace_id in
       the body would be a request to file a connection wherever the caller
       fancied. */
    const { data: member } = await admin
      .from("memberships").select("workspace_id, role").eq("user_id", u.user.id).limit(1).maybeSingle();
    if (!member?.workspace_id) {
      return json({ error: "You are not in a workspace yet.", code: "WORKSPACE_REQUIRED" }, 400);
    }

    // Never trust a redirect target from the request body either.
    const redirectTo = APP_ORIGINS.includes(String(body.origin ?? "")) ? String(body.origin) : APP_ORIGINS[0];
    if (!redirectTo) return json({ error: "APP_ORIGINS is not configured" }, 500);

    /* 32 random bytes. Stored as a hash, sent in the clear: a database read
       yields no usable state, the same reasoning as a password. */
    const state = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const stateHash = await sha256(state);

    let codeVerifier: string | null = null;
    let challenge: string | null = null;
    if (spec.pkce) {
      codeVerifier = b64url(crypto.getRandomValues(new Uint8Array(64)));
      challenge = await sha256(codeVerifier);
    }

    const { error } = await admin.from("oauth_states").insert({
      user_id: u.user.id,
      workspace_id: member.workspace_id,
      provider,
      state_hash: stateHash,
      code_verifier_encrypted: codeVerifier ? await encrypt(codeVerifier) : null,
      redirect_to: redirectTo,
      redirect_after: typeof body.redirect_after === "string" ? body.redirect_after : "/integrations",
      popup: body.popup !== false,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });
    if (error) return json({ error: error.message }, 500);

    await admin.from("integration_logs").insert({
      workspace_id: member.workspace_id,
      user_id: u.user.id,
      action: "oauth_started",
      status: "success",
      metadata: { provider },
    });

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: `${SUPABASE_URL}/functions/v1/integration-oauth-callback`,
      response_type: "code",
      scope: spec.scopes,
      state,
      ...(spec.extra ?? {}),
      ...(challenge ? { code_challenge: challenge, code_challenge_method: "S256" } : {}),
    });

    return json({ url: `${spec.authorize}?${params.toString()}` });
  } catch (e) {
    // The message may name a missing secret, which is safe and useful; it never
    // contains a token, because this function holds none at this point.
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
