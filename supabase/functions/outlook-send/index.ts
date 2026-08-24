// Edge Function: outlook-send   (Verify JWT: ON. Auth is also enforced in code.)
//
// Sends mail through a connected Microsoft account, and answers to the same
// contract as gmail-send so the browser needs one send path, not two:
//
//   { ok: true, id }                          it went
//   { failure: "not_connected" }              no Microsoft account linked
//   { failure: "needs_scope" }                linked, but the token cannot send
//   { failure: "send_failed", error }         a real failure, reported as one
//
// ── WHY A REPLY IS THREE CALLS AND A NEW MAIL IS ONE ──────────────────────
// Gmail threads on the In-Reply-To and References headers, which gmail-send
// writes into the raw RFC 2822 message itself. Graph will not let you write
// those headers: internetMessageHeaders is draft-only and rejects standard
// header names. So on Outlook the way to thread a reply is to ask the mailbox
// for one, which is createReply -> edit the draft -> send.
//
// That is why the reply path needs Mail.ReadWrite. The alternative is sendMail
// with "Re:" in the subject, which is not a reply: every mail client on the
// other side files it as a new conversation, splitting the thread in half. That
// exact bug is what 0042 was written to fix on the Gmail side, and shipping it
// deliberately on the Outlook side would be a strange thing to do.
//
// A brand new message has nothing to thread onto, so it stays a single
// sendMail.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const TENANT = Deno.env.get("MICROSOFT_TENANT") ?? "common";
const SEND_SCOPE = "https://graph.microsoft.com/Mail.Send";

/* Graph accepts attachments inline in a message only up to 3 MB in total;
   beyond that it wants an upload session, which is a different protocol with
   its own chunking and failure modes. The composer caps at this figure for
   Outlook, and this is the backstop: a file that slips past the browser gets a
   sentence naming the real limit, not a 413 from Microsoft. */
const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024;

type Admin = ReturnType<typeof createClient>;

/**
 * ── THE TOKEN MANAGER ────────────────────────────────────────────────────
 *
 * One question, asked the only way it may be asked: "what credential does THIS
 * PERSON hold for THIS PROVIDER?"
 *
 * The lookup takes workspace, user and provider. Never workspace and provider
 * alone — that is the shape that hands one colleague another's mailbox, and it
 * is the reason 0058 exists. A caller who does not know who is asking cannot
 * use this.
 *
 * WHAT IT DOES, in order:
 *   1. finds the caller's own integration row
 *   2. decrypts the access token
 *   3. returns it if it is still good
 *   4. refreshes it if it is not, re-encrypts, and writes it back
 *   5. marks the row reauth_required if the refresh token is dead
 *
 * A dead refresh token is a terminal state, not a retry: invalid_grant means
 * the person revoked access or changed their password, and hammering it just
 * turns one broken connection into a rate limit.
 *
 * WHY THE LEGACY FALLBACK IS HERE. google_credentials and microsoft_credentials
 * were already per-person and still hold live tokens for everybody who
 * connected before 0058. Falling back to them means nobody's mail stops syncing
 * on the day this deploys; the fallback disappears when those tables do.
 *
 * Duplicated across the functions that need it: Edge Functions here are
 * deployed one file at a time, so there is no shared module. If this changes,
 * it changes in all of them.
 */
interface Credential {
  /** Integration row id. Null when this came from a legacy table. */
  id: string | null;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
  scopes: string | null;
  metadata: Record<string, string | null>;
}

async function aesKey(usage: KeyUsage[]) {
  const raw = Deno.env.get("INTEGRATION_ENCRYPTION_KEY");
  if (!raw) throw new Error("INTEGRATION_ENCRYPTION_KEY is not configured");
  return await crypto.subtle.importKey(
    "raw", Uint8Array.from(atob(raw), (c) => c.charCodeAt(0)),
    { name: "AES-GCM" }, false, usage,
  );
}

async function encryptSecret(plain: string): Promise<string> {
  const key = await aesKey(["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain)),
  );
  const out = new Uint8Array(iv.length + cipher.length);
  out.set(iv);
  out.set(cipher, iv.length);
  return btoa(String.fromCharCode(...out));
}

async function decryptSecret(payload: string | null): Promise<string | null> {
  if (!payload) return null;
  try {
    const key = await aesKey(["decrypt"]);
    const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.slice(0, 12) }, key, bytes.slice(12),
    );
    return new TextDecoder().decode(plain);
  } catch {
    /* A row encrypted under a key that has since changed. Reported as "no
       credential" rather than as a crash, because the fix is the same one the
       UI already offers: reconnect. */
    console.error("could not decrypt a stored token; the encryption key may have changed");
    return null;
  }
}

