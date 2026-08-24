// Edge Function: integration-oauth-callback   (Verify JWT: OFF. Providers redirect here with no session.)
//
// Finishes a connection and files it against the person who started it.
//
// ── WHERE IDENTITY COMES FROM ────────────────────────────────────────────
//
// The state row, and nothing else. This endpoint cannot authenticate anybody:
// the provider sends a browser here with no bearer token. So it looks the state
// up BY HASH, reads the user and workspace recorded when the flow started
// (while the caller was authenticated), and ignores everything else the request
// claims.
//
// A callback that accepted ?user_id= would let anyone file anyone's Google
// account against their own row. Only `code` and `state` are read here, and
// `state` only as a lookup key.
//
// ── WHAT IS WRITTEN ──────────────────────────────────────────────────────
//
// One row in `integrations`, keyed (workspace, user, provider, account).
// Tokens are AES-256-GCM ciphertext before they touch the database. The
// account's own id, name and address are stored beside them, so a card can say
// WHICH account is connected — something a token cannot tell you.
//
// ── AND THE OLD TABLES ───────────────────────────────────────────────────
//
// Google and Microsoft connections are ALSO written to google_credentials and
// microsoft_credentials in the shape those already have. Ten Edge Functions
// still read them, and dual-writing keeps every one working while they move
// over, rather than a flag day where mail sync breaks because a migration
// landed first. Both were already keyed on owner_id, so this duplicates the
// storage without weakening the model.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const APP_ORIGINS = (Deno.env.get("APP_ORIGINS") ?? "")
  .split(",").map((o) => o.trim()).filter(Boolean);
const GRAPH = "https://graph.facebook.com/v21.0";
const TENANT = Deno.env.get("MICROSOFT_TENANT") ?? "common";

type Provider = "google" | "microsoft" | "slack" | "discord" | "meta" | "linkedin";

interface TokenResult {
  access_token: string | null;
  refresh_token?: string | null;
  expires_in?: number | null;
  scopes?: string | null;
  account_id: string;
  account_name?: string | null;
  account_email?: string | null;
  metadata?: Record<string, unknown>;
}

// ── crypto ───────────────────────────────────────────────────────────────
const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function sha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return b64url(new Uint8Array(digest));
}

async function aesKey(usage: KeyUsage[]) {
  const raw = Deno.env.get("INTEGRATION_ENCRYPTION_KEY");
  if (!raw) throw new Error("INTEGRATION_ENCRYPTION_KEY is not configured");
  return await crypto.subtle.importKey(
    "raw", Uint8Array.from(atob(raw), (c) => c.charCodeAt(0)),
    { name: "AES-GCM" }, false, usage,
  );
}

/** AES-256-GCM. Output is base64(iv || ciphertext || tag). */
async function encrypt(plain: string): Promise<string> {
  const key = await aesKey(["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain)),
  );
  const out = new Uint8Array(iv.length + cipher.length);
  out.set(iv);
  out.set(cipher, iv.length);
  return btoa(String.fromCharCode(...out));
}

async function decrypt(payload: string): Promise<string> {
  const key = await aesKey(["decrypt"]);
  const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytes.slice(0, 12) }, key, bytes.slice(12),
  );
  return new TextDecoder().decode(plain);
}

