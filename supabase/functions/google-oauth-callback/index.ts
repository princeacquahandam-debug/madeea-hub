// Edge Function: google-oauth-callback   (Verify JWT: OFF — Google redirects here with no auth header)
// Exchanges the auth code for tokens, stores them, and bounces back to the app.
//
// This endpoint runs with the service role and cannot authenticate the caller
// (Google sends the browser here with no bearer token), so the state row is the
// only identity signal. Validating the state alone is NOT enough: an attacker
// could mint a state, send the link to a victim, and have the VICTIM's Google
// tokens filed under the attacker's owner_id — handing the attacker the victim's
// inbox. Two checks close that:
//   1. expires_at — states are short-lived, so a stale lure dies (10 min).
//   2. expected_email — the id_token's email must equal the email of the user who
//      STARTED the flow. A victim consenting on an attacker's link produces a
//      different address and is rejected before any token is stored.
// Consequence: the Google account you connect must match your MadeEA login email.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SCOPES =
  "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.readonly openid email";

const APP_ORIGINS = (Deno.env.get("APP_ORIGINS") ?? "")
  .split(",").map((o) => o.trim()).filter(Boolean);

/**
 * Read the email claim out of a Google id_token.
 * The token came straight from Google's token endpoint over TLS, authenticated
 * with our client_secret, so the channel — not the signature — is what we trust
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
    .select("user_id, redirect_to, expected_email, expires_at")
    .eq("state", state)
    .maybeSingle();
  if (!st) return new Response("Invalid or expired state", { status: 400 });

  // Single-use regardless of what happens next.
  await admin.from("oauth_states").delete().eq("state", state);
  // Opportunistic sweep — nothing else prunes this table.
  await admin.from("oauth_states").delete().lt("expires_at", new Date().toISOString());

  if (!st.expires_at || new Date(st.expires_at).getTime() < Date.now()) {
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
    return bounce(dest, "google_mismatch");
  }

  const row: Record<string, unknown> = {
    owner_id: st.user_id,
    access_token: tok.access_token,
    token_expiry: new Date(Date.now() + (tok.expires_in ?? 3600) * 1000).toISOString(),
    scopes: SCOPES,
    connected_at: new Date().toISOString(),
  };
  if (tok.refresh_token) row.refresh_token = tok.refresh_token; // keep prior one if Google omits it
  await admin.from("google_credentials").upsert(row, { onConflict: "owner_id" });

  return new Response(null, { status: 302, headers: { Location: `${dest}/integrations?connected=google` } });
});
