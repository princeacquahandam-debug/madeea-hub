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
// ── Who decides whether this token may send ───────────────────────────────
// Google does, not us. This function does NOT pre-check the stored scope list:
// that list is a record and a record can be stale, and a stale record that
// blocks a send the account is entitled to make is worse than no record.
//
// It attempts the send and interprets Google's refusal. A missing gmail.send
// comes back as needs_scope with the exact scope named; anything else is
// reported as the real failure it is. It never pretends to have sent, and it
// never refuses on its own guess.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

/* ── STORED TOKENS, ENCRYPTED (CASA pre-check, 19 Nov 2026) ───────────────
   The connection is read from `integrations`, where tokens are AES-256-GCM
   ciphertext, base64(iv || ciphertext || tag), with the key in
   INTEGRATION_ENCRYPTION_KEY and never in the database. This function used to
   read the plain-text copy in google_credentials / microsoft_credentials,
   which the old sign-in kept writing alongside; those copies are being wiped.
   Same scheme as gmail-sync's token manager. Edge Functions here are deployed
   one file at a time, so it is repeated in each function that needs it. */
async function tokAesKey(usage: KeyUsage[]) {
  const raw = Deno.env.get("INTEGRATION_ENCRYPTION_KEY");
  if (!raw) throw new Error("INTEGRATION_ENCRYPTION_KEY is not configured");
  return await crypto.subtle.importKey(
    "raw", Uint8Array.from(atob(raw), (c) => c.charCodeAt(0)),
    { name: "AES-GCM" }, false, usage,
  );
}

async function tokEncrypt(plain: string): Promise<string> {
  const key = await tokAesKey(["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain)),
  );
  const out = new Uint8Array(iv.length + cipher.length);
  out.set(iv);
  out.set(cipher, iv.length);
  return btoa(String.fromCharCode(...out));
}

async function tokDecrypt(payload: string | null | undefined): Promise<string | null> {
  if (!payload) return null;
  try {
    const key = await tokAesKey(["decrypt"]);
    const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, key, bytes.slice(12));
    return new TextDecoder().decode(plain);
  } catch {
    // Encrypted under a key that has since changed: same fix as no connection, reconnect.
    console.error("could not decrypt a stored token; the encryption key may have changed");
    return null;
  }
}

/** This person's own connection for a provider: refresh token decrypted, plus the granted scopes.
    user_id and provider, always both. Rows without a stored token (0058's
    reauth placeholders) and disconnected rows are skipped. Oldest first, the
    same choice gmail-sync makes, so send and sync use the same account. */
// deno-lint-ignore no-explicit-any
async function storedConnection(admin: any, userId: string, provider: "google" | "microsoft"):
  Promise<{ id: string; refresh_token: string | null; scopes: string | null } | null> {
  const { data, error } = await admin
    .from("integrations")
    .select("id, refresh_token_encrypted, scopes")
    .eq("user_id", userId)
    .eq("provider", provider)
    .neq("status", "disconnected")
    .not("refresh_token_encrypted", "is", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("integrations read failed", error.message);
    throw new Error("Could not read the connection.");
  }
  if (!data) return null;
  return {
    id: data.id as string,
    refresh_token: await tokDecrypt(data.refresh_token_encrypted as string | null),
    scopes: (data.scopes as string | null) ?? null,
  };
}

/** Keep a refreshed token, encrypted. Microsoft rotates refresh tokens; Google does not. */
// deno-lint-ignore no-explicit-any
async function saveRefreshedTokens(admin: any, connectionId: string,
  t: { access_token: string; refresh_token?: string | null; expires_in?: number | string | null }) {
  const patch: Record<string, unknown> = {
    access_token_encrypted: await tokEncrypt(t.access_token),
    token_expires_at: new Date(Date.now() + Number(t.expires_in ?? 3600) * 1000).toISOString(),
    status: "connected",
    last_error: null,
    updated_at: new Date().toISOString(),
  };
  if (t.refresh_token) patch.refresh_token_encrypted = await tokEncrypt(t.refresh_token);
  await admin.from("integrations").update(patch).eq("id", connectionId);
}


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

export interface Attachment {
  filename: string;
  /** MIME type. Falls back to a safe generic rather than guessing. */
  mime_type?: string;
  /** Base64, already encoded by the browser. */
  data: string;
}

