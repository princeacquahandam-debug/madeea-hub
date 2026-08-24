// Edge Function: microsoft-oauth-claim   (Verify JWT: ON. Default)
// Turns a parked Microsoft consent into a connection owned by the caller.
//
// This is the step that decides ownership, and it is the only one in the
// Microsoft flow that can: the browser here is carrying a real Supabase session,
// so we know who is asking rather than inferring it from a state row.
//
// TWO THINGS MUST AGREE, and requiring both is the whole design:
//   1. You hold the claim code   — proves you completed the consent
//   2. You are the user who started the flow — proves the consent was yours
//
// Either alone is forgeable in a way that ends with one person's mailbox filed
// under another person's account. Together they are not:
//
//   attacker mints a state, lures a victim into consenting
//     -> the code lands in the VICTIM's browser; the attacker never sees it
//     -> if the victim's app claims it, user_id (attacker) != caller (victim)
//     -> refused, and the tokens are deleted rather than left parked
//
//   a claim code leaks (history, referrer, a pasted URL)
//     -> whoever presents it is not the user who started the flow
//     -> refused, tokens deleted
//
// The row is deleted on EVERY path, success or refusal. A claim code is worth
// one attempt, and a refused attempt destroys what it was pointing at rather
// than leaving it for a second try.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const APP_ORIGINS = (Deno.env.get("APP_ORIGINS") ?? "")
  .split(",").map((o) => o.trim()).filter(Boolean);

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

    const supa = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: u } = await supa.auth.getUser();
    if (!u?.user) return json({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const claim = String(body.claim ?? "").trim();
    // Shape-checked before it reaches the database: `claim` is a uuid primary
    // key, and a malformed value should be a 400 here rather than a 500 from
    // Postgres refusing the cast.
    if (!/^[0-9a-f-]{36}$/i.test(claim)) return json({ error: "invalid claim" }, 400);

    const admin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: row, error: readErr } = await admin
      .from("microsoft_oauth_pending")
      .select("user_id, refresh_token, access_token, token_expiry, scopes, account_email, expires_at")
      .eq("claim", claim)
      .maybeSingle();
    if (readErr) {
      console.error("pending read failed", readErr.message);
      return json({ error: "Could not finish the Microsoft connection." }, 500);
    }
    if (!row) return json({ error: "This connection link has already been used or has expired.", failure: "no_claim" }, 400);

    // Single use, and destroyed on refusal too. Deleted BEFORE the checks so no
    // early return can leave a claimable row behind.
    await admin.from("microsoft_oauth_pending").delete().eq("claim", claim);

    if (!row.expires_at || new Date(row.expires_at).getTime() < Date.now()) {
      return json({ error: "This connection link has expired. Please connect again.", failure: "expired" }, 400);
    }
    if (row.user_id !== u.user.id) {
      // The lure attack, or a leaked code. Logged as a security event, and the
      // browser is told nothing that distinguishes it from an expired link.
      console.error("microsoft claim rejected: started by", row.user_id, "claimed by", u.user.id);
      return json({ error: "This connection link has expired. Please connect again.", failure: "expired" }, 400);
    }

    const { error: writeErr } = await admin.from("microsoft_credentials").upsert(
      {
        owner_id: u.user.id,
        refresh_token: row.refresh_token,
        access_token: row.access_token,
        token_expiry: row.token_expiry,
        scopes: row.scopes,
        account_email: row.account_email,
        connected_at: new Date().toISOString(),
      },
      { onConflict: "owner_id" },
    );
    if (writeErr) {
      console.error("microsoft_credentials upsert failed", writeErr.message);
      return json({ error: "Could not save the Microsoft connection." }, 500);
    }

    return json({ ok: true, account_email: row.account_email });
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
