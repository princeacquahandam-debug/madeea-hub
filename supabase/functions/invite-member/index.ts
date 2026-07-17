// Supabase Edge Function: invite-member  (self-contained — paste as-is)
// POST { email } -> { ok, email }
// Invites a teammate into the CALLER'S workspace as an EA.
//
// Security:
//  - Auth is enforced in-code (deploy with Verify JWT OFF so browser CORS
//    preflight passes; we still require + validate the bearer token here).
//  - The caller must be an *admin* of their workspace — checked against the DB
//    using THEIR token (RLS-scoped), not anything sent from the browser.
//  - The workspace_id attached to the invite is read server-side from the
//    caller's membership, so a client cannot inject another workspace.
//  - The service-role key lives only in the function env, never in the browser.
//  - The invite is recorded in the `invites` table (service-role only), which is
//    what handle_new_user consults. It used to be passed as signup metadata, but
//    that field is client-controlled on the public /auth/v1/signup endpoint, so
//    anyone who knew a workspace UUID could self-join. See 0016.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "unauthorized" }, 401);

    // Identify the caller and read their membership through their own token (RLS).
    const userClient = createClient(URL, ANON, { global: { headers: { Authorization: auth } } });
    const { data: authed } = await userClient.auth.getUser();
    if (!authed?.user) return json({ error: "unauthorized" }, 401);

    const { data: me } = await userClient
      .from("memberships").select("workspace_id, role").eq("user_id", authed.user.id).limit(1).maybeSingle();
    if (!me) return json({ error: "no workspace" }, 403);
    if (me.role !== "admin") return json({ error: "forbidden — admins only" }, 403);

    const { email } = await req.json().catch(() => ({ email: "" }));
    const addr = String(email ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(addr)) return json({ error: "a valid email is required" }, 400);

    // Service role: record the invite server-side, then send it. handle_new_user
    // reads this row (never the signup metadata) to decide membership. Role is
    // hardcoded to 'ea' — it is deliberately not accepted from the body, so an
    // invite can never mint an admin.
    const admin = createClient(URL, SERVICE);

    // An already-accepted invite is what keeps an existing member in the
    // workspace. Re-inviting must not overwrite it: resetting accepted_at and
    // then rolling back on "email already exists" would delete their seat.
    const { data: existing } = await admin
      .from("invites").select("accepted_at").eq("email", addr).maybeSingle();
    if (existing?.accepted_at) return json({ error: "That person is already a member." }, 409);

    const { error: invErr } = await admin.from("invites").upsert(
      {
        email: addr,
        workspace_id: me.workspace_id,
        role: "ea",
        invited_by: authed.user.id,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        accepted_at: null,
      },
      { onConflict: "email" },
    );
    if (invErr) return json({ error: invErr.message }, 400);

    const { error } = await admin.auth.admin.inviteUserByEmail(addr);
    if (error) {
      // Only clean up an invite this call created. A pending invite that already
      // existed is someone else's in-flight invite — leave it alone.
      if (!existing) await admin.from("invites").delete().eq("email", addr).is("accepted_at", null);
      return json({ error: error.message }, 400);
    }

    return json({ ok: true, email: addr });
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