/** The caller's own connection, decrypted. Legacy tables are the fallback. */
async function credentialFor(
  admin: Admin,
  userId: string,
  provider: "google" | "microsoft" | "slack" | "meta" | "discord" | "linkedin",
): Promise<Credential | null> {
  const { data: m } = await admin
    .from("memberships").select("workspace_id").eq("user_id", userId).limit(1).maybeSingle();

  if (m?.workspace_id) {
    /* workspace + user + provider. All three, always: this is the lookup the
       whole per-user model rests on. */
    const { data } = await admin
      .from("integrations")
      .select("id, access_token_encrypted, refresh_token_encrypted, token_expires_at, scopes, metadata, status")
      .eq("workspace_id", m.workspace_id)
      .eq("user_id", userId)
      .eq("provider", provider)
      .neq("status", "disconnected")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (data) {
      return {
        id: data.id as string,
        access_token: await decryptSecret(data.access_token_encrypted as string | null),
        refresh_token: await decryptSecret(data.refresh_token_encrypted as string | null),
        token_expires_at: (data.token_expires_at as string | null) ?? null,
        scopes: (data.scopes as string | null) ?? null,
        metadata: (data.metadata ?? {}) as Record<string, string | null>,
      };
    }
  }

  // Legacy, per-person, plaintext. Present until those tables are dropped.
  const table = provider === "google" ? "google_credentials"
    : provider === "microsoft" ? "microsoft_credentials"
    : null;
  if (!table) return null;

  const { data: old } = await admin
    .from(table).select("refresh_token, access_token, token_expiry, scopes").eq("owner_id", userId).maybeSingle();
  if (!old?.refresh_token) return null;
  return {
    id: null,
    access_token: (old.access_token as string | null) ?? null,
    refresh_token: old.refresh_token as string,
    token_expires_at: (old.token_expiry as string | null) ?? null,
    scopes: (old.scopes as string | null) ?? null,
    metadata: {},
  };
}

/** Record that a connection needs signing in again, and why. */
async function markReauth(admin: Admin, id: string | null, reason: string) {
  if (!id) return;
  await admin.from("integrations")
    .update({ status: "reauth_required", last_error: reason, updated_at: new Date().toISOString() })
    .eq("id", id);
}

/** Store a freshly refreshed token, encrypted. No-op for a legacy row. */
async function storeRefreshed(
  admin: Admin,
  cred: Credential,
  next: { access_token: string; refresh_token?: string | null; expires_in?: number | null; scope?: string | null },
) {
  const patch: Record<string, unknown> = {
    access_token_encrypted: await encryptSecret(next.access_token),
    token_expires_at: next.expires_in ? new Date(Date.now() + next.expires_in * 1000).toISOString() : null,
    status: "connected",
    last_error: null,
    updated_at: new Date().toISOString(),
  };
  /* Only when the provider sent a new one. Microsoft rotates refresh tokens and
     Google does not; overwriting with null would end the connection on the
     provider that does not. */
  if (next.refresh_token) patch.refresh_token_encrypted = await encryptSecret(next.refresh_token);
  if (next.scope) patch.scopes = next.scope;

  if (cred.id) {
    await admin.from("integrations").update(patch).eq("id", cred.id);
  }
}

/**
 * A live Microsoft access token for ONE PERSON.
 *
 * The credential comes from the token manager, which takes the user and cannot
 * be asked without one. This function used to read microsoft_credentials by
 * owner_id directly, which happened to be per-person; going through the manager
 * makes that a property of the lookup rather than a lucky table shape, and
 * brings the encrypted store with it.
 *
 * Microsoft rotates refresh tokens on most refreshes and expects the old one to
 * be dropped, so the new one is written back every time it appears. Ignoring
 * that is the classic way an integration works for a fortnight and then dies
 * with an invalid_grant nobody can reproduce.
 */
