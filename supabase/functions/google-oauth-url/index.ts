// Edge Function: google-oauth-url   (Verify JWT: ON — default)
// Returns a Google consent URL for the signed-in user and records an OAuth state.
//
// Security:
//  - `origin` is validated against APP_ORIGINS. It used to be stored verbatim and
//    reflected into a 302 by the callback, which was an open redirect.
//  - The state is pinned to the caller's own email (expected_email) and expires
//    after 10 minutes; the callback enforces both. See google-oauth-callback.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

// Comma-separated, e.g. "https://hub.madeea.com,http://localhost:5173"
const APP_ORIGINS = (Deno.env.get("APP_ORIGINS") ?? "")
  .split(",").map((o) => o.trim()).filter(Boolean);

const SCOPES =
  "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.readonly openid email";

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
    if (!u.user.email) return json({ error: "account has no email" }, 400);

    // Never trust a redirect target from the request body.
    const { origin } = await req.json().catch(() => ({ origin: "" }));
    const redirectTo = APP_ORIGINS.includes(String(origin ?? "")) ? String(origin) : APP_ORIGINS[0];
    if (!redirectTo) return json({ error: "APP_ORIGINS is not configured" }, 500);

    const admin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: st, error } = await admin
      .from("oauth_states")
      .insert({
        user_id: u.user.id,
        redirect_to: redirectTo,
        expected_email: u.user.email.toLowerCase(),
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      })
      .select("state")
      .single();
    if (error) return json({ error: error.message }, 500);

    const params = new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
      redirect_uri: `${SUPABASE_URL}/functions/v1/google-oauth-callback`,
      response_type: "code",
      scope: SCOPES,
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state: st.state,
      // Pre-selects the right account at Google; the callback still verifies.
      login_hint: u.user.email,
    });
    return json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` });
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
