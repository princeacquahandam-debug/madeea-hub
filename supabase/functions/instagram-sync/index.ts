// Edge Function: instagram-sync   (Verify JWT: ON, the default. Auth is ALSO enforced in code,
// so this is safe either way; leaving verification on is simply stricter. Only
// the two endpoints an outsider calls directly need it off: the OAuth callback
// and whatsapp-webhook.)
// Pulls recent Instagram DM threads into the messages table.
//
// Instagram is the one Meta channel with a read API. /{page}/conversations with
// platform=instagram lists the threads, and each carries its messages, so this
// behaves like every other sync on the grid rather than like WhatsApp, which
// has no history endpoint at all.
//
// WHAT A REPLY NEEDS, and why it is stored per row. An Instagram reply is
// addressed to an IGSID: a per-app scoped id for the person, which is not their
// handle and cannot be worked out from it. It arrives on the message and
// nowhere else, so if this function does not record it the conversation becomes
// unanswerable the moment it leaves the screen. It goes in `reply_target`
// (0050), never in sender_email.
//
// WHAT MAKES A MESSAGE "OURS". Meta reports both sides of a thread, and the
// Page is one of them. A message whose sender is the Page id is something we
// sent, so it is stored as outbound rather than dropped: an inbox showing only
// the client's half of a conversation reads as though nobody replied.
//
// ENV
//   META_PAGE_ID, META_PAGE_ACCESS_TOKEN

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const GRAPH = "https://graph.facebook.com/v21.0";

async function graph(path: string, token: string) {
  const r = await fetch(`${GRAPH}${path}${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`);
  const body = await r.json().catch(() => null);
  if (!r.ok) {
    const e = body?.error;
    const err = new Error(`${e?.message ?? r.status}${e?.code ? ` (code ${e.code})` : ""}`);
    (err as Error & { code?: number }).code = e?.code;
    throw err;
  }
  return body;
}

const ini = (n: string) => n.split(/[ ._]/).map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();

interface Participant { id: string; username?: string; name?: string }
interface IgMessage {
  id: string;
  created_time?: string;
  message?: string;
  from?: Participant;
  to?: { data?: Participant[] };
}
interface Conversation {
  id: string;
  updated_time?: string;
  participants?: { data?: Participant[] };
  messages?: { data?: IgMessage[] };
}


/**
 * The caller's own meta connection, decrypted.
 *
 * PER PERSON, not per workspace. This used to read workspace_integrations,
 * where one row served the whole team: the second colleague to connect
 * overwrote the first, and everybody sent through whichever account was
 * attached last. The lookup now takes the user as well, which is the rule 0058
 * exists to enforce — a caller who does not know who is asking cannot use it.
 *
 * Tokens are AES-256-GCM at rest, so this decrypts on the way out. A row
 * written under a key that has since changed reports as "no credential" rather
 * than crashing: the fix is the one the card already offers, which is
 * reconnect.
 *
 * The environment variables remain the fallback for a deployment configured
 * before install flows existed, and disappear with them.
 */
