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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const token = Deno.env.get("SLACK_BOT_TOKEN");
    // Honest state, not a silent no-op. The UI reads this and says Not connected.
    if (!token) return json({ error: "Slack not configured (set SLACK_BOT_TOKEN)", connected: false }, 400);

    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "unauthorized" }, 401);
    const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: u } = await supa.auth.getUser();
    if (!u?.user) return json({ error: "unauthorized" }, 401);

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
