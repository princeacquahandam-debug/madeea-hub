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
  const { data: cred } = await admin
    .from("microsoft_credentials").select("refresh_token").eq("owner_id", ownerId).maybeSingle();
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
  // Microsoft rotates refresh tokens; keep the new one.
  await admin.from("microsoft_credentials").update({
    access_token: t.access_token,
    ...(t.refresh_token ? { refresh_token: t.refresh_token } : {}),
    token_expiry: new Date(Date.now() + Number(t.expires_in ?? 3600) * 1000).toISOString(),
  }).eq("owner_id", ownerId);
  return t.access_token;
}

const addr = (a: { emailAddress?: { address?: string; name?: string } } | undefined) => a?.emailAddress?.address ?? null;
const emails = (v: unknown): string[] =>
  (Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,;]/) : [])
    .map((x) => String(x).trim()).filter((x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)).slice(0, 50);

Deno.serve(async (req) => {
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
