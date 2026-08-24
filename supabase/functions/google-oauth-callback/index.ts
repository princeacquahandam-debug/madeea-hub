// Edge Function: google-oauth-callback   (Verify JWT: OFF. Google redirects here with no auth header)
// Exchanges the auth code for tokens, stores them, and bounces back to the app.
//
// This endpoint runs with the service role and cannot authenticate the caller
// (Google sends the browser here with no bearer token), so the state row is the
// only identity signal. Validating the state alone is NOT enough: an attacker
// could mint a state, send the link to a victim, and have the VICTIM's Google
// tokens filed under the attacker's owner_id. Handing the attacker the victim's
// inbox. Two checks close that:
//   1. expires_at. States are short-lived, so a stale lure dies (10 min).
//   2. expected_email, the id_token's email must equal the email of the user who
//      STARTED the flow. A victim consenting on an attacker's link produces a
//      different address and is rejected before any token is stored.
// Consequence: the Google account you connect must match your MadeEA login email.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

/* What we ASK for. Kept only as the fallback for the record, and deliberately
   not the thing we store: see the note where the row is built. Must stay in
   step with google-oauth-url. */
const REQUESTED_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar.readonly",
  "openid",
  "email",
].join(" ");

const APP_ORIGINS = (Deno.env.get("APP_ORIGINS") ?? "")
  .split(",").map((o) => o.trim()).filter(Boolean);

/**
 * Read the email claim out of a Google id_token.
 * The token came straight from Google's token endpoint over TLS, authenticated
 * with our client_secret, so the channel (not the signature) is what we trust
 * here; we are not accepting this token from the browser.
 */
function emailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null;
  const part = idToken.split(".")[1];
  if (!part) return null;
  try {
    const pad = part.replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(pad + "=".repeat((4 - (pad.length % 4)) % 4)));
    // email_verified is the claim this whole check leans on: an unverified
    // address on a Google account proves nothing about who owns it.
    if (claims.email_verified !== true) return null;
    return typeof claims.email === "string" ? claims.email.toLowerCase() : null;
  } catch {
    return null;
  }
}

// Bounce back to the app with a message instead of leaving the user on a blank error.
function bounce(origin: string | undefined, status: "google_failed" | "google_mismatch") {
  const base = origin && APP_ORIGINS.includes(origin) ? origin : APP_ORIGINS[0];
  if (!base) return new Response("Google connection failed", { status: 400 });
  return new Response(null, { status: 302, headers: { Location: `${base}/integrations?error=${status}` } });
}


/**
 * The page a popup lands on: tell the opener, close.
 *
 * postMessage is targeted at the app's exact origin rather than "*", so the
 * result cannot be read by anything else holding a handle on this window.
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

Deno.serve(async (req) => {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const err = url.searchParams.get("error");
  const admin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  if (err) return bounce(undefined, "google_failed");
  if (!code || !state) return new Response("Missing code/state", { status: 400 });

  const { data: st } = await admin
    .from("oauth_states")
    .select("user_id, redirect_to, expected_email, provider, popup, expires_at")
    .eq("state", state)
    .maybeSingle();
  if (!st) return new Response("Invalid or expired state", { status: 400 });

  // Single-use regardless of what happens next.
  await admin.from("oauth_states").delete().eq("state", state);
  // Opportunistic sweep. Nothing else prunes this table.
  await admin.from("oauth_states").delete().lt("expires_at", new Date().toISOString());

  if (!st.expires_at || new Date(st.expires_at).getTime() < Date.now()) {
    return new Response("Invalid or expired state", { status: 400 });
  }
  /* A state minted for Microsoft must not be spendable here (0048 added the
     column). Belt and braces: a Microsoft state carries no expected_email, so
     the identity check below would refuse it anyway. This refuses it for the
     right reason, and keeps that check from being the only thing standing
     between two providers' flows. */
  if ((st.provider ?? "google") !== "google") {
    return new Response("Invalid or expired state", { status: 400 });
  }

  // Only ever redirect to a known origin; this used to be reflected verbatim.
  const dest = APP_ORIGINS.includes(st.redirect_to ?? "") ? st.redirect_to! : APP_ORIGINS[0];
  // Without this, an unset APP_ORIGINS sends `Location: undefined/...` and
  // strands the user *after* their tokens have already been stored.
  if (!dest) {
    console.error("APP_ORIGINS is not configured");
    return new Response("APP_ORIGINS is not configured", { status: 500 });
  }

  const redirectUri = `${SUPABASE_URL}/functions/v1/google-oauth-callback`;
  const tokRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const tok = await tokRes.json();
  // Don't echo Google's error body back to the browser.
  if (!tokRes.ok) {
    console.error("google token exchange failed", tokRes.status);
    return bounce(dest, "google_failed");
  }

  // The consenting Google account must be the one that started the flow.
  const googleEmail = emailFromIdToken(tok.id_token);
  if (!googleEmail || !st.expected_email || googleEmail !== st.expected_email) {
    console.error("google oauth identity mismatch for user", st.user_id);
    /* The one refusal worth spelling out in the popup itself. Every other
       failure is "try again"; this one is "you picked the wrong account", and
       a person who does not know that will pick it again. */
    if (st.popup) {
      return popupPage(dest, {
        ok: false,
        provider: "google",
        error: "That Google account does not match your MadeEA sign-in email. Connect the account you log in with.",
      });
    }
    return bounce(dest, "google_mismatch");
  }

  const row: Record<string, unknown> = {
    owner_id: st.user_id,
    access_token: tok.access_token,
    token_expiry: new Date(Date.now() + (tok.expires_in ?? 3600) * 1000).toISOString(),
    /* What Google ACTUALLY granted, not what we asked for.
       This used to store a local constant, which made the record a guess. It
       was wrong in the quiet direction today: the request was updated to
       include gmail.send, Google granted it, and the row still said read-only,
       so gmail-send refused a send the account was entitled to make.

       It can be wrong in the dangerous direction too. A user can untick a
       permission on the consent screen, and a record that claims a scope we do
       not hold means the app promises something Google will refuse.

       tok.scope is Google's own answer. Believe it. */
    scopes: typeof tok.scope === "string" && tok.scope.length ? tok.scope : REQUESTED_SCOPES,
    connected_at: new Date().toISOString(),
  };
  if (tok.refresh_token) row.refresh_token = tok.refresh_token; // keep prior one if Google omits it
  await admin.from("google_credentials").upsert(row, { onConflict: "owner_id" });

  if (st.popup) return popupPage(dest, { ok: true, provider: "google" });
  return new Response(null, { status: 302, headers: { Location: `${dest}/integrations?connected=google` } });
});
