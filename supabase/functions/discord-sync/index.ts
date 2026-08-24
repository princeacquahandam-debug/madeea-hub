// Edge Function: discord-sync   (Verify JWT: ON, the default. Auth is ALSO enforced in code,
// so this is safe either way; leaving verification on is simply stricter. Only
// the two endpoints an outsider calls directly need it off: the OAuth callback
// and whatsapp-webhook.)
// Pulls recent messages from the text channels the bot can read.
//
// Modelled on slack-sync, including the rule it was fixed to obey: count a row
// as synced only when the write succeeded, and keep the reason when it did not.
// A channel the bot cannot read, a channel with nothing in it, and a write the
// database refused are three different problems, and reporting all three as
// "synced: 0" is how an integration looks broken when it is merely uninvited.
//
// WHAT GETS SKIPPED. Bot messages and system notices (joins, pins, boosts).
// They are not correspondence, and an inbox full of "X joined the server" is an
// inbox nobody opens.
//
// THE ONE THING THAT LOOKS LIKE A BUG AND IS NOT. If every message comes back
// with an empty body, the bot is missing the Message Content intent. That is a
// switch in the Developer Portal (Bot → Privileged Gateway Intents → Message
// Content), not a permission on the server, and this function says so by name
// rather than silently writing forty blank rows.
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

async function discord(path: string, token: string) {
  const r = await fetch(`${API}${path}`, { headers: { Authorization: `Bot ${token}` } });
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${body?.message ?? r.status}${body?.code ? ` (${body.code})` : ""}`);
  return body;
}

const ini = (n: string) => n.split(/[ ._-]/).map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();

interface Guild { id: string; name: string }
interface Channel { id: string; name: string; type: number }
interface Author { id: string; username: string; global_name?: string | null; bot?: boolean }
interface DiscordMessage {
  id: string;
  content: string;
  timestamp: string;
  /* 0 is a normal message. Everything else (1-7 joins/pins/boosts, 19 replies
     are still 0/19...) is either a system notice or a thread starter. Only 0
     and 19 (a reply) are things a person typed. */
  type: number;
  author: Author;
  attachments?: unknown[];
}

const TEXTY = new Set([0, 5]);
const HUMAN_TYPES = new Set([0, 19]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const token = Deno.env.get("DISCORD_BOT_TOKEN");
    if (!token) return json({ error: "Discord not configured (set DISCORD_BOT_TOKEN)", configured: false }, 400);

    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "unauthorized" }, 401);
    const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: u } = await supa.auth.getUser();
    if (!u?.user) return json({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const perChannel = Math.min(Math.max(Number(body.limit ?? 20), 1), 100);

    const guilds: Guild[] = await discord("/users/@me/guilds", token);
    if (!guilds.length) {
      return json({
        synced: 0, channels: 0,
        error: "The bot is not in any server yet. Invite it from the Developer Portal's OAuth2 URL generator (scope: bot).",
      });
    }

    let synced = 0;
    let skipped = 0;
    let emptyContent = 0;
    const channelNames: string[] = [];
    const errors: string[] = [];
    let readable = 0;

    for (const g of guilds.slice(0, 5)) {
      let list: Channel[];
      try {
        list = await discord(`/guilds/${g.id}/channels`, token);
      } catch (e) {
        errors.push(`${g.name}: ${e instanceof Error ? e.message : e}`);
        continue;
      }

      for (const ch of list.filter((c) => TEXTY.has(c.type)).slice(0, 8)) {
        let messages: DiscordMessage[];
        try {
          messages = await discord(`/channels/${ch.id}/messages?limit=${perChannel}`, token);
        } catch (e) {
          /* 50001 Missing Access is the ordinary state of a channel the bot has
             not been given, not an outage. Recorded per channel and not raised,
             so one locked channel cannot stop the rest of the sync. */
          const msg = e instanceof Error ? e.message : String(e);
          if (!msg.includes("50001")) errors.push(`#${ch.name}: ${msg}`);
          continue;
        }
        readable++;
        channelNames.push(ch.name);

        for (const m of messages) {
          if (m.author?.bot || !HUMAN_TYPES.has(m.type)) { skipped++; continue; }
          if (!m.content?.trim()) {
            // Either an attachment-only post or the missing intent. Counted so
            // the response can tell the difference for the whole run.
            if (!m.attachments?.length) emptyContent++;
            skipped++;
            continue;
          }

          const sender = m.author.global_name || m.author.username || "Discord user";
          const { error } = await supa.from("messages").upsert(
            {
              discord_id: m.id,
              source: "discord",
              sender_name: sender,
              sender_initials: ini(sender),
              subject: `#${ch.name}`,
              preview: m.content.slice(0, 140),
              body: m.content,
              category: "reply",
              received_at: m.timestamp,
              /* The channel id, because that is what a reply is posted back to.
                 Same role conversationId plays for Teams and threadId for
                 Gmail: the thing that makes the answer land in the right place. */
              thread_id: ch.id,
            },
            { onConflict: "workspace_id,discord_id" },
          );
          if (error) errors.push(`#${ch.name}: ${error.message}`);
          else synced++;
        }
      }
    }

    return json({
      synced,
      skipped,
      channels: readable,
      channel_names: [...new Set(channelNames)].slice(0, 10),
      /* Named explicitly, because the symptom (everything empty) points at the
         server permissions and the cause is a portal toggle. */
      hint: emptyContent > 3 && synced === 0
        ? "Every message came back with no text, which means the Message Content intent is off. Turn it on in the Developer Portal under Bot → Privileged Gateway Intents."
        : undefined,
      errors: errors.length ? errors.slice(0, 5) : undefined,
    });
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
