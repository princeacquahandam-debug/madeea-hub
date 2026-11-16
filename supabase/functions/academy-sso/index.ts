// Supabase Edge Function: academy-sso  (self-contained. Paste as-is)
// POST (no body), Authorization: Bearer <Hub access token>
//   -> { token_hash }
//
// One sign-in for the Hub and the Academy (Abder's roadmap, 16 Nov 2026).
// The Hub calls this when someone clicks "Open MadeEA Academy", then opens
//   https://academy.madeea.io/sso#t=<token_hash>
// and the Academy exchanges the hash for its OWN session (verifyOtp).
//
// ═══ WHY NOT JUST HAND OVER THE HUB'S TOKENS ═════════════════════════════
// Passing the Hub's refresh token to the Academy would make two apps share
// one refresh token. Supabase rotates refresh tokens and treats a reused one
// as theft, revoking the whole session, so whichever app refreshed second
// would sign the person out of both. A one-time sign-in link gives the
// Academy a separate session, and nothing is shared.
//
// Security:
//  - Deploy with Verify JWT OFF (browser CORS preflight); the bearer token is
//    checked here against Supabase Auth.
//  - Only workspace members get a link. Client portal accounts are not
//    members and are refused, so the Academy stays staff-only.
//  - The link is for the CALLER'S OWN email, read from their verified token,
//    never from the request, so nobody can mint a sign-in for someone else.
//  - The hash is single use and expires with Supabase's OTP expiry (1 hour
//    by default). No email is sent.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ error: "Sign in to the Hub first." }, 401);

  // Who is calling, from their own token.
  const asUser = createClient(URL, ANON, { global: { headers: { Authorization: auth } } });
  const { data: u, error: uErr } = await asUser.auth.getUser();
  if (uErr || !u?.user?.email) return json({ error: "Sign in to the Hub first." }, 401);

  // Members only (RLS-scoped read of their own membership).
  const { data: me, error: meErr } = await asUser.rpc("acad_me");
  if (meErr) return json({ error: "The Academy isn't set up yet (run migration 0103)." }, 500);
  if (!me?.role) return json({ error: "The Academy is for the MadeEA team." }, 403);

  const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: u.user.email });
  if (error || !data?.properties?.hashed_token) {
    return json({ error: "Couldn't open the Academy. Try again." }, 500);
  }
  return json({ token_hash: data.properties.hashed_token });
});
