// Edge Function: teams-sync   (Verify JWT: ON)
// Pulls the signed-in user's recent Teams chats into the messages table.
//
// NO SECOND CONNECTION. This runs on the credential microsoft-oauth-claim
// already stored: connecting Outlook and connecting Teams are the same consent,
// which is why the Teams card says "connected through Microsoft" rather than
// offering its own button. What it does need is two extra scopes, so an account
// connected before Teams existed has to reconnect once. This function detects
// that and says so, rather than returning an empty inbox.
//
// CHATS, NOT CHANNELS, and the difference is not cosmetic. Reading a Teams
// CHANNEL needs ChannelMessage.Read.All, which is admin-consent-only and
// tenant-wide: one click by an IT admin grants this app every channel message
// in the organisation. Chat.Read is delegated and personal, so it reads exactly
// what the signed-in person can already read and nothing else. Chats are also
// where client conversation actually happens. If channels are wanted later they
// are a deliberate, separately-consented addition, not something to smuggle in
// under the same button.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const TENANT = Deno.env.get("MICROSOFT_TENANT") ?? "common";
const CHAT_SCOPE = "Chat.Read";

type Admin = ReturnType<typeof createClient>;

/**
 * A live access token for `owner`, refreshing only when the cached one is spent
 * and writing back the rotated refresh token.
 *
 * Third copy of this, after outlook-sync and outlook-send. Edge Functions here
 * have no shared module: if the refresh handling changes, it changes in all
 * three.
 */
async function accessToken(admin: Admin, owner: string): Promise<{ token: string; scopes: string }> {
  const { data: cred, error } = await admin
    .from("microsoft_credentials")
    .select("refresh_token, access_token, token_expiry, scopes")
    .eq("owner_id", owner)
    .maybeSingle();
  if (error) {
    console.error("microsoft_credentials read failed", error.message);
    throw new Error("Could not read the Microsoft connection.");
  }
  if (!cred?.refresh_token) {
    const e = new Error("Microsoft not connected");
    (e as Error & { code?: string }).code = "not_connected";
    throw e;
  }

  const scopes = String(cred.scopes ?? "");
  const expiry = cred.token_expiry ? new Date(cred.token_expiry as string).getTime() : 0;
  if (cred.access_token && expiry > Date.now() + 60_000) {
    return { token: cred.access_token as string, scopes };
  }

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

  return { token: t.access_token as string, scopes: typeof t.scope === "string" ? t.scope : scopes };
}

interface GraphIdentity { displayName?: string; id?: string }
interface GraphChatMessage {
  id: string;
  chatId?: string;
  createdDateTime?: string;
  messageType?: string;
  from?: { user?: GraphIdentity | null; application?: GraphIdentity | null };
  body?: { content?: string; contentType?: string };
  deletedDateTime?: string | null;
}
interface GraphChat {
  id: string;
  topic?: string | null;
  chatType?: string;
  members?: { displayName?: string; email?: string; userId?: string }[];
}

const ini = (n: string) => n.split(/[ .]/).map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();

/* Teams message bodies are HTML. Stripped to text for the preview and the
   stored body, because everything downstream (search, triage, the EOD, the
   list row) reads plain prose, and a stored <div> is a thing every one of them
   would have to learn to ignore. */
function toText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** A chat's name: its topic, or whoever is in it. A group chat with no topic
    otherwise shows as a GUID, which tells the reader nothing. */