async function accessToken(admin: Admin, owner: string): Promise<string> {
  const cred = await credentialFor(admin, owner, "microsoft");
  if (!cred?.refresh_token) {
    const e = new Error("Microsoft not connected");
    (e as Error & { code?: string }).code = "not_connected";
    throw e;
  }

  const scopes = cred.scopes ?? "";
  const expiry = cred.token_expires_at ? new Date(cred.token_expires_at).getTime() : 0;
  // 60s of slack, so a token expiring mid-request is refreshed now rather than
  // failing one call in.
  if (cred.access_token && expiry > Date.now() + 60_000) {
    return cred.access_token;
  }

  const r = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("MICROSOFT_CLIENT_ID") ?? "",
      client_secret: Deno.env.get("MICROSOFT_CLIENT_SECRET") ?? "",
      refresh_token: cred.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const t = await r.json();
  if (!r.ok || !t.access_token) {
    /* Terminal, not transient. invalid_grant means access was revoked or the
       password changed; retrying turns one broken connection into a rate
       limit. The row is marked so the card can offer Reconnect. */
    console.error("microsoft token refresh failed", r.status, t?.error, t?.error_description);
    await markReauth(admin, cred.id, String(t?.error ?? "refresh failed"));
    const e = new Error("Microsoft connection expired. Please reconnect in Integrations.");
    (e as Error & { code?: string }).code = "reconnect";
    throw e;
  }

  await storeRefreshed(admin, cred, t);
  /* The legacy row too, while ten functions still read it. Dropped with the
     table. */
  await admin.from("microsoft_credentials").update({
    access_token: t.access_token,
    token_expiry: new Date(Date.now() + (t.expires_in ?? 3600) * 1000).toISOString(),
    ...(t.refresh_token ? { refresh_token: t.refresh_token } : {}),
    ...(typeof t.scope === "string" && t.scope.length ? { scopes: t.scope } : {}),
  }).eq("owner_id", owner);

  return t.access_token as string;
}
interface Attachment { filename: string; mime_type?: string; data: string }

/** "a@x.com, b@y.com" -> Graph's recipient shape. Empty in, empty out. */
const recipients = (v: string | undefined) =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((address) => ({ emailAddress: { address } }));

const graphAttachments = (files: Attachment[]) =>
  files.map((f) => ({
    "@odata.type": "#microsoft.graph.fileAttachment",
    name: f.filename,
    contentType: f.mime_type || "application/octet-stream",
    contentBytes: f.data.replace(/\s+/g, ""),
  }));

/** Base64 inflates by about a third; this is the real size on the wire. */
const bytesOf = (files: Attachment[]) =>
  files.reduce((n, f) => n + Math.ceil((f.data.replace(/\s+/g, "").length * 3) / 4), 0);

