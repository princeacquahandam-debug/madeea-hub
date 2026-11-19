// Edge Function: client-mail   (deployed with --no-verify-jwt; checks the JWT itself)
// A lead EA working a CLIENT's Outlook mailbox, with the client's permission (0086).
//
// POST { action: "sync",  client_id }                       -> { synced }
// POST { action: "body",  client_id, id }                     -> { text, html }
// POST { action: "send",  client_id, to[], cc[], subject, text, reply_to_id? } -> { ok }
//
// THE CHECK, on every call, before any token is touched: the caller is this
// client's lead EA right now, AND the client granted their mail to this very
// person (client_mail_grants.granted_to). Either failing is a 403. Nothing here
// trusts the browser for who the mailbox belongs to; it is read from the grant.
//
// WHERE IT GOES. client_mail_messages, never `messages` (0086 explains why).
// Bodies are fetched live for "body" and never stored. Every send is written
// to client_mail_audit, which the client reads in their portal.
//
// NON-INTRUSIVE BY DEFAULT. Reading does not mark anything read in the
// client's Outlook; the EA's "read" state lives only in MadeEA.

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

const TENANT = Deno.env.get("MICROSOFT_TENANT") ?? "common";
const SCOPES = "offline_access https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send";
const GRAPH = "https://graph.microsoft.com/v1.0/me";

// deno-lint-ignore no-explicit-any
type Admin = any;

async function accessToken(admin: Admin, ownerId: string): Promise<string> {
  const cred = await storedConnection(admin, ownerId, "microsoft");
  if (!cred?.refresh_token) throw new Error("The client's Outlook is no longer connected.");
  const r = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("MICROSOFT_CLIENT_ID") ?? Deno.env.get("MICROSOFT_APP_ID") ?? "",
      client_secret: Deno.env.get("MICROSOFT_CLIENT_SECRET") ?? "",
      refresh_token: cred.refresh_token,
      grant_type: "refresh_token",
      scope: SCOPES,
    }),
  });
  const t = await r.json().catch(() => ({}));
  if (!r.ok || !t.access_token) {
    console.error("client-mail token refresh failed", r.status, JSON.stringify(t));
    throw new Error("The client's Outlook connection has expired or mail access was withdrawn. Ask them to reconnect it.");
  }
  // Microsoft rotates refresh tokens; keep the new one, encrypted.
  await saveRefreshedTokens(admin, cred.id, t);
  return t.access_token;
}