// ── what comes back to the browser ───────────────────────────────────────
function popupPage(origin: string, payload: Record<string, unknown>) {
  const body = JSON.stringify({ source: "madeea-oauth", ...payload });
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Connecting</title>
<body style="font:14px system-ui;background:#0b0f17;color:#e5e7eb;display:grid;place-items:center;height:100vh;margin:0">
<p>${payload.ok ? "Connected. You can close this window." : "That did not complete. You can close this window."}</p>
<script>
  try { window.opener && window.opener.postMessage(${body}, ${JSON.stringify(origin)}); } catch (e) {}
  setTimeout(function () { try { window.close(); } catch (e) {} }, 300);
</script>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

function finish(
  st: { redirect_to?: string | null; popup?: boolean; redirect_after?: string | null },
  payload: Record<string, unknown>,
) {
  const dest = APP_ORIGINS.includes(st.redirect_to ?? "") ? st.redirect_to! : APP_ORIGINS[0];
  if (!dest) return new Response("APP_ORIGINS is not configured", { status: 500 });
  if (st.popup) return popupPage(dest, payload);
  /* A code, never a provider error string: the page can phrase a code for a
     human, and invalid_grant in an address bar helps nobody. */
  const page = st.redirect_after || "/integrations";
  const q = payload.ok ? `connected=${payload.provider}` : `error=${payload.code ?? "oauth_failed"}`;
  return new Response(null, { status: 302, headers: { Location: `${dest}${page}?${q}` } });
}

// ── providers ────────────────────────────────────────────────────────────
//
// One function each, all returning the same shape. Provider quirks stay inside
// their own function rather than leaking into the flow below.

async function exchangeGoogle(code: string, redirectUri: string, verifier: string | null): Promise<TokenResult> {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: Deno.env.get("GOOGLE_CLIENT_ID") ?? "",
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "",
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      ...(verifier ? { code_verifier: verifier } : {}),
    }),
  });
  const d = await r.json();
  if (!r.ok || !d.access_token) throw new Error(`google: ${d.error_description ?? d.error ?? "token exchange failed"}`);

  /* Identity from the id_token, which came from Google's token endpoint over
     TLS authenticated with our secret. `sub` is the stable account id: an
     address can change, the sub cannot. */
  let sub: string | null = null;
  let email: string | null = null;
  let name: string | null = null;
  try {
    const part = String(d.id_token ?? "").split(".")[1] ?? "";
    const pad = part.replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(pad + "=".repeat((4 - (pad.length % 4)) % 4)));
    sub = claims.sub ?? null;
    email = claims.email_verified === true ? (claims.email ?? null) : null;
    name = claims.name ?? null;
  } catch { /* fall through to userinfo */ }

  if (!sub || !email) {
    const me = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${d.access_token}` },
    }).then((x) => x.json()).catch(() => ({}));
    sub = sub ?? me?.sub ?? null;
    email = email ?? me?.email ?? null;
    name = name ?? me?.name ?? null;
  }
  if (!sub) throw new Error("google: could not identify the account");

  return {
    access_token: d.access_token,
    refresh_token: d.refresh_token ?? null,
    expires_in: d.expires_in ?? null,
    scopes: d.scope ?? null,
    account_id: sub,
    account_email: email ? String(email).toLowerCase() : null,
    account_name: name,
  };
}

async function exchangeMicrosoft(code: string, redirectUri: string, verifier: string | null): Promise<TokenResult> {
  const r = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: Deno.env.get("MICROSOFT_CLIENT_ID") ?? "",
      client_secret: Deno.env.get("MICROSOFT_CLIENT_SECRET") ?? "",
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      ...(verifier ? { code_verifier: verifier } : {}),
    }),
  });
  const d = await r.json();
  if (!r.ok || !d.access_token) throw new Error(`microsoft: ${d.error_description ?? d.error ?? "token exchange failed"}`);
  if (!d.refresh_token) throw new Error("microsoft: no refresh token; offline_access was not granted");

  const me = await fetch("https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName,displayName", {
    headers: { Authorization: `Bearer ${d.access_token}` },
  }).then((x) => x.json()).catch(() => ({}));
  if (!me?.id) throw new Error("microsoft: could not identify the account");

  const email = me?.mail ?? me?.userPrincipalName ?? null;
  return {
    access_token: d.access_token,
    refresh_token: d.refresh_token,
    expires_in: d.expires_in ?? null,
    scopes: d.scope ?? null,
    account_id: me.id,
    account_email: email ? String(email).toLowerCase() : null,
    account_name: me?.displayName ?? null,
  };
}

async function exchangeSlack(code: string, redirectUri: string): Promise<TokenResult> {
  const r = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("SLACK_CLIENT_ID") ?? "",
      client_secret: Deno.env.get("SLACK_CLIENT_SECRET") ?? "",
      code,
      redirect_uri: redirectUri,
    }),
  });
  const d = await r.json();
  if (!d.ok) throw new Error(`slack: ${d.error ?? "install failed"}`);
  /* The TEAM is the account: a Slack bot token reads the workspace it was
     installed into. Two people installing the same workspace get a row each,
     which is right — each holds their own token, and one revoking leaves the
     other working. */
  return {
    access_token: d.access_token,
    scopes: d.scope ?? null,
    account_id: d.team?.id ?? "slack",
    account_name: d.team?.name ?? "Slack workspace",
    metadata: { bot_user_id: d.bot_user_id ?? null, authed_user: d.authed_user?.id ?? null },
  };
}

async function exchangeDiscord(code: string, redirectUri: string): Promise<TokenResult> {
  const r = await fetch("https://discord.com/api/v10/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("DISCORD_CLIENT_ID") ?? "",
      client_secret: Deno.env.get("DISCORD_CLIENT_SECRET") ?? "",
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });
  const d = await r.json();
  if (!d.access_token) throw new Error(`discord: ${d.error_description ?? d.error ?? "install failed"}`);
  /* The bot reads with the application's own token, so what matters here is
     which server it landed in. The user token is stored (encrypted) because it
     identifies the installer; nothing spends it. */
  return {
    access_token: d.access_token,
    refresh_token: d.refresh_token ?? null,
    expires_in: d.expires_in ?? null,
    scopes: d.scope ?? null,
    account_id: d.guild?.id ?? "discord",
    account_name: d.guild?.name ?? "Discord server",
    metadata: { guild_id: d.guild?.id ?? null },
  };
}

async function exchangeMeta(code: string, redirectUri: string): Promise<TokenResult> {
  const appId = Deno.env.get("META_CLIENT_ID") ?? "";
  const appSecret = Deno.env.get("META_CLIENT_SECRET") ?? Deno.env.get("META_APP_SECRET") ?? "";

  const tok = await fetch(
    `${GRAPH}/oauth/access_token?${new URLSearchParams({
      client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code,
    })}`,
  ).then((r) => r.json());
  if (!tok.access_token) throw new Error(`meta: ${tok.error?.message ?? "token exchange failed"}`);

  // Straight to a long-lived token: a connection that dies in an hour is not one.
  const long = await fetch(
    `${GRAPH}/oauth/access_token?${new URLSearchParams({
      grant_type: "fb_exchange_token", client_id: appId, client_secret: appSecret,
      fb_exchange_token: tok.access_token,
    })}`,
  ).then((r) => r.json());
  const userToken = long.access_token ?? tok.access_token;

  const pages = await fetch(
    `${GRAPH}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&access_token=${encodeURIComponent(userToken)}`,
  ).then((r) => r.json());
  const page = pages?.data?.[0] ?? null;

  /* WhatsApp hangs off the business, not the Page: a separate lookup and a
     separate failure, wrapped so a business without WhatsApp still connects
     Instagram. */
  let waba: { phone_number_id?: string; number?: string } = {};
  try {
    const biz = await fetch(`${GRAPH}/me/businesses?fields=id&access_token=${encodeURIComponent(userToken)}`)
      .then((r) => r.json());
    const bizId = biz?.data?.[0]?.id;
    if (bizId) {
      const accounts = await fetch(
        `${GRAPH}/${bizId}/owned_whatsapp_business_accounts?access_token=${encodeURIComponent(userToken)}`,
      ).then((r) => r.json());
      const wabaId = accounts?.data?.[0]?.id;
      if (wabaId) {
        const numbers = await fetch(
          `${GRAPH}/${wabaId}/phone_numbers?access_token=${encodeURIComponent(userToken)}`,
        ).then((r) => r.json());
        const n = numbers?.data?.[0];
        if (n) waba = { phone_number_id: n.id, number: n.display_phone_number };
      }
    }
  } catch (e) {
    console.error("whatsapp lookup failed", e instanceof Error ? e.message : e);
  }

  const me = await fetch(`${GRAPH}/me?fields=id,name&access_token=${encodeURIComponent(userToken)}`)
    .then((r) => r.json()).catch(() => ({}));

  return {
    // The PAGE token is what the messaging endpoints accept.
    access_token: page?.access_token ?? userToken,
    scopes: null,
    /* The Facebook USER is the account, not the Page: two EAs may manage the
       same Page and each needs their own row, which a Page id would collide. */
    account_id: me?.id ?? page?.id ?? "meta",
    account_name: me?.name ?? page?.name ?? "Meta business",
    metadata: {
      page_id: page?.id ?? null,
      page_name: page?.name ?? null,
      ig_id: page?.instagram_business_account?.id ?? null,
      ig_username: page?.instagram_business_account?.username ?? null,
      whatsapp_phone_number_id: waba.phone_number_id ?? null,
      whatsapp_number: waba.number ?? null,
    },
  };
}

async function exchangeLinkedIn(code: string, redirectUri: string): Promise<TokenResult> {
  const r = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: Deno.env.get("LINKEDIN_CLIENT_ID") ?? "",
      client_secret: Deno.env.get("LINKEDIN_CLIENT_SECRET") ?? "",
    }),
  });
  const d = await r.json();
  if (!d.access_token) throw new Error(`linkedin: ${d.error_description ?? d.error ?? "token exchange failed"}`);

  const me = await fetch("https://api.linkedin.com/v2/userinfo", {
    headers: { Authorization: `Bearer ${d.access_token}` },
  }).then((x) => x.json()).catch(() => ({}));

  return {
    access_token: d.access_token,
    refresh_token: d.refresh_token ?? null,
    expires_in: d.expires_in ?? null,
    scopes: d.scope ?? null,
    account_id: me?.sub ?? "linkedin",
    account_name: me?.name ?? "LinkedIn",
    account_email: me?.email ?? null,
  };
}

Deno.serve(async (req) => {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const denied = url.searchParams.get("error");
  const admin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  if (!state) return new Response("Missing state", { status: 400 });
  const stateHash = await sha256(state);

  /* Looked up by HASH. The value from the URL is never stored, so a database
     read yields nothing replayable. */
  const { data: st } = await admin
    .from("oauth_states")
    .select("user_id, workspace_id, redirect_to, redirect_after, provider, popup, expires_at, code_verifier_encrypted")
    .eq("state_hash", stateHash)
    .maybeSingle();
  if (!st) return new Response("Invalid or expired state", { status: 400 });

  // Single use, whatever happens next, plus the sweep nothing else does.
  await admin.from("oauth_states").delete().eq("state_hash", stateHash);
  await admin.from("oauth_states").delete().lt("expires_at", new Date().toISOString());

  if (!st.expires_at || new Date(st.expires_at).getTime() < Date.now()) {
    return finish(st, { ok: false, provider: st.provider, code: "oauth_expired" });
  }

  const provider = String(st.provider) as Provider;
  const log = (action: string, status: "success" | "failure", extra: Record<string, unknown> = {}) =>
    admin.from("integration_logs").insert({
      workspace_id: st.workspace_id,
      user_id: st.user_id,
      action,
      status,
      metadata: { provider, ...extra },
      error_message: typeof extra.error === "string" ? extra.error : null,
    });

  if (denied) {
    // The provider's words go to the log, never into the URL.
    console.error("consent declined", provider, denied);
    await log("oauth_failed", "failure", { error: String(denied) });
    return finish(st, { ok: false, provider, code: "oauth_denied" });
  }
  if (!code) return new Response("Missing code", { status: 400 });

  /* Still a member? Somebody removed from the workspace between starting and
     finishing must not land a connection in it. */
  const { data: member } = await admin
    .from("memberships").select("workspace_id")
    .eq("user_id", st.user_id).eq("workspace_id", st.workspace_id).maybeSingle();
  if (!member) {
    await log("oauth_failed", "failure", { error: "no longer a member" });
    return finish(st, { ok: false, provider, code: "forbidden" });
  }

  const redirectUri = `${SUPABASE_URL}/functions/v1/integration-oauth-callback`;

  try {
    const verifier = st.code_verifier_encrypted ? await decrypt(st.code_verifier_encrypted) : null;

    const result =
      provider === "google" ? await exchangeGoogle(code, redirectUri, verifier)
      : provider === "microsoft" ? await exchangeMicrosoft(code, redirectUri, verifier)
      : provider === "slack" ? await exchangeSlack(code, redirectUri)
      : provider === "discord" ? await exchangeDiscord(code, redirectUri)
      : provider === "meta" ? await exchangeMeta(code, redirectUri)
      : provider === "linkedin" ? await exchangeLinkedIn(code, redirectUri)
      : null;
    if (!result) return finish(st, { ok: false, provider, code: "oauth_failed" });

    const row: Record<string, unknown> = {
      workspace_id: st.workspace_id,
      user_id: st.user_id,
      provider,
      provider_account_id: result.account_id,
      provider_account_name: result.account_name ?? null,
      provider_email: result.account_email ?? null,
      status: "connected",
      access_token_encrypted: result.access_token ? await encrypt(result.access_token) : null,
      token_expires_at: result.expires_in ? new Date(Date.now() + result.expires_in * 1000).toISOString() : null,
      scopes: result.scopes ?? null,
      metadata: result.metadata ?? {},
      last_error: null,
      updated_at: new Date().toISOString(),
    };
    /* Only when the provider sent one. A re-consent that omits the refresh
       token must not erase the one already held, or the connection silently
       becomes an hour long. */
    if (result.refresh_token) row.refresh_token_encrypted = await encrypt(result.refresh_token);

    const { data: saved, error } = await admin
      .from("integrations")
      .upsert(row, { onConflict: "workspace_id,user_id,provider,provider_account_id" })
      .select("id")
      .single();
    if (error) {
      console.error("could not store integration", provider, error.message);
      await log("oauth_failed", "failure", { error: error.message });
      return finish(st, { ok: false, provider, code: "oauth_failed" });
    }

    /* DUAL WRITE, temporarily. Ten functions still read the old per-person
       tables; writing both keeps mail and chat working while they move over. */
    if (provider === "google" && result.refresh_token) {
      await admin.from("google_credentials").upsert({
        owner_id: st.user_id,
        refresh_token: result.refresh_token,
        access_token: result.access_token,
        token_expiry: row.token_expires_at,
        scopes: result.scopes,
        connected_at: new Date().toISOString(),
      }, { onConflict: "owner_id" });
    }
    if (provider === "microsoft" && result.refresh_token) {
      await admin.from("microsoft_credentials").upsert({
        owner_id: st.user_id,
        refresh_token: result.refresh_token,
        access_token: result.access_token,
        token_expiry: row.token_expires_at,
        scopes: result.scopes,
        account_email: result.account_email,
        connected_at: new Date().toISOString(),
      }, { onConflict: "owner_id" });
    }

    await log("oauth_connected", "success", { integration_id: saved?.id, account: result.account_id });
    return finish(st, { ok: true, provider, account: result.account_email ?? result.account_name ?? null });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("install failed", provider, message);
    await log("oauth_failed", "failure", { error: message });
    return finish(st, { ok: false, provider, code: "token_exchange_failed" });
  }
});
