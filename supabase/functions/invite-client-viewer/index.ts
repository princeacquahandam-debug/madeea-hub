// Supabase Edge Function: invite-client-viewer  (self-contained. Paste as-is)
// POST { email, password, role?, mode? } -> { ok, email, role, linked?, reset? }
// Lets a CLIENT add somebody to their own account: a read-only colleague, or a
// team member who does timed work on it (0078). The client sets their starting
// password and tells them it.
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
//   NOTHING ABOUT THE TARGET ACCOUNT COMES FROM THE BODY except the address,
//   the role and the password. client_id and workspace_id are read from the
//   CALLER'S OWN row. A client cannot name another client, cannot name a
//   workspace, and cannot ask for 'primary'. Taking client_id from the body
//   would let any client seat a viewer on any account whose id they could
//   guess.
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
// ═══ WHY THE CLIENT SETS THE PASSWORD ════════════════════════════════════
//
// This used to call inviteUserByEmail, and the person it mailed arrived signed
// in without ever choosing a password -- which the portal's own Password form
// then asked them for, because it requires the current one. They could not
// change a password they had never had, and the way out, a recovery email, ran
// into the project-wide SMTP rate limit. The same trap as invite-member and
// invite-client, one level further out: here the person stuck with it is
// somebody the CLIENT invited, so the client is the one who has to be able to
// fix it. So the client types the password, the same way the agency does for
// them, and passes it on. Nothing is emailed from here.
//
// MODE 'reset' is the client's version of that fix: set a new password for
// somebody already on their account. It reaches nobody else -- not the other
// primary, not staff, not another client's people -- and it is a separate mode
// so that re-typing an address cannot silently change a working password.
//
// ═══ CREATE, LINK, THEN CONFIRM ══════════════════════════════════════════
//
// 0070's fallback grants a staff seat in the AGENCY workspace to any account
// that confirms holding no client_users row. So the row must exist before the
// confirm does: the account is created unconfirmed, linked, and only then
// confirmed. Creating it confirmed would hand a client's colleague a seat in
// the agency's own workspace -- the failure 0070 was written for, and the
// reason a repair script for it exists in supabase/.
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

/* 8 is the floor Supabase enforces and what the portal's own password form
   asks for. 72 is bcrypt's ceiling: everything past it is ignored when hashed,
   so a longer password would appear to be accepted and then not match. */
const MIN_PW = 8;
const MAX_PW = 72;

/** How many people one client account may seat, per role. See the header.
 *  Members are capped harder than viewers: a viewer is another pair of eyes,
 *  a member is a person doing the work, and that is the number the commercial
 *  line in 0078 actually turns on. */
