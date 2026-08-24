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
 * The connection this caller should use for meta, or null.
 *
 * WHICH ONE, when there is more than one. Their own private connection wins
 * over the team's, because somebody who attached their own account did so to
 * work through it; among equals, the one marked default wins. A person with no
 * private meta falls through to the shared account, which is the ordinary
 * case and the reason the shared one exists.
 *
 * Read with the service role because access_token is revoked from the
 * `authenticated` role (0056): the browser can see THAT a channel is connected
 * and never the token behind it, which also means the caller's own client
 * cannot read it here. The query is still confined to connections this person
 * is entitled to: their workspace, and within it their own or the shared ones.
 *
 * Falls back to the environment when there is no row, so a deployment
 * configured the old way (a token pasted into Supabase secrets) keeps working
 * until somebody presses Connect.
 */
async function integration(admin: ReturnType<typeof createClient>, userId: string) {
  const { data: m } = await admin
    .from("memberships").select("workspace_id").eq("user_id", userId).limit(1).maybeSingle();
  if (!m?.workspace_id) return null;

  const { data } = await admin
    .from("workspace_integrations")
    .select("access_token, external_id, account_label, details, owner_id, is_default")
    .eq("workspace_id", m.workspace_id)
    .eq("provider", "meta")
    .or(`owner_id.eq.${userId},owner_id.is.null`);

  const rows = (data ?? []) as {
    access_token: string | null;
    external_id: string | null;
    account_label: string | null;
    details: Record<string, string | null>;
    owner_id: string | null;
    is_default: boolean;
  }[];
  if (!rows.length) return null;

  // Mine before the team's, default before the rest.
  rows.sort((a, b) =>
    Number(b.owner_id === userId) - Number(a.owner_id === userId) ||
    Number(b.is_default) - Number(a.is_default));

  const row = rows[0];
  /* Whether messages pulled through this belong to one person. The sync writes
     it onto every row it stores, because 0058 decides who may read a shared
     channel's message by that flag rather than by the source alone. */
  return { ...row, private: row.owner_id !== null };
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
            private: conn?.private ?? false,
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
