// Edge Function: discord-send   (Verify JWT: ON, the default. Auth is ALSO enforced in code,
// so this is safe either way; leaving verification on is simply stricter. Only
// the two endpoints an outsider calls directly need it off: the OAuth callback
// and whatsapp-webhook.)
//
// Posts one message to a Discord channel and records it, so the Inbox shows a
// conversation rather than only the half that arrived.
//
// THE CHANNEL IS VERIFIED SERVER-SIDE, exactly as in slack-send. The browser
// names a channel id, and this checks it against the channels the bot is
// actually in before posting. Without that check, a channel id typed into a
// request body would let any signed-in user post into any channel the bot can
// reach anywhere, which is a much larger surface than "reply to what is in your
// inbox".
//
// ENV
//   DISCORD_BOT_TOKEN

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const API = "https://discord.com/api/v10";
/** Discord's hard limit on a message. Stated here so the refusal is ours. */
const MAX_CHARS = 2000;

async function discord(path: string, token: string, init?: RequestInit) {
  const r = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await r.json().catch(() => null);
  if (!r.ok) {
    const e = new Error(`${body?.message ?? r.status}${body?.code ? ` (${body.code})` : ""}`);
    (e as Error & { status?: number; code?: number }).status = r.status;
    (e as Error & { status?: number; code?: number }).code = body?.code;
    throw e;
  }
  return body;
}

interface Guild { id: string; name: string }
interface Channel { id: string; name: string; type: number }
const TEXTY = new Set([0, 5]);

const ini = (n: string) => n.split(/[ ._-]/).map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const token = Deno.env.get("DISCORD_BOT_TOKEN");
    if (!token) return json({ error: "Discord not configured (set DISCORD_BOT_TOKEN)", failure: "not_connected" }, 400);

    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "unauthorized" }, 401);
    const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: u } = await supa.auth.getUser();
    if (!u?.user) return json({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const text = String(body.text ?? "").trim();
    const channelId = String(body.channel_id ?? "").trim();
    if (!text) return json({ error: "text is required" }, 400);
    if (!channelId) return json({ error: "channel_id is required" }, 400);
    if (text.length > MAX_CHARS) {
      return json({
        error: `Discord caps a message at ${MAX_CHARS} characters and this is ${text.length}. Shorten it or send it in two.`,
        failure: "too_long",
      }, 400);
    }

    // The channel must be one the bot is actually in. See the header note.
    const guilds: Guild[] = await discord("/users/@me/guilds", token);
    let found: { ch: Channel; guild: Guild } | null = null;
    for (const g of guilds.slice(0, 5)) {
      const list: Channel[] = await discord(`/guilds/${g.id}/channels`, token).catch(() => []);
      const ch = list.find((c) => c.id === channelId && TEXTY.has(c.type));
      if (ch) { found = { ch, guild: g }; break; }
    }
    if (!found) return json({ error: "The bot is not in that channel.", failure: "not_in_channel" }, 400);

    let posted;
    try {
      posted = await discord(`/channels/${channelId}/messages`, token, {
        method: "POST",
        body: JSON.stringify({ content: text }),
      });
    } catch (e) {
      const code = (e as Error & { code?: number }).code;
      /* 50013 is Missing Permissions: the bot is in the channel but has not
         been given Send Messages. That is a role fix in Discord, not a code
         fix, and saying which one saves a support round trip. */
      const permissionProblem = code === 50013 || code === 50001;
      return json({
        error: permissionProblem
          ? `The bot is in #${found.ch.name} but is not allowed to post there. Give its role Send Messages in that channel.`
          : (e instanceof Error ? e.message : "Discord refused the message"),
        failure: permissionProblem ? "needs_scope" : "send_failed",
      }, 400);
    }

    const me = u.user.email ?? "MadeEA";
    const { error: writeErr } = await supa.from("messages").upsert(
      {
        discord_id: posted.id,
        source: "discord",
        direction: "outbound",
        sender_name: me,
        sender_initials: ini(me.split("@")[0]),
        subject: `#${found.ch.name}`,
        preview: text.slice(0, 140),
        body: text,
        category: "reply",
        received_at: posted.timestamp ?? new Date().toISOString(),
        thread_id: channelId,
      },
      { onConflict: "workspace_id,discord_id" },
    );

    return json({
      ok: true,
      id: posted.id,
      channel: found.ch.name,
      // Surfaced rather than swallowed: the message DID reach Discord even if
      // recording it here failed, and those are different problems.
      recorded: !writeErr,
      record_error: writeErr?.message,
    });
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e), failure: "send_failed" }, 500);
  }
});