const b64 = (s: string) => btoa(unescape(encodeURIComponent(s)));

/** Base64 wrapped at 76 chars, which is what RFC 2045 requires of a body. */
function wrap(data: string): string {
  return (data.match(/.{1,76}/g) ?? []).join("\r\n");
}

/**
 * Build the whole RFC 2822 message. Gmail wants the message, not fields.
 *
 * THE SHAPE DEPENDS ON WHAT IS ACTUALLY IN IT, and picking the smallest
 * structure that fits matters: a plain note wrapped in multipart/mixed shows up
 * in some older clients as an empty message with a mysterious attachment.
 *
 *   text only                 text/plain
 *   text + html               multipart/alternative
 *   anything + attachments    multipart/mixed wrapping the above
 *
 * The plain-text part is never dropped when HTML is present. It is what a
 * screen reader, a watch, a plain-text client and most auto-responders actually
 * read, and an HTML-only mail is a blank message to all of them.
 */
function rawMessage(opts: {
  to: string; subject: string; text: string; html?: string;
  from?: string; cc?: string; bcc?: string;
  inReplyTo?: string; references?: string;
  attachments?: Attachment[];
}): string {
  const { to, subject, text, html, from, cc, bcc, inReplyTo, references } = opts;
  const files = (opts.attachments ?? []).filter((a) => a?.filename && a?.data);

  const mixed = `mixed_${crypto.randomUUID()}`;
  const alt = `alt_${crypto.randomUUID()}`;

  const headers = [
    from ? `From: ${from}` : null,
    `To: ${to}`,
    cc ? `Cc: ${cc}` : null,
    bcc ? `Bcc: ${bcc}` : null,
    /* What actually makes a reply a reply.
       Gmail's threadId groups the message in OUR sent mailbox, but every other
       mail client threads on these two headers. Without them the recipient sees
       a brand new conversation whose subject happens to start with "Re:", which
       is how one conversation quietly becomes two. */
    inReplyTo ? `In-Reply-To: ${inReplyTo}` : null,
    references ? `References: ${references}` : null,
    // Encoded, so a subject with an accent or a non-ASCII character survives.
    `Subject: =?UTF-8?B?${b64(subject)}?=`,
    "MIME-Version: 1.0",
  ].filter((h): h is string => h !== null);

  const plainPart = [
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrap(b64(text)),
  ].join("\r\n");

  const htmlPart = html
    ? [
        'Content-Type: text/html; charset="UTF-8"',
        "Content-Transfer-Encoding: base64",
        "",
        wrap(b64(html)),
      ].join("\r\n")
    : null;

  // The body, before any attachments are considered.
  let contentType: string;
  let content: string;

  if (htmlPart) {
    contentType = `multipart/alternative; boundary="${alt}"`;
    content = [
      `--${alt}`, plainPart,
      `--${alt}`, htmlPart,
      `--${alt}--`,
    ].join("\r\n");
  } else {
    contentType = 'text/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: base64';
    content = wrap(b64(text));
  }

  if (files.length === 0) {
    /* The blank line between headers and body IS the message format. This was
       once built with `.filter(Boolean)`, and "" is falsy, so the separator was
       deleted, everything parsed as headers, and Gmail accepted a message with
       no body and returned a real id. It reported success and delivered an
       empty email, which is the worst kind of failure: it looks like it worked
       at both ends. Joined explicitly ever since. */
    const message = [...headers, `Content-Type: ${contentType}`].join("\r\n") + "\r\n\r\n" + content;
    return urlSafe(message);
  }

  const parts = [
    `--${mixed}`,
    `Content-Type: ${contentType}`,
    "",
    content,
    ...files.flatMap((f) => [
      `--${mixed}`,
      // Quoted, or a filename containing a space truncates at the space and
      // arrives as a file with no extension that nothing will open.
      `Content-Type: ${f.mime_type || "application/octet-stream"}; name="${f.filename}"`,
      `Content-Disposition: attachment; filename="${f.filename}"`,
      "Content-Transfer-Encoding: base64",
      "",
      wrap(f.data.replace(/\s+/g, "")),
    ]),
    `--${mixed}--`,
  ];

  const message =
    [...headers, `Content-Type: multipart/mixed; boundary="${mixed}"`].join("\r\n") +
    "\r\n\r\n" +
    parts.join("\r\n");

  return urlSafe(message);
}

