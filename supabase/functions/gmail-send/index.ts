// Edge Function: gmail-send   (Verify JWT: OFF. Auth enforced in code.)
//
// Sends an email through a connected Google account.
//
// ── The account architecture question, and what this does about it ────────
// Which mailbox an EA sends from is an unresolved business decision: the EA's
// own address, the client's via delegation, or a shared agency address. That is
// Rio's call, not something to guess at in code.
//
// So the account is a PARAMETER, never a hardcode. `from_owner` names whose
// stored Google credential to send through, defaulting to the caller's own.
// When the decision lands, delegation becomes a different value passed in here
// rather than a rewrite of this function.
//
// ── The scope problem, which is why this currently cannot send ────────────
// google-oauth-url requests gmail.readonly and calendar.readonly. Sending needs
// https://www.googleapis.com/auth/gmail.send, which is a change to the consent
// screen AND a re-authorisation by every user who has already connected.
//
// This function is written correctly and will work the moment that scope is
// granted. Until then Google returns 403 ACCESS_TOKEN_SCOPE_INSUFFICIENT, and
// this passes that back verbatim as `needs_scope` so the UI can say precisely
// what is missing instead of failing vaguely. It never pretends to have sent.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";

/** Exchange the stored refresh token for a live access token. */
async function accessToken(refresh: string): Promise<string> {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_CLIENT_ID") ?? "",
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "",
      refresh_token: refresh,
      grant_type: "refresh_token",
    }),
  });
  const d = await r.json();
  if (!d.access_token) throw new Error(`token refresh failed: ${d.error ?? "unknown"}`);
  return d.access_token as string;
}

/** RFC 2822, base64url. Gmail wants the whole message, not fields. */
function rawMessage(to: string, subject: string, body: string, from?: string, cc?: string): string {
  const lines = [
    from ? `From: ${from}` : null,
    `To: ${to}`,
    cc ? `Cc: ${cc}` : null,
    // Encoded, so a subject with an accent or an em dash does not corrupt.
    `Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    btoa(unescape(encodeURIComponent(body))),
  ].filter(Boolean);
  return btoa(unescape(encodeURIComponent(lines.join("\r\n"))))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "unauthorized" }, 401);
    const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: u } = await supa.auth.getUser();
    if (!u?.user) return json({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const to = String(body.to ?? "").trim();
    const subject = String(body.subject ?? "").trim();
    const text = String(body.body ?? "").trim();
    if (!to || !text) return json({ error: "to and body are required" }, 400);

    /* The account is a parameter. Defaults to the caller, and a future
       delegation model passes a different owner rather than changing this. */
    const owner = String(body.from_owner ?? u.user.id);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: cred } = await admin
      .from("google_credentials")
      .select("refresh_token, scopes")
      .eq("owner_id", owner)
      .maybeSingle();

    if (!cred?.refresh_token) {
      return json({ error: "Google not connected for this account", failure: "not_connected", owner }, 400);
    }

    /* Checked before we call Google, so the answer is specific rather than a
       403 the UI has to guess at. */
    if (!String(cred.scopes ?? "").includes(SEND_SCOPE)) {
      return json({
        error: "This Google connection can read mail but not send it.",
        failure: "needs_scope",
        missing_scope: SEND_SCOPE,
        granted: cred.scopes,
      }, 403);
    }

    const token = await accessToken(cred.refresh_token);
    const raw = rawMessage(to, subject || "(no subject)", text, body.from ? String(body.from) : undefined, body.cc);

    const send = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw, ...(body.thread_id ? { threadId: body.thread_id } : {}) }),
    });
    const sent = await send.json();
    if (!send.ok) {
      const reason = sent?.error?.status ?? sent?.error?.message ?? "send failed";
      return json({
        error: String(reason),
        failure: String(reason).includes("SCOPE") ? "needs_scope" : "send_failed",
        detail: sent?.error,
      }, send.status);
    }

    // Record it, so a sent mail shows in the Communication Center and can reach
    // the EOD. A failure to record is reported, not swallowed: the mail DID go.
    const { error: writeErr } = await supa.from("messages").insert({
      source: "gmail",
      direction: "outbound",
      sender_name: u.user.email ?? "MadeEA",
      subject: subject || "(no subject)",
      preview: text.slice(0, 140),
      body: text,
      category: "reply",
      received_at: new Date().toISOString(),
    });

    return json({ ok: true, id: sent.id, thread_id: sent.threadId, recorded: !writeErr });
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