/** Microsoft's own words for "this token may not do that". */
function isScopeProblem(status: number, err: { code?: string; message?: string } | undefined): boolean {
  if (status === 403) return true;
  const code = String(err?.code ?? "");
  return code === "ErrorAccessDenied" || code === "AccessDenied" ||
    /insufficient.*(privileges|scope)/i.test(String(err?.message ?? ""));
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
    const text = String(body.text ?? body.body ?? "").trim();
    if (!to || !text) return json({ error: "to and body are required" }, 400);

    const html = body.html ? String(body.html) : undefined;
    const files: Attachment[] = (Array.isArray(body.attachments) ? body.attachments : [])
      .filter((a: Attachment) => a?.filename && a?.data);
    if (bytesOf(files) > MAX_ATTACHMENT_BYTES) {
      return json({
        error: "Outlook accepts up to 3 MB of attachments on a single message. Send the large file as a link instead.",
        failure: "too_large",
      }, 400);
    }

    /* The account is a parameter, exactly as in gmail-send: whose mailbox an EA
       sends from is an unresolved business decision, and when delegation lands
       it should be a different value passed in here rather than a rewrite. */
    const owner = String(body.from_owner ?? u.user.id);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    let token: string;
    try {
      token = await accessToken(admin, owner);
    } catch (e) {
      const code = (e as Error & { code?: string }).code;
      if (code === "not_connected") {
        return json({ error: "Outlook not connected for this account", failure: "not_connected", owner }, 400);
      }
      if (code === "reconnect") return json({ error: (e as Error).message, failure: "needs_scope" }, 400);
      throw e;
    }

    const G = "https://graph.microsoft.com/v1.0";
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    const bodyPart = html
      ? { contentType: "HTML", content: html }
      : { contentType: "Text", content: text };

    /* The id of the Outlook message being answered, which is what makes the
       reply a reply. The caller is holding it: it came down with the message. */
    const replyTo = body.reply_to_outlook_id ? String(body.reply_to_outlook_id) : "";

    let sentId: string | null = null;
    let threadId: string | null = body.thread_id ? String(body.thread_id) : null;

    if (replyTo) {
      // 1. Ask the mailbox for a reply draft. Graph fills in the threading.
      const mk = await fetch(`${G}/me/messages/${encodeURIComponent(replyTo)}/createReply`, {
        method: "POST", headers, body: "{}",
      });
      const draft = await mk.json();
      if (!mk.ok || !draft?.id) {
        console.error("createReply failed", mk.status, draft?.error?.code, draft?.error?.message);
        const scope = isScopeProblem(mk.status, draft?.error);
        return json({
          error: scope
            ? "This Microsoft connection cannot draft replies yet. Reconnect and accept the mail permissions."
            : (draft?.error?.message ?? "Outlook refused to open a reply"),
          failure: scope ? "needs_scope" : "send_failed",
          missing_scope: scope ? "https://graph.microsoft.com/Mail.ReadWrite" : undefined,
        }, mk.status);
      }

      /* 2. Replace what the draft came with. createReply pre-quotes the
            original and pre-addresses the sender; the composer has already
            built both (the quote travels inside `html`), so leaving Graph's
            version in place would quote the message twice. */
      const patch = await fetch(`${G}/me/messages/${draft.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          body: bodyPart,
          toRecipients: recipients(to),
          ccRecipients: recipients(body.cc),
          bccRecipients: recipients(body.bcc),
          ...(subject ? { subject } : {}),
        }),
      });
      if (!patch.ok) {
        const d = await patch.json().catch(() => ({}));
        console.error("draft patch failed", patch.status, d?.error?.code, d?.error?.message);
        return json({ error: d?.error?.message ?? "Outlook refused the reply", failure: "send_failed" }, patch.status);
      }

      for (const a of graphAttachments(files)) {
        const at = await fetch(`${G}/me/messages/${draft.id}/attachments`, {
          method: "POST", headers, body: JSON.stringify(a),
        });
        if (!at.ok) {
          const d = await at.json().catch(() => ({}));
          console.error("attachment failed", at.status, d?.error?.message);
          /* Stop rather than send half the attachments. A mail that arrives
             missing the file it was written about is worse than one that did
             not arrive: the sender believes it went. */
          return json({
            error: `Could not attach ${a.name}: ${d?.error?.message ?? "Outlook refused it"}`,
            failure: "send_failed",
          }, at.status);
        }
      }

      // 3. Send the draft.
      const send = await fetch(`${G}/me/messages/${draft.id}/send`, { method: "POST", headers });
      if (!send.ok) {
        const d = await send.json().catch(() => ({}));
        console.error("draft send failed", send.status, d?.error?.code, d?.error?.message);
        const scope = isScopeProblem(send.status, d?.error);
        return json({
          error: scope ? "This Microsoft connection cannot send mail yet." : (d?.error?.message ?? "send failed"),
          failure: scope ? "needs_scope" : "send_failed",
          missing_scope: scope ? SEND_SCOPE : undefined,
        }, send.status);
      }
      sentId = draft.id;
      threadId = draft.conversationId ?? threadId;
    } else {
      const send = await fetch(`${G}/me/sendMail`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          message: {
            subject: subject || "(no subject)",
            body: bodyPart,
            toRecipients: recipients(to),
            ccRecipients: recipients(body.cc),
            bccRecipients: recipients(body.bcc),
            ...(files.length ? { attachments: graphAttachments(files) } : {}),
          },
          // A sent mail the sender cannot find in their own Sent folder reads
          // as a mail that never went.
          saveToSentItems: true,
        }),
      });
      if (!send.ok) {
        const d = await send.json().catch(() => ({}));
        console.error("sendMail failed", send.status, d?.error?.code, d?.error?.message);
        const scope = isScopeProblem(send.status, d?.error);
        return json({
          error: scope ? "This Microsoft connection cannot send mail yet." : (d?.error?.message ?? "send failed"),
          failure: scope ? "needs_scope" : "send_failed",
          missing_scope: scope ? SEND_SCOPE : undefined,
        }, send.status);
      }
      /* sendMail returns 202 Accepted with an empty body: no id, by design.
         There is nothing to invent here, so the recorded row carries none. */
    }

    // Record it, so a sent mail shows in the Inbox and can reach the EOD. A
    // failure to record is reported, not swallowed: the mail DID go.
    const { error: writeErr } = await supa.from("messages").insert({
      source: "outlook",
      direction: "outbound",
      sender_name: u.user.email ?? "MadeEA",
      subject: subject || "(no subject)",
      preview: text.slice(0, 140),
      body: text,
      category: "reply",
      received_at: new Date().toISOString(),
      thread_id: threadId,
    });

    return json({ ok: true, id: sentId, thread_id: threadId, recorded: !writeErr });
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