/** Gmail wants base64url of the whole message. */
function urlSafe(message: string): string {
  return btoa(unescape(encodeURIComponent(message)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/* DO NOT CONTACT (migration 0079). Checked before anything leaves.
   An opt-out used to live only where it was said, so a person who replied STOP
   to a text could still be messaged from here. Fails CLOSED: if the list can't
   be read, nothing is sent. A delayed reply costs minutes; a message to
   someone who said stop is the one mistake here with a legal edge.
   Inlined rather than shared because each function here deploys standalone. */
async function optedOut(
  // deno-lint-ignore no-explicit-any
  db: any,
  ids: { emails?: string[]; phones?: string[]; instagram?: string[] },
): Promise<string | null> {
  const { data, error } = await db.rpc("do_not_contact_match", {
    p_emails: ids.emails ?? [],
    p_phones: ids.phones ?? [],
    p_instagram: ids.instagram ?? [],
    p_ghl: [],
  });
  if (error) {
    console.error("do-not-contact check failed", error.message);
    return "Not sent: the do-not-contact list couldn't be checked just now. Try again in a moment.";
  }
  const m = (data as { created_at?: string; source?: string }[] | null)?.[0];
  if (!m) return null;
  const when = m.created_at
    ? new Date(m.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : "earlier";
  const via: Record<string, string> = {
    sms: "by text", instagram: "on Instagram", whatsapp: "on WhatsApp", email: "by email", manual: "via the team",
  };
  return `Not sent: this person asked not to be contacted (${when}, ${via[m.source ?? ""] ?? ""}). ` +
    "If they've opted back in, an admin can lift it in Settings → Do not contact.";
}

/** Every address in a To/Cc/Bcc string ("Ann <ann@x.com>, bob@y.com"). */
const addressesIn = (...fields: unknown[]) =>
  fields.flatMap((f) => String(f ?? "").match(/[^\s<>,;"'()]+@[^\s<>,;"'()]+/g) ?? []);


/* ── WHICH WEBSITES MAY CALL THIS (CASA pre-check, 19 Nov 2026) ──────────
   Responses used to say "Access-Control-Allow-Origin: *", which lets a page
   on any website call this function from a visitor's browser. The caller's
   sign-in is still checked below, so it was low risk, but there is no reason
   to allow it. Now only MadeEA's own sites get the header back: the
   addresses in APP_ORIGINS (the same setting integration-oauth-url uses)
   plus the defaults here. Any other site's browser gets no CORS permission
   and stops. Calls with no Origin header (n8n, webhooks, server to server)
   are not browser calls and are unaffected. */
const ALLOWED_ORIGINS = new Set([
  "https://hub.madeea.io",
  "https://hub.madeeas.com",
  "https://madeea-hub.vercel.app",
  "https://academy.madeea.io",
  ...(Deno.env.get("APP_ORIGINS") ?? "").split(",").map((o) => o.trim()).filter(Boolean),
]);

function withAllowedOrigin(req: Request, res: Response): Response {
  if (res.headers.get("Access-Control-Allow-Origin") !== "*") return res;
  const headers = new Headers(res.headers);
  const origin = req.headers.get("Origin") ?? "";
  if (ALLOWED_ORIGINS.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.append("Vary", "Origin");
  } else {
    headers.delete("Access-Control-Allow-Origin");
  }
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

function serveWithOrigins(handler: (req: Request) => Response | Promise<Response>) {
  return Deno.serve(async (req: Request) => withAllowedOrigin(req, await handler(req)));
}

serveWithOrigins(async (req) => {
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
    /* `body` is the original field name and stays supported; `text` reads
       better next to `html` and is what the composer sends. Accepting both
       means the rich composer and every existing caller work unchanged. */
    const text = String(body.text ?? body.body ?? "").trim();
    if (!to || !text) return json({ error: "to and body are required" }, 400);
    const blocked = await optedOut(supa, { emails: addressesIn(to, body.cc, body.bcc) });
    if (blocked) return json({ error: blocked, failure: "opted_out" }, 409);


    /* The account is a parameter. Defaults to the caller, and a future
       delegation model passes a different owner rather than changing this. */
    /* SEND AS SOMEONE ELSE IS NOT ALLOWED (YET).
       from_owner came straight from the request and was never checked, so any
       signed-in account could send from any other person's connected Gmail
       by naming their user id. Until a real delegation rule exists (a client's
       lead EA, checked server-side), the only mailbox you can send from is
       your own. */
    if (body.from_owner != null && String(body.from_owner) !== u.user.id) {
      return json({ error: "You can only send from your own mailbox." }, 403);
    }
    const owner = String(body.from_owner ?? u.user.id);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const cred = await storedConnection(admin, owner, "google");

    if (!cred?.refresh_token) {
      return json({ error: "Google not connected for this account", failure: "not_connected", owner }, 400);
    }

    /* Deliberately NOT pre-checking cred.scopes.
       That was here, and it was wrong. The stored scope list is a record, and a
       record can be stale: the callback used to save a local constant rather
       than what Google returned, so an account that HAD been granted send was
       recorded as read-only and this function refused a send Google would have
       accepted. A cached permission that blocks a real one is worse than no
       cache at all.

       Google is the authority on what this token may do, so we ask Google by
       attempting it, and interpret the refusal below. The record is still read,
       but only to explain the failure afterwards. */
    const token = await accessToken(cred.refresh_token);

    /* Threading is passed in rather than looked up: the caller is holding the
       message being replied to, and re-fetching it here to read one header
       would be a second round trip for something already on screen. */
    const inReplyTo = body.in_reply_to ? String(body.in_reply_to) : undefined;
    const references = body.references
      ? String(body.references)
      : inReplyTo; // A first reply's ancestry is just its parent.

    const raw = rawMessage({
      to,
      subject: subject || "(no subject)",
      text,
      html: body.html ? String(body.html) : undefined,
      from: body.from ? String(body.from) : undefined,
      cc: body.cc ? String(body.cc) : undefined,
      bcc: body.bcc ? String(body.bcc) : undefined,
      inReplyTo,
      references,
      attachments: Array.isArray(body.attachments) ? body.attachments : [],
    });

    const send = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw, ...(body.thread_id ? { threadId: body.thread_id } : {}) }),
    });
    const sent = await send.json();
    if (!send.ok) {
      const reason = String(sent?.error?.status ?? sent?.error?.message ?? "send failed");
      /* Google's own words for "this token lacks gmail.send". Anything else is
         a real send failure and should not be dressed up as a permission
         problem, because the fixes are completely different. */
      const scopeProblem =
        reason.includes("SCOPE") || reason.includes("insufficient") ||
        (sent?.error?.details ?? []).some((d: { reason?: string }) => d.reason === "ACCESS_TOKEN_SCOPE_INSUFFICIENT");
      return json({
        error: scopeProblem ? "This Google connection cannot send mail yet." : reason,
        failure: scopeProblem ? "needs_scope" : "send_failed",
        missing_scope: scopeProblem ? SEND_SCOPE : undefined,
        // What the record claims, so a mismatch between this and Google's
        // answer is visible rather than mysterious.
        recorded_scopes: cred.scopes,
        detail: sent?.error,
      }, send.status);
    }

    /* Written as the caller, with one detail for PostHog's message_sent
       (0094): whether the reply started from an AI draft. The trigger reads
       it from this header; nothing about it is stored. */
    const recorder = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth, "x-madeea-ph": JSON.stringify({ ai_drafted: body.ai_drafted === true }) } },
    });
    // Record it, so a sent mail shows in the Communication Center and can reach
    // the EOD. A failure to record is reported, not swallowed: the mail DID go.
    const { error: writeErr } = await recorder.from("messages").insert({
      source: "gmail",
      direction: "outbound",
      sender_name: u.user.email ?? "MadeEA",
      subject: subject || "(no subject)",
      preview: text.slice(0, 140),
      body: text,
      category: "reply",
      received_at: new Date().toISOString(),
      // So the sent copy sits in the same conversation in our own list, not
      // just in Gmail's.
      thread_id: sent.threadId ?? (body.thread_id ? String(body.thread_id) : null),
    });

    return json({ ok: true, id: sent.id, thread_id: sent.threadId, recorded: !writeErr });
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
