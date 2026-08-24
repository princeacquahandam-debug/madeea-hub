// Edge Function: integration-oauth-callback   (Verify JWT: OFF. Providers redirect here with no session.)
//
// The far end of every Connect button that is not a mailbox: Slack, Discord,
// Meta (Instagram + WhatsApp) and LinkedIn. Exchanges the code, works out what
// was actually installed, and files it against the workspace that started the
// flow.
//
// ── WHY THE STATE ROW IS THE ONLY IDENTITY, AND WHY THAT IS SAFE HERE ────
//
// This endpoint cannot authenticate anyone. The Microsoft mailbox flow solves
// that with a claim step (0048) because a mailbox is personal: filing one under
// the wrong person hands them somebody's private mail.
//
// These four are not personal. They are workspace-wide installs of a Slack
// workspace, a Discord server, a Facebook business. The state carries the
// workspace decided at the start, while the caller was authenticated, and the
// worst a lure achieves is installing an attacker's OWN Slack into a workspace
// they were already a member of, which is a thing members can do from the front
// door anyway. The state is still single-use and ten minutes old at most.
//
// ── WHAT COMES BACK TO THE BROWSER ──────────────────────────────────────
//
// A popup gets a small page that posts a message to its opener and closes
// itself, which is why nobody has to sit and watch a redirect chain. A
// full-page flow gets the 302 it expects. The state records which, rather than
// this guessing from a header.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const APP_ORIGINS = (Deno.env.get("APP_ORIGINS") ?? "")
  .split(",").map((o) => o.trim()).filter(Boolean);
const GRAPH = "https://graph.facebook.com/v21.0";

/**
 * The page a popup lands on: tell the opener, close.
 *
 * postMessage is targeted at the app's exact origin rather than "*", so the
 * result cannot be read by anything else that happens to have a handle on this
 * window. The text is there for the case where the popup is not a popup
 * (someone opened the link directly) and window.close() is refused.
 */
