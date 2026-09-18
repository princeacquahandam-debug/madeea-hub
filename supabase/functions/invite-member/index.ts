// Supabase Edge Function: invite-member  (self-contained. Paste as-is)
// POST { email, password, role, mode? } -> { ok, email, reinstated?, reset? }
// Adds a teammate to the CALLER'S workspace at the role they choose, with a
// starting password the caller sets and hands over.
//
// ═══ WHY THE INVITER SETS THE PASSWORD ═══════════════════════════════════
//
// This used to call inviteUserByEmail: Supabase mailed a link, the person
// clicked it, landed already signed in, and was never asked to choose a
// password. Nothing in the app asked them later either. Then they opened
// Settings, where changing a password requires the current one -- because
// updateUser does not verify the old one, so without that check an unlocked
// laptop is enough to take an account over -- and had no current password to
// type. The account was stuck on a password that did not exist.
//
// The only way out was a recovery email, and that is the second half of it:
// the built-in SMTP is rate limited across the whole project, so "Failed to
// send password recovery: email rate limit exceeded" is what onboarding
// actually looked like on a day with more than a couple of new people.
//
// So no mail is sent from here at all. The caller types an address AND a
// starting password, the account is created already confirmed, and the caller
// passes both along through whatever channel they already use to talk to that
// person. From then on the person HAS a current password, so the Settings form
// works, which is the entire point of the change.
//
// MODE 'reset' EXISTS FOR THE ACCOUNTS THIS ARRIVED TOO LATE FOR. Everyone
// invited by email before this change is holding exactly the stuck account
// described above and cannot fix it themselves. An admin sets them a password
// instead. It is a separate mode rather than a side effect of re-inviting, so
// nobody silently resets a working account by retyping an address.
//
// Security:
//  - Auth is enforced in-code (deploy with Verify JWT OFF so browser CORS
//    preflight passes; we still require + validate the bearer token here).
//  - The caller must be an *admin* of their workspace. Checked against the DB
//    using THEIR token (RLS-scoped), not anything sent from the browser.
//  - The workspace_id attached to the invite is read server-side from the
//    caller's membership, so a client cannot inject another workspace.
//  - BOTH MODES ARE RANK CHECKED. An admin may not invite, and may not set a
//    password for, anybody whose role outranks their own. Without that second
//    check "set a password" is a one-click takeover of the owner's account by
//    any admin.
//  - The service-role key lives only in the function env, never in the browser.
//  - The invite is recorded in the `invites` table (service-role only), which is
//    what handle_new_user consults. It used to be passed as signup metadata, but
//    that field is client-controlled on the public /auth/v1/signup endpoint, so
//    anyone who knew a workspace UUID could self-join. See 0016.

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

/* 8 is the floor Supabase enforces and what both password forms in the app
   already ask for. 72 is bcrypt's ceiling: everything past it is ignored when
   hashed, so a 90-character password would appear to work and then not match
   from the 73rd character on. Refusing it is kinder than truncating it. */
const MIN_PW = 8;
const MAX_PW = 72;

/** The one rank table. Owner sits above admin, and 'ea' is the stored spelling
 *  of 'employee': seven existing rows carry it and the enum was made with it. */