const CAP: Record<string, number> = { viewer: 5, member: 10 };

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

    /* Required, and the refusal says why rather than just saying no: a browser
       still running the previous build sends no password at all, and the person
       reading the message is the one who can fix that with a reload. */
    const pw = String(body.password ?? "");
    if (pw.length < MIN_PW) {
      return json(
        { error: `Give them a starting password of at least ${MIN_PW} characters. They cannot set one themselves, so you choose it and tell them.` },
        400,
      );
    }
    if (pw.length > MAX_PW) return json({ error: `That password is too long. ${MAX_PW} characters at most.` }, 400);

    const mode = String(body.mode ?? "invite");
    if (mode !== "invite" && mode !== "reset") return json({ error: `Unknown mode: ${mode}` }, 400);

    if (addr === String(authed.user.email ?? "").toLowerCase()) {
      return json({ error: "That is your own address." }, 400);
    }

    const admin = createClient(URL, SERVICE);

    // ── mode: reset ────────────────────────────────────────────────────────
    // Set a new password for somebody already on this account. Scoped to this
    // account's own people and to nobody else, by the caller's own row.
    if (mode === "reset") {
      const { data: targetId, error: lookupErr } = await admin.rpc("auth_user_id_by_email", { addr });
      if (lookupErr) return json({ error: lookupErr.message }, 500);

      /* Deliberately one sentence for three different situations: no such
         account, an account on somebody else's client, and agency staff. A
         client must not be able to learn which addresses exist by the shape of
         the refusal. */
      const notYours = { error: "Nobody with that address is on your account." };
      if (!targetId) return json(notYours, 404);

      const { data: link } = await admin
        .from("client_users").select("client_id, role").eq("user_id", targetId).maybeSingle();
      if (!link || link.client_id !== me.client_id) return json(notYours, 404);

      if (link.role === "primary") {
        return json(
          { error: "That is an account owner. They change their own password in their settings." },
          403,
        );
      }

      const { error: pwErr } = await admin.auth.admin.updateUserById(targetId, {
        password: pw,
        /* An invite that was mailed and never opened leaves an unconfirmed
           address, and an unconfirmed address cannot sign in whatever the
           password is. Safe to confirm here: the client_users row already
           exists, so 0070's fallback sees a client's colleague rather than an
           unclaimed staff account. */
        email_confirm: true,
      });
      if (pwErr) return json({ error: pwErr.message }, 400);

      return json({ ok: true, email: addr, role: link.role, reset: true });
    }

    // ── mode: invite ───────────────────────────────────────────────────────
    /* Defaults to viewer. A client asking for something this function does not
       recognise gets a refusal rather than the more powerful of the two. */
    const role = String(body.role ?? "viewer");
    if (role !== "viewer" && role !== "member") {
      return json({ error: "role must be viewer or member" }, 400);
    }

    const { count: seated } = await admin
      .from("client_users")
      .select("user_id", { count: "exact", head: true })
      .eq("client_id", me.client_id)
      .eq("role", role);

    if ((seated ?? 0) >= CAP[role]) {
      const noun = role === "member" ? "team members" : "colleagues";
      return json(
        { error: `You can have ${CAP[role]} ${noun}. Remove one before adding another, or talk to us about more seats.` },
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
            ? { error: "They already have access to this account. Use Set a password if they cannot get in." }
            : { error: "That address cannot be added to this account." },
          409,
        );
      }

      /* An existing account with no seat and no link: connect it, and set the
         password the caller typed, because an account being connected by hand
         is rarely one whose password anybody still remembers. */
      const { error: linkErr } = await admin.from("client_users").insert({
        user_id: existingId,
        client_id: me.client_id,
        workspace_id: me.workspace_id,
        role,
      });
      if (linkErr) return json({ error: linkErr.message }, 400);

      const { error: pwErr } = await admin.auth.admin.updateUserById(existingId, {
        password: pw,
        email_confirm: true,
      });
      if (pwErr) return json({ error: pwErr.message }, 400);

      return json({ ok: true, email: addr, role, linked: true });
    }

    // No account yet: create it unconfirmed, link it, then confirm it. See the
    // ordering note in the header -- 0070's fallback is what it is guarding.
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: addr,
      password: pw,
      email_confirm: false,
    });
    if (createErr) return json({ error: createErr.message }, 400);

    const newId = created?.user?.id;
    if (!newId) return json({ error: "Supabase created no user for that address." }, 500);

    const { error: linkErr } = await admin.from("client_users").insert({
      user_id: newId,
      client_id: me.client_id,
      workspace_id: me.workspace_id,
      role,
    });
    if (linkErr) {
      /* An account with no link is the exact thing 0070 guards against, so it
         does not get left behind when the link fails. */
      await admin.auth.admin.deleteUser(newId).catch(() => {});
      return json({ error: linkErr.message }, 400);
    }

    const { error: confirmErr } = await admin.auth.admin.updateUserById(newId, { email_confirm: true });
    if (confirmErr) {
      /* Unconfirmed means unusable: the password is right and the sign-in is
         refused anyway. Better no account than one that quietly cannot be used;
         the link row cascades away with it. */
      await admin.auth.admin.deleteUser(newId).catch(() => {});
      return json({ error: `Could not activate the account: ${confirmErr.message}` }, 400);
    }

    return json({ ok: true, email: addr, role });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "unexpected error" }, 500);
  }
});