const addr = (a: { emailAddress?: { address?: string; name?: string } } | undefined) => a?.emailAddress?.address ?? null;
const emails = (v: unknown): string[] =>
  (Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,;]/) : [])
    .map((x) => String(x).trim()).filter((x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)).slice(0, 50);

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
  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "unauthorized" }, 401);
    const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: u } = await supa.auth.getUser();
    if (!u?.user) return json({ error: "unauthorized" }, 401);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");
    const clientId = String(body.client_id ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(clientId)) return json({ error: "Which client?" }, 400);

    // ── THE CHECK ──
    const { data: client } = await admin.from("clients").select("id, name, lead_ea_id").eq("id", clientId).maybeSingle();
    const { data: grant } = await admin.from("client_mail_grants")
      .select("owner_id, granted_to, provider").eq("client_id", clientId).eq("provider", "microsoft").maybeSingle();
    if (!client || !grant || client.lead_ea_id !== u.user.id || grant.granted_to !== u.user.id) {
      return json({ error: "You don't have access to this client's mailbox." }, 403);
    }
    const owner = grant.owner_id as string;
    const token = await accessToken(admin, owner);
    const graph = (path: string, init: RequestInit = {}) =>
      fetch(`${GRAPH}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });

    if (action === "sync") {
      const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 200);
      const items: Record<string, any>[] = [];
      let next: string | undefined = `/mailFolders/inbox/messages?${new URLSearchParams({
        $top: String(Math.min(limit, 50)), $orderby: "receivedDateTime desc",
        $select: "id,subject,bodyPreview,from,toRecipients,ccRecipients,receivedDateTime,conversationId,isRead",
      })}`;
      while (next && items.length < limit) {
        const res: Response = next.startsWith("http")
          ? await fetch(next, { headers: { Authorization: `Bearer ${token}` } })
          : await graph(next);
        if (!res.ok) {
          console.error("client-mail list failed", res.status, (await res.text()).slice(0, 400));
          return json({ error: res.status === 403 ? "Outlook refused: the client hasn't allowed mail access." : "Outlook refused the request. Try again in a minute." }, 502);
        }
        const d = await res.json();
        items.push(...(d.value ?? []));
        next = d["@odata.nextLink"];
      }
      let synced = 0;
      for (const m of items.slice(0, limit)) {
        const name = m.from?.emailAddress?.name || addr(m.from) || "Unknown";
        const { error } = await admin.from("client_mail_messages").upsert({
          client_id: clientId, owner_id: owner, provider: "microsoft",
          external_id: m.id, thread_id: m.conversationId ?? null, direction: "inbound",
          sender_name: name, sender_email: addr(m.from),
          to_emails: (m.toRecipients ?? []).map(addr).filter(Boolean),
          cc_emails: (m.ccRecipients ?? []).map(addr).filter(Boolean),
          subject: m.subject ?? "(no subject)", preview: m.bodyPreview ?? "",
          received_at: m.receivedDateTime ?? new Date().toISOString(),
        }, { onConflict: "owner_id,provider,external_id", ignoreDuplicates: false });
        if (error) console.error("client mail upsert", error.message); else synced++;
      }
      return json({ synced });
    }

    if (action === "body") {
      const id = String(body.id ?? "");
      const { data: row } = await admin.from("client_mail_messages")
        .select("id, external_id").eq("id", id).eq("client_id", clientId).maybeSingle();
      if (!row?.external_id) return json({ error: "That message isn't in this mailbox." }, 404);
      const res = await graph(`/messages/${encodeURIComponent(row.external_id)}?$select=body,uniqueBody`, {
        headers: { Prefer: 'outlook.body-content-type="text"' },
      });
      if (!res.ok) return json({ error: "Outlook couldn't open that message. It may have been deleted." }, 502);
      const d = await res.json();
      await admin.from("client_mail_messages").update({ is_read: true }).eq("id", row.id);
      return json({ text: String(d.body?.content ?? "").slice(0, 200_000) });
    }

    if (action === "send") {
      const to = emails(body.to), cc = emails(body.cc);
      const subject = String(body.subject ?? "").slice(0, 400);
      const text = String(body.text ?? "").slice(0, 100_000);
      if (!text.trim()) return json({ error: "Write a message first." }, 400);
      const replyId = body.reply_to_id ? String(body.reply_to_id) : null;

      // Opt-outs are the agency's list, so they are checked as the EA (0079). Fails closed.
      const { data: opt, error: optErr } = await supa.rpc("do_not_contact_match", {
        p_emails: [...to, ...cc], p_phones: [], p_instagram: [], p_ghl: [],
      });
      if (optErr) return json({ error: "Not sent: the do-not-contact list couldn't be checked just now." }, 503);
      if (Array.isArray(opt) && opt.length) return json({ error: `Not sent: ${opt[0].value} asked not to be contacted.` }, 409);

      let action2: "sent" | "replied" = "sent";
      let threadId: string | null = null;
      let recipients = to;
      if (replyId) {
        const { data: row } = await admin.from("client_mail_messages")
          .select("external_id, thread_id, sender_email").eq("id", replyId).eq("client_id", clientId).maybeSingle();
        if (!row?.external_id) return json({ error: "The message you're replying to isn't in this mailbox." }, 404);
        threadId = row.thread_id;
        // Graph's reply keeps the thread and quotes the original; the comment is the EA's text.
        const res = await graph(`/messages/${encodeURIComponent(row.external_id)}/reply`, {
          method: "POST",
          body: JSON.stringify({
            comment: text,
            ...(to.length || cc.length ? { message: {
              ...(to.length ? { toRecipients: to.map((a) => ({ emailAddress: { address: a } })) } : {}),
              ...(cc.length ? { ccRecipients: cc.map((a) => ({ emailAddress: { address: a } })) } : {}),
            } } : {}),
          }),
        });
        if (!res.ok) {
          console.error("client-mail reply failed", res.status, (await res.text()).slice(0, 400));
          return json({ error: "Outlook didn't send the reply." }, 502);
        }
        action2 = "replied";
        if (!recipients.length && row.sender_email) recipients = [row.sender_email];
      } else {
        if (!to.length) return json({ error: "Who is it to?" }, 400);
        const res = await graph(`/sendMail`, {
          method: "POST",
          body: JSON.stringify({
            message: {
              subject,
              body: { contentType: "Text", content: text },
              toRecipients: to.map((a) => ({ emailAddress: { address: a } })),
              ccRecipients: cc.map((a) => ({ emailAddress: { address: a } })),
            },
            saveToSentItems: true,
          }),
        });
        if (!res.ok) {
          console.error("client-mail send failed", res.status, (await res.text()).slice(0, 400));
          return json({ error: "Outlook didn't send it." }, 502);
        }
      }

      // The client's record of what went out in their name (0086), then the EA's own view.
      await admin.from("client_mail_audit").insert({
        client_id: clientId, owner_id: owner, actor_id: u.user.id, action: action2,
        to_emails: [...recipients, ...cc], subject: subject || null,
      });
      await admin.from("client_mail_messages").insert({
        client_id: clientId, owner_id: owner, provider: "microsoft", external_id: null, thread_id: threadId,
        direction: "outbound", sender_name: client.name, sender_email: null,
        to_emails: recipients, cc_emails: cc, subject: subject || null, preview: text.slice(0, 240),
        received_at: new Date().toISOString(), is_read: true, sent_by: u.user.id,
      });
      return json({ ok: true });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
