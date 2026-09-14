// Supabase Edge Function: invite-client  (self-contained. Paste as-is)
// POST { email, client_id } -> { ok, email, linked? }
// Gives one of the agency's clients a login to their own portal.
//
// THIS IS NOT invite-member, AND MUST NOT BECOME IT.
//
// invite-member writes an `invites` row, because handle_new_user reads that row
// to decide membership. A client must end up with NO membership (0065: the
// isolation is the absence of the row), so this function writes no invite at
// all. If you ever find yourself adding one here to "make it consistent", read
// 0065's header first.
//
// ORDERING IS LOAD-BEARING. 0070's grant_membership_fallback skips anyone who
// already holds a client_users row. That is only true if the row is written
// before the client confirms their email, so it is written here, in the same
// request that creates the account — never in a follow-up call. 0070's trigger
// is the backstop for the case where this ordering is somehow not honoured.
//
// Security:
//  - Auth enforced in-code (deploy with Verify JWT OFF so CORS preflight passes).
//  - The caller must be an admin or owner, checked against the DB with THEIR
//    token, exactly as invite-member does.
//  - client_id is verified to belong to the CALLER'S workspace, read through
//    their own token, so a client from another workspace cannot be named.
//  - The service-role key lives only in the function env.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

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

    const userClient = createClient(URL, ANON, { global: { headers: { Authorization: auth } } });
    const { data: authed } = await userClient.auth.getUser();
    if (!authed?.user) return json({ error: "unauthorized" }, 401);

    const { data: me } = await userClient
      .from("memberships").select("workspace_id, role").eq("user_id", authed.user.id).limit(1).maybeSingle();
    if (!me) return json({ error: "no workspace" }, 403);

    // Same ranks as invite-member, same reason: owner sits above admin.
    const RANK: Record<string, number> = { owner: 40, admin: 30, manager: 20, employee: 10, ea: 10 };
    if ((RANK[String(me.role)] ?? 0) < RANK.admin) {
      return json({ error: "forbidden. Admins and owners only" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const addr = String(body.email ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(addr)) return json({ error: "a valid email is required" }, 400);

    const clientId = String(body.client_id ?? "").trim();
    if (!clientId) return json({ error: "client_id is required" }, 400);

    /* Read the client through the CALLER'S token, so RLS decides whether they
       may name it. Trusting a client_id from the browser would let an admin of
       one workspace hand out a login to another workspace's client. */
    const { data: client } = await userClient
      .from("clients").select("id, name, workspace_id").eq("id", clientId).maybeSingle();
    if (!client) return json({ error: "No such client in your workspace." }, 404);

    const admin = createClient(URL, SERVICE);

    // Does this address already have an account?
    const { data: existingId, error: lookupErr } = await admin.rpc("auth_user_id_by_email", { addr });
    if (lookupErr) return json({ error: lookupErr.message }, 500);

    if (existingId) {
      /* Staff cannot also be a client. 0070's trigger would refuse the insert
         anyway; saying so here turns a raw check_violation into a sentence. */
      const { data: seat } = await admin
        .from("memberships").select("user_id").eq("user_id", existingId).maybeSingle();
      if (seat) {
        return json(
          { error: "That address belongs to a team member. A member cannot also hold a client login." },
          409,
        );
      }

      const { data: already } = await admin
        .from("client_users").select("client_id").eq("user_id", existingId).maybeSingle();
      if (already) {
        return json(
          already.client_id === client.id
            ? { error: `That address already has a portal login for ${client.name}.` }
            : { error: "That address already has a portal login for a different client." },
          409,
        );
      }

      /* An existing account with no seat and no link: connect it rather than
         emailing. inviteUserByEmail refuses an address that is already
         registered, so a send here could only fail — the same trap documented
         in invite-member. */
      const { error: linkErr } = await admin.from("client_users").insert({
        user_id: existingId,
        client_id: client.id,
        workspace_id: client.workspace_id,
      });
      if (linkErr) return json({ error: linkErr.message }, 400);

      return json({ ok: true, email: addr, client: client.name, linked: true });
    }

    // No account yet: create one, then link it before it can be confirmed.
    const { data: created, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(addr);
    if (inviteErr) return json({ error: inviteErr.message }, 400);

    const newId = created?.user?.id;
    if (!newId) return json({ error: "Supabase created no user for that invite." }, 500);

    const { error: linkErr } = await admin.from("client_users").insert({
      user_id: newId,
      client_id: client.id,
      workspace_id: client.workspace_id,
    });
    if (linkErr) {
      /* The link is the whole point of the account. An account that exists
         without one is precisely what 0070 guards against, so do not leave one
         lying around when the link fails. */
      await admin.auth.admin.deleteUser(newId).catch(() => {});
      return json({ error: `Could not link the account to ${client.name}: ${linkErr.message}` }, 400);
    }

    return json({ ok: true, email: addr, client: client.name });
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