function chatName(chat: GraphChat, myName: string): string {
  if (chat.topic) return chat.topic;
  const others = (chat.members ?? [])
    .map((m) => m.displayName)
    .filter((n): n is string => Boolean(n) && n !== myName);
  if (others.length === 1) return others[0];
  if (others.length > 1) return `${others.slice(0, 2).join(", ")}${others.length > 2 ? ` +${others.length - 2}` : ""}`;
  return "Teams chat";
}

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

    const body = await req.json().catch(() => ({}));
    const chatLimit = Math.min(Math.max(Number(body.chats ?? 15), 1), 30);
    const perChat = Math.min(Math.max(Number(body.limit ?? 10), 1), 50);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    let token: string, scopes: string;
    try {
      ({ token, scopes } = await accessToken(admin, u.user.id));
    } catch (e) {
      const code = (e as Error & { code?: string }).code;
      if (code === "not_connected") {
        return json({ error: "Microsoft is not connected. Connect Outlook first; Teams uses the same sign-in.", failure: "not_connected" }, 400);
      }
      if (code === "reconnect") return json({ error: (e as Error).message, failure: "reconnect" }, 400);
      throw e;
    }

    /* Checked BEFORE calling Graph, unlike the send path in gmail-send which
       deliberately lets the provider decide. The difference is what a refusal
       costs: a send that Graph rejects tells you something true, while a chat
       list that Graph rejects for a missing scope returns a 403 whose message
       ("Access denied") does not mention which scope or how to get it. Here the
       record is the better answer, and it came from Microsoft itself at consent
       time rather than from a local constant. */
    if (scopes && !scopes.includes(CHAT_SCOPE)) {
      return json({
        error: "This Microsoft connection was made before Teams was supported. Reconnect Outlook once and accept the Teams permissions.",
        failure: "needs_scope",
        missing_scope: CHAT_SCOPE,
      }, 400);
    }

    const meRes = await fetch("https://graph.microsoft.com/v1.0/me?$select=displayName", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const myName = (await meRes.json().catch(() => ({})))?.displayName ?? "";

    const chatsRes = await fetch(
      `https://graph.microsoft.com/v1.0/me/chats?$top=${chatLimit}&$expand=members`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const chatsBody = await chatsRes.json();
    if (!chatsRes.ok) {
      const detail = chatsBody?.error?.message ?? "Teams refused the chat list";
      console.error("graph chats failed", chatsRes.status, chatsBody?.error?.code, detail);
      const scopeProblem = chatsRes.status === 403 || chatsBody?.error?.code === "Authorization_RequestDenied";
      return json({
        error: scopeProblem
          ? "This Microsoft connection cannot read Teams chats. Reconnect Outlook and accept the Teams permissions."
          : detail,
        failure: scopeProblem ? "needs_scope" : "list_failed",
      }, chatsRes.status);
    }

    const chats: GraphChat[] = chatsBody.value ?? [];
    let synced = 0;
    let skipped = 0;
    const names: string[] = [];
    const errors: string[] = [];

    for (const chat of chats) {
      const label = chatName(chat, myName);
      const res = await fetch(
        `https://graph.microsoft.com/v1.0/chats/${chat.id}/messages?$top=${perChat}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const page = await res.json();
      if (!res.ok) {
        // One inaccessible chat (a meeting chat that has expired, a chat the
        // user was removed from) must not stop the rest.
        errors.push(`${label}: ${page?.error?.message ?? res.status}`);
        continue;
      }
      names.push(label);

      for (const m of (page.value ?? []) as GraphChatMessage[]) {
        /* systemEventMessage is "X was added to the chat" and friends; a
           deleted message comes back as a tombstone with no body. Neither is
           correspondence. */
        if (m.messageType && m.messageType !== "message") { skipped++; continue; }
        if (m.deletedDateTime) { skipped++; continue; }

        const text = toText(m.body?.content ?? "");
        if (!text) { skipped++; continue; }

        const sender = m.from?.user?.displayName ?? m.from?.application?.displayName ?? "Teams user";
        const { error } = await supa.from("messages").upsert(
          {
            teams_id: m.id,
            source: "teams",
            sender_name: sender,
            /* Graph does not put an address on a chat message: `from.user` is a
               display name and a directory id. Left null rather than guessed
               at, which is also why a Teams message is answered in Teams
               rather than by email. */
            sender_email: null,
            sender_initials: ini(sender),
            subject: label,
            preview: text.slice(0, 140),
            body: text,
            category: "reply",
            received_at: m.createdDateTime ?? new Date().toISOString(),
            // The chat id, which is what a reply is posted back to.
            thread_id: m.chatId ?? chat.id,
          },
          { onConflict: "workspace_id,teams_id" },
        );
        if (error) errors.push(`${label}: ${error.message}`);
        else synced++;
      }
    }

    return json({
      synced,
      skipped,
      chats: chats.length,
      chat_names: names.slice(0, 10),
      errors: errors.length ? errors.slice(0, 5) : undefined,
    });
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
