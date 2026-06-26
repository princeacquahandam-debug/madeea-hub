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

    // Service role: send the invite, stamping the caller's workspace so the
    // handle_new_user trigger joins them as an EA.
    const admin = createClient(URL, SERVICE);
    const { error } = await admin.auth.admin.inviteUserByEmail(addr, {
      data: { workspace_id: me.workspace_id },
    });
    if (error) return json({ error: error.message }, 400);

    return json({ ok: true, email: addr });
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
