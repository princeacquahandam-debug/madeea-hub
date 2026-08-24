// Edge Function: discord-channels   (Verify JWT: ON, the default. Auth is ALSO enforced in code,
// so this is safe either way; leaving verification on is simply stricter. Only
// the two endpoints an outsider calls directly need it off: the OAuth callback
// and whatsapp-webhook.)
//
// Lists every text channel the bot can see, with read and post stated
// separately, so the Integrations card can be honest about a Discord server the
// way it already is about a Slack workspace.
//
// WHY READ AND POST ARE ASKED SEPARATELY. Discord permissions are per channel
// and the two are genuinely independent: a bot can hold Send Messages in a
// channel whose history it cannot read (no Read Message History), and it can
// hold View Channel + Read Message History somewhere it is not allowed to post.
// Flattening that into one "connected" boolean would be wrong in both
// directions, and the person looking at the card is trying to work out which
// half is missing.
//
// ENV
//   DISCORD_BOT_TOKEN   the bot token from the Developer Portal (NOT a client secret)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const API = "https://discord.com/api/v10";

/* Discord's permission bits. Only the three that decide whether this
   integration can do anything, named rather than left as magic numbers. */
const VIEW_CHANNEL = 1n << 10n;
const SEND_MESSAGES = 1n << 11n;
const READ_HISTORY = 1n << 16n;
const ADMINISTRATOR = 1n << 3n;

/** GUILD_TEXT and GUILD_ANNOUNCEMENT. Voice and category rows are not channels
    anyone can message in, and listing them would pad the card with noise. */
const TEXTY = new Set([0, 5]);

async function discord(path: string, token: string) {
  const r = await fetch(`${API}${path}`, { headers: { Authorization: `Bot ${token}` } });
  const body = await r.json().catch(() => null);
  if (!r.ok) {
    // Discord's own code is the useful half: 50001 is missing access, 50013 is
    // missing permissions, and they have completely different fixes.
    throw new Error(`discord ${path}: ${body?.message ?? r.status}${body?.code ? ` (${body.code})` : ""}`);
  }
  return body;
}

interface Guild { id: string; name: string; permissions?: string }
interface Overwrite { id: string; type: number; allow: string; deny: string }
interface Channel { id: string; name: string; type: number; guild_id?: string; permission_overwrites?: Overwrite[] }

/**
 * What the bot may do in one channel.
 *
 * Discord does not expose "what can this bot do here" as a field, so it is
 * computed the way Discord itself computes it: the role baseline from the
 * guild, then the channel's overwrites applied on top. This models the bot's
 * @everyone-plus-overwrites view, which is what a bot with the default single
 * role actually has. A bot carrying extra roles could hold more than this says.
 *
 * Erring towards understating is deliberate: a card that claims a channel is
 * readable when it is not sends somebody hunting for missing messages, while
 * one that understates gets corrected the moment a sync pulls something in.
 */
function capabilities(base: bigint, ch: Channel, botId: string, everyoneId: string) {
  if (base & ADMINISTRATOR) return { can_read: true, can_post: true };

  let perms = base;
  const apply = (o: Overwrite | undefined) => {
    if (!o) return;
    perms = (perms & ~BigInt(o.deny)) | BigInt(o.allow);
  };
  // Order matters and is Discord's: @everyone first, then the member override.
  apply(ch.permission_overwrites?.find((o) => o.id === everyoneId));
  apply(ch.permission_overwrites?.find((o) => o.id === botId));

  const visible = Boolean(perms & VIEW_CHANNEL);
  return {
    can_read: visible && Boolean(perms & READ_HISTORY),
    can_post: visible && Boolean(perms & SEND_MESSAGES),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const token = Deno.env.get("DISCORD_BOT_TOKEN");
    // An honest "not configured" rather than an empty list. The UI shows two
    // different things for "no token" and "no channels", because the fixes are
    // a server secret and a server invite respectively.
    if (!token) return json({ ok: false, configured: false, error: "Discord not configured (set DISCORD_BOT_TOKEN)", channels: [] }, 200);

    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "unauthorized" }, 401);
    const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: u } = await supa.auth.getUser();
    if (!u?.user) return json({ error: "unauthorized" }, 401);

    const me = await discord("/users/@me", token);
    const guilds: Guild[] = await discord("/users/@me/guilds", token);

    const channels: Record<string, unknown>[] = [];
    // Capped. A bot in thirty servers would otherwise turn one card render into
    // sixty requests and a rate limit.
    for (const g of guilds.slice(0, 5)) {
      let list: Channel[];
      try {
        list = await discord(`/guilds/${g.id}/channels`, token);
      } catch (e) {
        channels.push({ id: `err-${g.id}`, name: g.name, guild: g.name, error: String(e instanceof Error ? e.message : e) });
        continue;
      }
      const base = BigInt(g.permissions ?? "0");
      for (const ch of list.filter((c) => TEXTY.has(c.type))) {
        const caps = capabilities(base, ch, me.id, g.id);   // @everyone's role id IS the guild id
        channels.push({ id: ch.id, name: ch.name, guild: g.name, ...caps });
      }
    }

    return json({
      ok: true,
      configured: true,
      bot: me.username,
      guilds: guilds.length,
      readable: channels.filter((c) => c.can_read).length,
      channels: channels.slice(0, 40),
    });
  } catch (e) {
    return json({ ok: false, configured: true, error: String(e instanceof Error ? e.message : e), channels: [] }, 200);
  }
});
