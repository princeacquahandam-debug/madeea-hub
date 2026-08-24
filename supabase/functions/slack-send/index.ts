// Edge Function: slack-send   (Verify JWT: OFF. Auth enforced in code.)
//
// The outbound half of the Slack integration. slack-sync pulls messages in;
// this pushes one out, and records it in `messages` so the Communication Center
// shows the conversation rather than only one side of it.
//
// The bot token is a server secret. It is never sent to the browser, and the
// browser cannot name an arbitrary Slack workspace: it names a channel, and the
// server decides whether the bot is actually in that channel before posting.
//
// ENV
//   SLACK_BOT_TOKEN   xoxb-…, needs chat:write and channels:read
//
// Returns the real Slack `ts` on success, which is the message's identity in
// Slack and the thing to check when somebody asks whether it really sent.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

/** One attempt gets this long. Slack answers in well under a second when healthy. */
const TIMEOUT_MS = 8_000;

async function slack(method: string, token: string, body: Record<string, unknown>) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`https://slack.com/api/${method}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
      signal: abort.signal,
    });
    const d = await r.json();
    if (!d.ok) throw new Error(`slack ${method}: ${d.error}`);
    return d;
  } finally {
    clearTimeout(timer);
  }
}

async function slackGet(method: string, token: string, params: Record<string, string> = {}) {
  const r = await fetch(`https://slack.com/api/${method}?${new URLSearchParams(params)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const d = await r.json();
  if (!d.ok) throw new Error(`slack ${method}: ${d.error}`);
  return d;
}

const ini = (n: string) => n.split(/[ .]/).map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();


/**
 * The caller's own slack connection, decrypted.
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
    .eq("provider", "slack")
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
      console.error("could not decrypt the stored slack token");
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
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {

    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "unauthorized" }, 401);
    const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: u } = await supa.auth.getUser();
    if (!u?.user) return json({ error: "unauthorized" }, 401);

    /* The workspace's own Slack install, from pressing Connect. The env token
       is the fallback for a deployment configured before install flows
       existed. */
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const conn = await integration(admin, u.user.id);
    const token = conn?.access_token ?? Deno.env.get("SLACK_BOT_TOKEN");
    if (!token) {
      return json({ error: "Slack is not connected. Press Connect on the Slack card.", failure: "not_connected", connected: false }, 400);
    }

    const body = await req.json().catch(() => ({}));
    const text = String(body.text ?? "").trim();
    if (!text) return json({ error: "text is required" }, 400);

    /* Resolve the channel server-side rather than trusting an id from the
       browser. Only channels the bot has actually been invited to are eligible,
       so this cannot be used to post into an arbitrary channel. */
    const conv = await slackGet("conversations.list", token, {
      types: "public_channel,private_channel",
      exclude_archived: "true",
      limit: "100",
    });
    const joined = (conv.channels ?? []).filter((c: { is_member: boolean }) => c.is_member);
    if (!joined.length) return json({ error: "the bot is not in any channel", connected: false }, 400);

    const wanted = String(body.channel ?? "").replace(/^#/, "").toLowerCase();
    const ch = wanted
      ? joined.find((c: { id: string; name: string }) => c.name.toLowerCase() === wanted || c.id === body.channel)
      : joined[0];
    if (!ch) return json({ error: `the bot is not in #${wanted}` }, 400);

    const posted = await slack("chat.postMessage", token, { channel: ch.id, text });

    /* Record our own message too, so the Communication Center shows a
       conversation rather than only the inbound half. Same shape slack-sync
       writes, with direction outbound so the UI can tell them apart. */
    const me = u.user.email ?? "MadeEA";
    const { error: writeErr } = await supa.from("messages").upsert(
      {
        slack_ts: posted.ts,
        source: "slack",
        direction: "outbound",
        sender_name: me,
        sender_initials: ini(me.split("@")[0].replace(/[._]/g, " ")),
        subject: `#${ch.name}`,
        preview: text.slice(0, 140),
        body: text,
        category: "reply",
        received_at: new Date(parseFloat(posted.ts) * 1000).toISOString(),
      },
      { onConflict: "workspace_id,slack_ts" },
    );

    return json({
      ok: true,
      ts: posted.ts,
      channel: ch.name,
      channel_id: ch.id,
      // Surfaced rather than swallowed: the message DID reach Slack even if we
      // failed to record it, and those are different problems.
      recorded: !writeErr,
      record_error: writeErr?.message,
    });
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
