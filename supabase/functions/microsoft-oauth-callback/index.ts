// Edge Function: microsoft-oauth-callback   (Verify JWT: OFF. Microsoft redirects here with no auth header)
// Exchanges the auth code for tokens, PARKS them, and bounces back to the app.
//
// WHAT THIS DELIBERATELY DOES NOT DO: decide who owns these tokens.
//
// It cannot authenticate the caller (Microsoft sends the browser here with no
// bearer token), so the only identity signal available is the state row, and
// the state row is minted by whoever started a flow, not by whoever finished
// one. Google's twin of this file closes that gap by demanding the consenting
// address equal the MadeEA login email. That check would make Outlook
// unconnectable for most people (see 0048), so ownership is settled one step
// later instead: the tokens go into microsoft_oauth_pending, the browser
// carries a single-use claim code back to the app, and microsoft-oauth-claim
// files them only for an authenticated caller who is the same user that started
// the flow.
//
// Consequence worth stating plainly: between this function and the claim, a set
// of Microsoft tokens exists in the database owned by nobody. It lives for ten
// minutes, is deleted on first use, and is unreadable by any browser (the table
// is service-role only). A claim code that leaks buys an attacker nothing,
// because the claim also checks who is asking.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const APP_ORIGINS = (Deno.env.get("APP_ORIGINS") ?? "")
  .split(",").map((o) => o.trim()).filter(Boolean);

const TENANT = Deno.env.get("MICROSOFT_TENANT") ?? "common";

/** Claims out of the id_token. Straight from Microsoft's token endpoint over
 *  TLS, authenticated with our client_secret, so the channel is what we trust;
 *  we are not accepting this token from a browser. Used for display only. */
function claims(idToken: string | undefined): Record<string, unknown> | null {
  if (!idToken) return null;
  const part = idToken.split(".")[1];
  if (!part) return null;
  try {
    const pad = part.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(pad + "=".repeat((4 - (pad.length % 4)) % 4)));
  } catch {
    return null;
  }
}

/* Work accounts often carry no `email` claim at all: the address is the UPN.
   Personal Outlook.com accounts have `email` and a UPN that is not a mailbox.
   Trying both in this order is what makes one function work for both. */
function addressFrom(c: Record<string, unknown> | null): string | null {
  if (!c) return null;
  for (const k of ["email", "preferred_username", "upn"]) {
    const v = c[k];
    if (typeof v === "string" && v.includes("@")) return v.toLowerCase();
  }
  return null;
}

function bounce(origin: string | undefined, status: "outlook_failed") {
  const base = origin && APP_ORIGINS.includes(origin) ? origin : APP_ORIGINS[0];
  if (!base) return new Response("Microsoft connection failed", { status: 400 });
  return new Response(null, { status: 302, headers: { Location: `${base}/integrations?error=${status}` } });
}

Deno.serve(async (req) => {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const err = url.searchParams.get("error");
  const admin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  if (err) {
    // Microsoft's error_description is the useful half (consent declined,
    // admin approval required, app not found). Logged, never reflected.
    console.error("microsoft consent failed", err, url.searchParams.get("error_description"));
    return bounce(undefined, "outlook_failed");
  }
  if (!code || !state) return new Response("Missing code/state", { status: 400 });

  const { data: st } = await admin
    .from("oauth_states")
    .select("user_id, redirect_to, provider, expires_at")
    .eq("state", state)
    .maybeSingle();
  if (!st) return new Response("Invalid or expired state", { status: 400 });

  // Single-use regardless of what happens next, plus the same opportunistic
  // sweep the Google callback does. Nothing else prunes either table.
  await admin.from("oauth_states").delete().eq("state", state);
  await admin.from("oauth_states").delete().lt("expires_at", new Date().toISOString());
  await admin.from("microsoft_oauth_pending").delete().lt("expires_at", new Date().toISOString());

  if (!st.expires_at || new Date(st.expires_at).getTime() < Date.now()) {
    return new Response("Invalid or expired state", { status: 400 });
  }
  // A state minted for Google must not be spendable here, and vice versa.
  if (st.provider !== "microsoft") return new Response("Invalid or expired state", { status: 400 });

  const dest = APP_ORIGINS.includes(st.redirect_to ?? "") ? st.redirect_to! : APP_ORIGINS[0];
  if (!dest) {
    console.error("APP_ORIGINS is not configured");
    return new Response("APP_ORIGINS is not configured", { status: 500 });
  }

  const redirectUri = `${SUPABASE_URL}/functions/v1/microsoft-oauth-callback`;
  const tokRes = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: Deno.env.get("MICROSOFT_CLIENT_ID") ?? "",
      client_secret: Deno.env.get("MICROSOFT_CLIENT_SECRET") ?? "",
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const tok = await tokRes.json();
  if (!tokRes.ok) {
    console.error("microsoft token exchange failed", tokRes.status, tok?.error, tok?.error_description);
    return bounce(dest, "outlook_failed");
  }

  /* A refresh token is the entire point of the connection: without it the
     mailbox stops syncing an hour from now and nothing on screen says why. Its
     absence means offline_access was not granted, which is a failure now rather
     than a mystery later. */
  if (!tok.refresh_token) {
    console.error("microsoft returned no refresh_token; offline_access was not granted");
    return bounce(dest, "outlook_failed");
  }

  const c = claims(tok.id_token);
  let accountEmail = addressFrom(c);
  /* Fall back to the mailbox itself when the token says nothing useful. Some
     tenants issue an id_token whose UPN is not a routable address, and "which
     mailbox did I connect" is the one question the Integrations card exists to
     answer. Best-effort: a failure here costs a label, not the connection. */
  if (!accountEmail && tok.access_token) {
    try {
      const me = await fetch("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName", {
        headers: { Authorization: `Bearer ${tok.access_token}` },
      }).then((r) => r.json());
      const v = me?.mail ?? me?.userPrincipalName;
      if (typeof v === "string" && v.includes("@")) accountEmail = v.toLowerCase();
    } catch (e) {
      console.error("graph /me lookup failed", e instanceof Error ? e.message : e);
    }
  }

  const { data: pending, error: parkErr } = await admin
    .from("microsoft_oauth_pending")
    .insert({
      user_id: st.user_id,
      refresh_token: tok.refresh_token,
      access_token: tok.access_token,
      token_expiry: new Date(Date.now() + (tok.expires_in ?? 3600) * 1000).toISOString(),
      /* What Microsoft ACTUALLY granted, not what we asked for. The Google
         callback learned this the hard way: a stored constant made the record a
         guess, and a stale guess blocked a send the account was entitled to. */
      scopes: typeof tok.scope === "string" && tok.scope.length ? tok.scope : null,
      account_email: accountEmail,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    })
    .select("claim")
    .single();

  if (parkErr || !pending) {
    console.error("could not park microsoft tokens", parkErr?.message);
    return bounce(dest, "outlook_failed");
  }

  return new Response(null, {
    status: 302,
    headers: { Location: `${dest}/integrations?connect=outlook&claim=${pending.claim}` },
  });
});
