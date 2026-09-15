// Supabase Edge Function: invite-client-viewer  (self-contained. Paste as-is)
// POST { email } -> { ok, email, linked? }
// Lets a CLIENT give a colleague read-only access to their own account.
//
// THIS IS THE ONLY PLACE A NON-EMPLOYEE CREATES AN ACCOUNT, AND THAT IS WHY IT
// IS WRITTEN LIKE THIS.
//
// Everywhere else in this project, the person minting a login is staff: an
// admin inviting a member, an admin inviting a client. Here the caller is a
// client, outside the workspace, holding no membership. They are being handed
// the service-role key's ability to create an auth user, through a very narrow
// slot, and every line below is about how narrow.
//
//   NOTHING ABOUT THE TARGET ACCOUNT COMES FROM THE BODY except the address.
//   client_id, workspace_id and role are read from the CALLER'S OWN row. A
//   client cannot name another client, cannot name a workspace, and cannot ask
//   for 'primary'. Taking client_id from the body would let any client seat a
//   viewer on any account whose id they could guess.
//
//   ONLY A PRIMARY MAY INVITE. Otherwise a viewer invites a viewer and the cap
//   below means nothing after the second hop.
//
//   THE CAP IS COMMERCIAL, NOT TECHNICAL. The 14 Sep call ruled client-side
//   people out entirely, to stop a client seating their own staff instead of
//   hiring assistants (15:18). Read-only viewers answer the need behind that
//   without giving the line away, but only while the number stays small. Five
//   is a leadership team. Fifty is a company using the agency's product for
//   free.
//
//   A MEMBER CAN NEVER BECOME A VIEWER. 0070 refuses the combination by
//   trigger; refusing it here turns a raw check_violation into a sentence, and
//   stops a client from discovering which addresses are staff by trying them.
//
// Security:
//  - Auth enforced in-code (deploy with Verify JWT OFF so CORS preflight passes).
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

/** How many read-only colleagues one client account may hold. See the header. */
const VIEWER_CAP = 5;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "unauthorized" }, 401);

    const userClient = createClient(URL, ANON, { global: { headers: { Authorization: auth } } });
    const { data: authed } = await userClient.auth.getUser();
    if (!authed?.user) return json({ error: "unauthorized" }, 401);

    /* Read through the CALLER'S token, so RLS decides what they are. This one
       row is the entire authority for the insert at the bottom: it says which
       client account the caller belongs to and whether they may act on it. */
    const { data: me } = await userClient
      .from("client_users")
      .select("client_id, workspace_id, role")
      .eq("user_id", authed.user.id)
      .maybeSingle();

    if (!me) return json({ error: "Only a client account may add a colleague." }, 403);
    if (me.role !== "primary") {
      return json({ error: "Your access to this account is view only. Ask the account owner to add people." }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const addr = String(body.email ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(addr)) return json({ error: "a valid email is required" }, 400);

    if (addr === String(authed.user.email ?? "").toLowerCase()) {
      return json({ error: "That is your own address." }, 400);
    }

    const admin = createClient(URL, SERVICE);

    const { count: viewers } = await admin
      .from("client_users")
      .select("user_id", { count: "exact", head: true })
      .eq("client_id", me.client_id)
      .eq("role", "viewer");

    if ((viewers ?? 0) >= VIEWER_CAP) {
      return json(
        { error: `You can give ${VIEWER_CAP} colleagues access. Remove one before adding another, or talk to us about more seats.` },
        409,
      );
    }

    const { data: existingId, error: lookupErr } = await admin.rpc("auth_user_id_by_email", { addr });
    if (lookupErr) return json({ error: lookupErr.message }, 500);

    if (existingId) {
      const { data: seat } = await admin
        .from("memberships").select("user_id").eq("user_id", existingId).maybeSingle();
      if (seat) {
        /* Deliberately vague. The precise answer -- "that address is agency
           staff" -- lets a client map the team by trying addresses. */
        return json({ error: "That address cannot be added to this account." }, 409);
      }

      const { data: already } = await admin
        .from("client_users").select("client_id").eq("user_id", existingId).maybeSingle();
      if (already) {
        return json(
          already.client_id === me.client_id
            ? { error: "They already have access to this account." }
            : { error: "That address cannot be added to this account." },
          409,
        );
      }

      /* An existing account with no seat and no link: connect it rather than
         emailing. inviteUserByEmail refuses an address that is already
         registered, so a send here could only fail. */
      const { error: linkErr } = await admin.from("client_users").insert({
        user_id: existingId,
        client_id: me.client_id,
        workspace_id: me.workspace_id,
        role: "viewer",
      });
      if (linkErr) return json({ error: linkErr.message }, 400);

      return json({ ok: true, email: addr, linked: true });
    }

    // No account yet: create one, then link it BEFORE it can be confirmed.
    // 0070's fallback grants a staff seat to any confirmed account holding no
    // client_users row, so the order here is the whole ballgame.
    const { data: created, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(addr);
    if (inviteErr) return json({ error: inviteErr.message }, 400);

    const newId = created?.user?.id;
    if (!newId) return json({ error: "Supabase created no user for that invite." }, 500);

    const { error: linkErr } = await admin.from("client_users").insert({
      user_id: newId,
      client_id: me.client_id,
      workspace_id: me.workspace_id,
      role: "viewer",
    });
    if (linkErr) return json({ error: linkErr.message }, 400);

    return json({ ok: true, email: addr });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "unexpected error" }, 500);
  }
});
