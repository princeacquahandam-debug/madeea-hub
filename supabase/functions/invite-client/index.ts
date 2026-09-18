// Supabase Edge Function: invite-client  (self-contained. Paste as-is)
// POST { email, password, client_id, mode? } -> { ok, email, client, linked?, reset? }
// Gives one of the agency's clients a login to their own portal, with a
// starting password the admin sets and hands over.
//
// THIS IS NOT invite-member, AND MUST NOT BECOME IT.
//
// invite-member writes an `invites` row, because handle_new_user reads that row
// to decide membership. A client must end up with NO membership (0065: the
// isolation is the absence of the row), so this function writes no invite at
// all. If you ever find yourself adding one here to "make it consistent", read
// 0065's header first.
//
// ═══ WHY THE ADMIN SETS THE PASSWORD ═════════════════════════════════════
//
// This used to call inviteUserByEmail. The client clicked the link, landed in
// the portal already signed in, and was never asked to choose a password -- so
// the Password form in their own settings, which requires the current one,
// asked them for something they had never been given. Their own account was
// unchangeable. The escape hatch was a recovery email, and the project's SMTP
// is rate limited across all of it, so past a couple of clients an onboarding
// afternoon that answer was "email rate limit exceeded".
//
// Now the admin types the address and a starting password, tells the client
// both, and the client can change it the moment they sign in. Nothing is
// emailed from here.
//
// ═══ ORDERING IS LOAD-BEARING, AND THE CONFIRM IS PART OF IT ═════════════
//
// 0070's grant_membership_fallback grants a staff seat in the agency workspace
// to any account that CONFIRMS holding no client_users row. It skips anyone who
// already holds one -- which is only true if that row is written before the
// confirm, so it is written here, in the same request that creates the account,
// never in a follow-up call.
//
// That is also why the account is created UNCONFIRMED and confirmed at the end,
// rather than with email_confirm on creation. Creating it confirmed flips
// email_confirmed_at before the link exists, which is precisely the window the
// fallback fires in: the client is handed an employee seat in the agency
// workspace, and the client_users insert that follows is then refused outright
// by 0070's trigger. The repair script in supabase/ exists because that has
// happened. Create, link, then confirm.
//
// Security:
//  - Auth enforced in-code (deploy with Verify JWT OFF so CORS preflight passes).
//  - The caller must be an admin or owner, checked against the DB with THEIR
//    token, exactly as invite-member does.
//  - client_id is verified to belong to the CALLER'S workspace, read through
//    their own token, so a client from another workspace cannot be named -- in
//    the reset mode too, where it is what scopes whose password may be set.
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

    /* Required, and the refusal says why rather than just saying no: a browser
       still running the previous build sends no password at all, and the person
       reading the message is the one who can fix that with a reload. */
    const pw = String(body.password ?? "");
    if (pw.length < MIN_PW) {
      return json(
        { error: `Set them a starting password of at least ${MIN_PW} characters. They cannot set one themselves, so you choose it and tell them.` },
        400,
      );
    }
    if (pw.length > MAX_PW) return json({ error: `That password is too long. ${MAX_PW} characters at most.` }, 400);

    const mode = String(body.mode ?? "invite");
    if (mode !== "invite" && mode !== "reset") return json({ error: `Unknown mode: ${mode}` }, 400);

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

    // ── mode: reset ────────────────────────────────────────────────────────
    // For the clients invited by email before this function set passwords, and
    // for the ordinary "they have forgotten it" afternoon. Their access is not
    // touched: only the password, and the confirmation an unopened invite never
    // got.
    if (mode === "reset") {
      if (!existingId) return json({ error: "No account here uses that address." }, 404);

      const { data: link } = await admin
        .from("client_users").select("client_id, role").eq("user_id", existingId).maybeSingle();

      /* Scoped to the client named above, which was itself scoped to the
         caller's workspace. Without this an admin could set the password of any
         account in the project, including another workspace's client. */
      if (!link || link.client_id !== client.id) {
        return json({ error: `Nobody with that address has a login for ${client.name}.` }, 404);
      }

      const { error: pwErr } = await admin.auth.admin.updateUserById(existingId, {
        password: pw,
        /* An invite that was mailed and never opened leaves an unconfirmed
           address, and an unconfirmed address cannot sign in with a password
           however right the password is. Confirming here is safe: the
           client_users row above already exists, so 0070's fallback sees a
           client rather than an unclaimed staff account. */
        email_confirm: true,
      });
      if (pwErr) return json({ error: pwErr.message }, 400);

      return json({ ok: true, email: addr, client: client.name, reset: true });
    }

    // ── mode: invite ───────────────────────────────────────────────────────
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
            ? { error: `That address already has a portal login for ${client.name}. Use Set a password if they cannot get in.` }
            : { error: "That address already has a portal login for a different client." },
          409,
        );
      }

      /* An existing account with no seat and no link: connect it, and set the
         password the caller typed, because the reason an unlinked account is
         being connected by hand is rarely that everybody remembers its
         password. */
      const { error: linkErr } = await admin.from("client_users").insert({
        user_id: existingId,
        client_id: client.id,
        workspace_id: client.workspace_id,
      });
      if (linkErr) return json({ error: linkErr.message }, 400);

      const { error: pwErr } = await admin.auth.admin.updateUserById(existingId, {
        password: pw,
        email_confirm: true,
      });
      if (pwErr) return json({ error: pwErr.message }, 400);

      return json({ ok: true, email: addr, client: client.name, linked: true });
    }

    /* No account yet. Create it UNCONFIRMED, link it, then confirm it -- see
       the ordering note in the header. Every other order either opens the
       window where 0070's fallback turns this client into an employee, or
       leaves an account that cannot sign in. */
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

    const { error: confirmErr } = await admin.auth.admin.updateUserById(newId, { email_confirm: true });
    if (confirmErr) {
      /* Unconfirmed means unusable: the password is right and the sign-in is
         still refused. Better no account than one that silently cannot be used,
         and the link row goes with it. */
      await admin.auth.admin.deleteUser(newId).catch(() => {});
      return json({ error: `Could not activate the account: ${confirmErr.message}` }, 400);
    }

    return json({ ok: true, email: addr, client: client.name });
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