async function integration(admin: ReturnType<typeof createClient>, userId: string) {
  const { data: m } = await admin
    .from("memberships").select("workspace_id").eq("user_id", userId).limit(1).maybeSingle();
  if (!m?.workspace_id) return null;

  const { data } = await admin
    .from("integrations")
    .select("id, access_token_encrypted, metadata, provider_account_name, status")
    .eq("workspace_id", m.workspace_id)
    .eq("user_id", userId)
    .eq("provider", "meta")
    .neq("status", "disconnected")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!data) return null;

  let access_token: string | null = null;
  const payload = data.access_token_encrypted as string | null;
  if (payload) {
    try {
      const raw = Deno.env.get("INTEGRATION_ENCRYPTION_KEY");
      if (!raw) throw new Error("INTEGRATION_ENCRYPTION_KEY is not configured");
      const key = await crypto.subtle.importKey(
        "raw", Uint8Array.from(atob(raw), (c) => c.charCodeAt(0)),
        { name: "AES-GCM" }, false, ["decrypt"],
      );
      const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
      const plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: bytes.slice(0, 12) }, key, bytes.slice(12),
      );
      access_token = new TextDecoder().decode(plain);
    } catch {
      // Never the ciphertext, never the key: just that it could not be read.
      console.error("could not decrypt the stored meta token");
    }
  }

  return {
    access_token,
    account_label: (data.provider_account_name as string | null) ?? null,
    details: (data.metadata ?? {}) as Record<string, string | null>,
  };
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

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const conn = await integration(admin, u.user.id);
    const pageId = conn?.details?.page_id ?? Deno.env.get("META_PAGE_ID");
    const token = conn?.access_token ?? Deno.env.get("META_PAGE_ACCESS_TOKEN");
    if (!pageId || !token) {
      return json({ error: "Instagram is not connected. Press Connect on the Instagram card.", configured: false }, 400);
    }

    const body = await req.json().catch(() => ({}));
    const threads = Math.min(Math.max(Number(body.threads ?? 20), 1), 50);
    const perThread = Math.min(Math.max(Number(body.limit ?? 15), 1), 50);

    /* The IG account id, so a message sent BY us can be told from one sent TO
       us. Asked for rather than assumed: the Page id and the Instagram id are
       different numbers, and the sender on an Instagram thread is the latter. */
    let igId: string | null = null;
    try {
      const page = await graph(`/${pageId}?fields=instagram_business_account{id,username}`, token);
      igId = page?.instagram_business_account?.id ?? null;
      if (!igId) {
        return json({
          error: "This Page has no Instagram Professional account linked, so there is nothing to read.",
          failure: "not_linked",
        }, 400);
      }
    } catch (e) {
      const code = (e as Error & { code?: number }).code;
      return json({
        error: e instanceof Error ? e.message : String(e),
        // 190 expired/revoked, 200/10/3 permission. Different fixes, said apart.
        failure: code === 190 ? "token_expired" : code === 200 || code === 10 ? "needs_scope" : "list_failed",
      }, 400);
    }

    let conversations: Conversation[];
    try {
      const res = await graph(
        `/${pageId}/conversations?platform=instagram&limit=${threads}` +
          `&fields=id,updated_time,participants,messages.limit(${perThread}){id,created_time,message,from,to}`,
        token,
      );
      conversations = res?.data ?? [];
    } catch (e) {
      const code = (e as Error & { code?: number }).code;
      return json({
        error: e instanceof Error ? e.message : String(e),
        failure: code === 190 ? "token_expired" : code === 200 || code === 10 ? "needs_scope" : "list_failed",
      }, 400);
    }

    let synced = 0;
    let skipped = 0;
    const people: string[] = [];
    const errors: string[] = [];

    for (const c of conversations) {
      // Whoever is not us. Their handle is the subject line, because "@someone"
      // is how an Instagram conversation is identified by the person reading it.
      const other = (c.participants?.data ?? []).find((p) => p.id !== igId);
      const handle = other?.username ? `@${other.username}` : (other?.name ?? "Instagram");
      if (other) people.push(handle);

      for (const m of c.messages?.data ?? []) {
        const text = (m.message ?? "").trim();
        // Story replies, reactions and media-only messages arrive with no text.
        if (!text) { skipped++; continue; }

        const outbound = m.from?.id === igId;
        const person = outbound ? handle : (m.from?.username ? `@${m.from.username}` : handle);

        const { error } = await supa.from("messages").upsert(
          {
            instagram_id: m.id,
            source: "instagram",
            direction: outbound ? "outbound" : "inbound",
            sender_name: person,
            sender_initials: ini(person.replace("@", "")),
            subject: handle,
            preview: text.slice(0, 140),
            body: text,
            category: "reply",
            received_at: m.created_time ?? new Date().toISOString(),
            thread_id: c.id,
            /* The IGSID of the other person, which is the only thing a reply
               can be addressed to. On an outbound row it is still THEIR id, not
               ours: the reply target of a conversation does not change
               depending on who spoke last. */
            reply_target: other?.id ?? null,
          },
          { onConflict: "workspace_id,instagram_id" },
        );
        if (error) errors.push(`${handle}: ${error.message}`);
        else synced++;
      }
    }

    return json({
      synced,
      skipped,
      threads: conversations.length,
      people: [...new Set(people)].slice(0, 10),
      errors: errors.length ? errors.slice(0, 5) : undefined,
    });
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