const RANK: Record<string, number> = { owner: 40, admin: 30, manager: 20, employee: 10, ea: 10 };

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

    /* Rank, not equality. This read `me.role !== "admin"`, which was correct
       when admin was the highest role and became wrong the moment owner was
       added above it: an owner would have been refused permission to invite
       anyone. The same mistake was in is_admin() and is worth only making
       once. */
    const myRank = RANK[String(me.role)] ?? 0;
    if (myRank < RANK.admin) return json({ error: "forbidden. Admins and owners only" }, 403);

    const body = await req.json().catch(() => ({}));
    const addr = String(body.email ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(addr)) return json({ error: "a valid email is required" }, 400);

    /* Required in both modes, and the refusal says why rather than just saying
       no: a browser still running the previous build sends no password at all,
       and the person reading the message is the one who can fix that with a
       reload. */
    const pw = String(body.password ?? "");
    if (pw.length < MIN_PW) {
      return json(
        { error: `Set them a starting password of at least ${MIN_PW} characters. They cannot set one themselves, so you choose it and pass it on.` },
        400,
      );
    }
    if (pw.length > MAX_PW) return json({ error: `That password is too long. ${MAX_PW} characters at most.` }, 400);

    const mode = String(body.mode ?? "invite");
    if (mode !== "invite" && mode !== "reset") return json({ error: `Unknown mode: ${mode}` }, 400);

    const admin = createClient(URL, SERVICE);

    /* WHO THIS ADDRESS ACTUALLY IS, asked of auth rather than of the invite
       history. This used to test `invites.accepted_at`, which records that
       somebody once joined and says nothing about whether they are here now.
       Deleting a membership never cleared it, so removing a member and trying
       to add them back was answered with "That person is already a member"
       about somebody holding no membership at all, with no way out from inside
       the product. */
    const { data: targetId, error: lookupErr } = await admin
      .rpc("auth_user_id_by_email", { addr });
    if (lookupErr) return json({ error: lookupErr.message }, 500);

    // ── mode: reset ────────────────────────────────────────────────────────
    // Give an existing teammate a password they actually know. Nothing else
    // changes: not their role, not their seat, not a row of their work.
    if (mode === "reset") {
      if (!targetId) return json({ error: "No account here uses that address." }, 404);
      if (targetId === authed.user.id) {
        return json(
          { error: "That is your own account. Change your password in Settings, where it asks for your current one." },
          400,
        );
      }

      const { data: seat } = await admin
        .from("memberships")
        .select("role")
        .eq("workspace_id", me.workspace_id)
        .eq("user_id", targetId)
        .maybeSingle();

      /* Scoped to the caller's own workspace. "Not in your workspace" and "no
         such account" deliberately read the same, so this cannot be used to
         find out which addresses exist elsewhere. */
      if (!seat) return json({ error: "Nobody with that address is a member of your workspace." }, 404);

      if ((RANK[String(seat.role)] ?? 0) > myRank) {
        return json({ error: `You cannot set a password for ${seat.role}, which is above your own role.` }, 403);
      }

      const { error: pwErr } = await admin.auth.admin.updateUserById(targetId, {
        password: pw,
        /* Confirm while we are here. An account invited by email and never
           opened is unconfirmed, and an unconfirmed address cannot sign in with
           a password however right the password is. */
        email_confirm: true,
      });
      if (pwErr) return json({ error: pwErr.message }, 400);

      return json({ ok: true, email: addr, reset: true });
    }

    // ── mode: invite ───────────────────────────────────────────────────────
    /* The role comes from the request, where it previously did not. It used to
       be hardcoded to 'ea' so that an invite could never mint an admin, which
       was the right call when nothing else stopped it: the effect was that the
       role picker on screen decided nothing and everyone invited arrived as an
       employee whatever was chosen.
       What makes it safe to accept now is that it is checked twice. Here,
       against the inviter's rank; and again by a trigger on `invites`, so a
       request that bypasses this function entirely is still refused. */
    const requested = String(body.role ?? "employee").toLowerCase();
    const wantedRank = RANK[requested];
    if (!wantedRank) return json({ error: `Unknown role: ${requested}` }, 400);
    if (wantedRank > myRank) {
      return json({ error: `You cannot invite someone as ${requested}, which is above your own role.` }, 403);
    }
    // 'employee' is the name people use; 'ea' is what seven existing rows carry
    // and what the enum was created with. Same rank, one stored spelling.
    const roleToStore = requested === "employee" ? "ea" : requested;

    if (targetId) {
      // The account exists. The only question left is whether the seat does.
      const { data: seat } = await admin
        .from("memberships")
        .select("user_id")
        .eq("workspace_id", me.workspace_id)
        .eq("user_id", targetId)
        .maybeSingle();

      if (seat) {
        return json(
          { error: "That person is already a member. Use Set a password if they cannot get in." },
          409,
        );
      }

      /* An account with no seat is reinstated: the row is what they lost, so
         the row is what gets restored. The password is set as well, because the
         caller typed one and the likeliest reason somebody is being added back
         is that nobody remembers what their old one was.

         The guard triggers allow this: both return early when auth.uid() is
         null, which is the case for a service-role caller. The rank check above
         still applies, because it ran against the CALLER. */
      const { error: seatErr } = await admin.from("memberships").insert({
        workspace_id: me.workspace_id,
        user_id: targetId,
        role: roleToStore,
      });
      if (seatErr) return json({ error: seatErr.message }, 400);

      const { error: pwErr } = await admin.auth.admin.updateUserById(targetId, {
        password: pw,
        email_confirm: true,
      });
      if (pwErr) return json({ error: pwErr.message }, 400);

      await admin.from("invites").upsert(
        {
          email: addr,
          workspace_id: me.workspace_id,
          role: roleToStore,
          invited_by: authed.user.id,
          created_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
          accepted_at: new Date().toISOString(),
        },
        { onConflict: "email" },
      );

      return json({ ok: true, email: addr, reinstated: true });
    }

    // No account: the ordinary path. Record the invite, then create the account.
    // handle_new_user reads this row, never signup metadata, to decide the seat.
    const { error: invErr } = await admin.from("invites").upsert(
      {
        email: addr,
        workspace_id: me.workspace_id,
        role: roleToStore,
        invited_by: authed.user.id,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        /* STILL NULL, AND IT HAS TO BE. Nothing is waiting for a click any
           more, so marking it accepted here reads as the tidier record -- and
           it would cost the new member their seat. grant_invited_membership
           only matches an invite `where accepted_at is null`, so an invite
           pre-marked accepted is an invite the confirm path cannot see, and the
           account would be created with no membership at all. The trigger sets
           this field itself, at the moment it grants. */
        accepted_at: null,
      },
      { onConflict: "email" },
    );
    if (invErr) return json({ error: invErr.message }, 400);

    /* Created already confirmed, which is what makes the password usable
       immediately. The invite row above is written first, so the confirm path
       finds it and grants the seat at the role chosen here rather than falling
       back to a default one. */
    const { data: created, error } = await admin.auth.admin.createUser({
      email: addr,
      password: pw,
      email_confirm: true,
    });
    if (error) {
      await admin.from("invites").delete().eq("email", addr).is("accepted_at", null);
      return json({ error: error.message }, 400);
    }
    if (!created?.user?.id) return json({ error: "Supabase created no user for that address." }, 500);

    return json({ ok: true, email: addr });
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