function popupPage(origin: string, payload: Record<string, unknown>) {
  const body = JSON.stringify({ source: "madeea-oauth", ...payload });
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Connecting…</title>
<body style="font:14px system-ui;background:#0b0f17;color:#e5e7eb;display:grid;place-items:center;height:100vh;margin:0">
<p>${payload.ok ? "Connected. You can close this window." : "That did not complete. You can close this window."}</p>
<script>
  try { window.opener && window.opener.postMessage(${body}, ${JSON.stringify(origin)}); } catch (e) {}
  setTimeout(function () { try { window.close(); } catch (e) {} }, 300);
</script>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

function finish(st: { redirect_to?: string | null; popup?: boolean }, payload: Record<string, unknown>) {
  const dest = APP_ORIGINS.includes(st.redirect_to ?? "") ? st.redirect_to! : APP_ORIGINS[0];
  if (!dest) return new Response("APP_ORIGINS is not configured", { status: 500 });
  if (st.popup) return popupPage(dest, payload);
  const q = payload.ok
    ? `connected=${payload.provider}`
    : `error=${payload.provider}_failed`;
  return new Response(null, { status: 302, headers: { Location: `${dest}/integrations?${q}` } });
}

/** Slack: the install response already names the workspace and the bot. */
async function exchangeSlack(code: string, redirectUri: string) {
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
  return {
    access_token: d.access_token as string,          // xoxb-…, the bot token
    scopes: d.scope as string,
    account_label: d.team?.name ?? "Slack workspace",
    external_id: d.team?.id ?? null,
    details: { bot_user_id: d.bot_user_id ?? null },
  };
}

/**
 * Discord: the code exchange returns a USER token we do not want, and a `guild`
 * object naming the server the bot was just added to, which we do. The bot
 * itself authenticates with the application's own bot token, so what is stored
 * here is which server it landed in.
 */
async function exchangeDiscord(code: string, redirectUri: string) {
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
  return {
    /* Deliberately NOT the user token from this response: it expires in a week
       and grants what the installer can see. The bot's own token is the
       application's, and discord-sync uses that. Stored empty so nothing is
       tempted to use a credential with the wrong lifetime. */
    access_token: null as string | null,
    scopes: d.scope as string,
    account_label: d.guild?.name ?? "Discord server",
    external_id: d.guild?.id ?? null,
    details: { guild_id: d.guild?.id ?? null },
  };
}

/**
 * Meta: one login, three things behind it.
 *
 * The short-lived token is exchanged for a long-lived one immediately, because
 * a connection that dies in an hour is not a connection. Then the Page is
 * resolved (its own token is what the messaging APIs want), the Instagram
 * business account attached to it, and the WhatsApp number if the business has
 * one. Any of the three may be absent, and absent is recorded rather than
 * treated as failure: a business with a Page and no WhatsApp is a normal state.
 */
async function exchangeMeta(code: string, redirectUri: string) {
  const appId = Deno.env.get("META_APP_ID") ?? "";
  const appSecret = Deno.env.get("META_APP_SECRET") ?? "";

  const tok = await fetch(
    `${GRAPH}/oauth/access_token?${new URLSearchParams({
      client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code,
    })}`,
  ).then((r) => r.json());
  if (!tok.access_token) throw new Error(`meta: ${tok.error?.message ?? "install failed"}`);

  const long = await fetch(
    `${GRAPH}/oauth/access_token?${new URLSearchParams({
      grant_type: "fb_exchange_token",
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: tok.access_token,
    })}`,
  ).then((r) => r.json());
  const userToken = long.access_token ?? tok.access_token;

  const pages = await fetch(
    `${GRAPH}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&access_token=${encodeURIComponent(userToken)}`,
  ).then((r) => r.json());
  const page = pages?.data?.[0] ?? null;

  /* WhatsApp hangs off the business rather than the Page, so it is a separate
     lookup and a separate failure. Wrapped, because a business with no WhatsApp
     must still finish connecting Instagram. */
  let waba: { phone_number_id?: string; number?: string } = {};
  try {
    const biz = await fetch(
      `${GRAPH}/me/businesses?fields=id,name&access_token=${encodeURIComponent(userToken)}`,
    ).then((r) => r.json());
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

  const label = [page?.instagram_business_account?.username && `@${page.instagram_business_account.username}`,
    page?.name, waba.number].filter(Boolean).join(" · ") || "Meta business";

  return {
    /* The PAGE token, not the user token: it is what the messaging endpoints
       accept, and it does not expire while the page permission stands. */
    access_token: page?.access_token ?? userToken,
    scopes: null as string | null,
    account_label: label,
    external_id: page?.id ?? null,
    details: {
      page_id: page?.id ?? null,
      page_name: page?.name ?? null,
      ig_id: page?.instagram_business_account?.id ?? null,
      ig_username: page?.instagram_business_account?.username ?? null,
      whatsapp_phone_number_id: waba.phone_number_id ?? null,
      whatsapp_number: waba.number ?? null,
    },
  };
}

async function exchangeLinkedIn(code: string, redirectUri: string) {
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
  if (!d.access_token) throw new Error(`linkedin: ${d.error_description ?? d.error ?? "install failed"}`);
  return {
    access_token: d.access_token as string,
    scopes: (d.scope as string) ?? null,
    token_expiry: d.expires_in ? new Date(Date.now() + d.expires_in * 1000).toISOString() : null,
    account_label: "LinkedIn",
    external_id: null,
    details: {},
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

  const { data: st } = await admin
    .from("oauth_states")
    .select("user_id, workspace_id, redirect_to, provider, popup, private, expires_at")
    .eq("state", state)
    .maybeSingle();
  if (!st) return new Response("Invalid or expired state", { status: 400 });

  // Single use, whatever happens next, plus the usual sweep.
  await admin.from("oauth_states").delete().eq("state", state);
  await admin.from("oauth_states").delete().lt("expires_at", new Date().toISOString());

  if (!st.expires_at || new Date(st.expires_at).getTime() < Date.now()) {
    return new Response("Invalid or expired state", { status: 400 });
  }
  const provider = String(st.provider);
  if (denied) {
    console.error("consent declined", provider, denied, url.searchParams.get("error_description"));
    return finish(st, { ok: false, provider });
  }
  if (!code) return new Response("Missing code", { status: 400 });
  if (!st.workspace_id) {
    console.error("state carried no workspace", provider);
    return finish(st, { ok: false, provider });
  }

  const redirectUri = `${SUPABASE_URL}/functions/v1/integration-oauth-callback`;

  try {
    const result =
      provider === "slack" ? await exchangeSlack(code, redirectUri)
      : provider === "discord" ? await exchangeDiscord(code, redirectUri)
      : provider === "meta" ? await exchangeMeta(code, redirectUri)
      : provider === "linkedin" ? await exchangeLinkedIn(code, redirectUri)
      : null;
    if (!result) return finish(st, { ok: false, provider });

    /* Null for a shared account, the installer for a private one (0058). */
    const ownerId = st.private ? st.user_id : null;

    /* Whether an account for this provider already exists IN THE SAME SCOPE.
       The first one becomes the default; a second is added beside it and
       changes nothing about where sends go, because somebody adding an account
       should not silently redirect a client's replies. Scoped, so connecting a
       private account does not find the team's and decline to be its owner's
       default. */
    const existing = admin
      .from("workspace_integrations")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", st.workspace_id)
      .eq("provider", provider);
    const { count } = await (ownerId ? existing.eq("owner_id", ownerId) : existing.is("owner_id", null));

    /* Never null by the time it reaches the database: it is the account's
       identity now (0057). LinkedIn issues no id with its token, so it falls
       back to the provider name, which makes LinkedIn single-account by
       construction rather than by a rule somebody has to remember. */
    const externalId = result.external_id ?? provider;

    const { error } = await admin.from("workspace_integrations").upsert(
      {
        workspace_id: st.workspace_id,
        provider,
        owner_id: ownerId,
        is_default: (count ?? 0) === 0,
        access_token: result.access_token,
        scopes: result.scopes,
        token_expiry: (result as { token_expiry?: string | null }).token_expiry ?? null,
        account_label: result.account_label,
        external_id: externalId,
        details: result.details,
        connected_by: st.user_id,
        connected_at: new Date().toISOString(),
      },
      /* Matches the unique index from 0058, which includes owner_id and is
         NULLS NOT DISTINCT: re-connecting the shared account updates the shared
         row rather than adding a second one. */
      { onConflict: "workspace_id,provider,external_id,owner_id" },
    );
    if (error) {
      console.error("could not store integration", provider, error.message);
      return finish(st, { ok: false, provider });
    }

    return finish(st, { ok: true, provider, account: result.account_label });
  } catch (e) {
    // The provider's words go to the log; the browser gets a clean close.
    console.error("install failed", provider, e instanceof Error ? e.message : e);
    return finish(st, { ok: false, provider });
  }
});
