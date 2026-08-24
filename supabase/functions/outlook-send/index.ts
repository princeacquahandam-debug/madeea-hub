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
 * A live access token for `owner`. Refreshes only when the cached one is spent,
 * and writes back the rotated refresh token.
 *
 * Duplicated verbatim from outlook-sync. Edge Functions here have no shared
 * module (gmail-sync and gmail-send duplicate theirs the same way): if this
 * changes, change it in both.
 */
async function accessToken(admin: Admin, owner: string): Promise<string> {
  const { data: cred, error } = await admin
    .from("microsoft_credentials")
    .select("refresh_token, access_token, token_expiry")
    .eq("owner_id", owner)
    .maybeSingle();
  if (error) {
    console.error("microsoft_credentials read failed", error.message);
    throw new Error("Could not read the Microsoft connection.");
  }
  if (!cred?.refresh_token) {
    const e = new Error("Outlook not connected");
    (e as Error & { code?: string }).code = "not_connected";
    throw e;
  }

  const expiry = cred.token_expiry ? new Date(cred.token_expiry as string).getTime() : 0;
  if (cred.access_token && expiry > Date.now() + 60_000) return cred.access_token as string;

  const r = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("MICROSOFT_CLIENT_ID") ?? "",
      client_secret: Deno.env.get("MICROSOFT_CLIENT_SECRET") ?? "",
      refresh_token: cred.refresh_token as string,
      grant_type: "refresh_token",
    }),
  });
  const t = await r.json();
  if (!r.ok || !t.access_token) {
    console.error("microsoft token refresh failed", r.status, t?.error, t?.error_description);
    const e = new Error("Microsoft connection expired. Please reconnect in Integrations.");
    (e as Error & { code?: string }).code = "reconnect";
    throw e;
  }

  const patch: Record<string, unknown> = {
    access_token: t.access_token,
    token_expiry: new Date(Date.now() + (t.expires_in ?? 3600) * 1000).toISOString(),
  };
  if (t.refresh_token) patch.refresh_token = t.refresh_token;
  if (typeof t.scope === "string" && t.scope.length) patch.scopes = t.scope;
  await admin.from("microsoft_credentials").update(patch).eq("owner_id", owner);

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
