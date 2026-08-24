import { supabase } from "@/lib/supabase";

/**
 * Discord, from the browser's side. The same two directions as Slack:
 *
 *   discord-channels  what the bot can see, read and post in
 *   discord-sync      pulls channel messages into `messages`
 *
 * The bot token never reaches the browser, and a channel id from the browser is
 * checked against the bot's own server list before anything is posted.
 */

export interface DiscordChannelInfo {
  id: string;
  name: string;
  guild: string;
  can_read?: boolean;
  can_post?: boolean;
  /** Present instead of the capabilities when a whole server could not be read. */
  error?: string;
}

export interface DiscordDirectory {
  ok: boolean;
  /** False means no DISCORD_BOT_TOKEN on the server: a setup gap, not a failure. */
  configured: boolean;
  bot?: string;
  guilds?: number;
  readable?: number;
  channels: DiscordChannelInfo[];
  error?: string;
}

export async function listDiscordChannels(): Promise<DiscordDirectory> {
  if (!supabase) return { ok: false, configured: false, channels: [], error: "no backend in demo mode" };
  const { data, error } = await supabase.functions.invoke("discord-channels", { body: {} });
  if (error) {
    /* The function answers 200 with ok:false for the states that are somebody's
       to fix (no token, bot in no servers), so a genuine transport error here
       is the unusual case and is reported as one. */
    let detail = error.message;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.text === "function") {
      try { detail = String(JSON.parse(await ctx.text())?.error ?? detail); } catch { /* keep status */ }
    }
    return { ok: false, configured: true, channels: [], error: detail };
  }
  return data as DiscordDirectory;
}

export async function syncDiscord(): Promise<{
  ok: boolean; synced?: number; channels?: number; channel_names?: string[]; hint?: string; detail?: string;
}> {
  if (!supabase) return { ok: false, detail: "no backend in demo mode" };
  const { data, error } = await supabase.functions.invoke("discord-sync", { body: {} });
  if (error) {
    let detail = error.message;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.text === "function") {
      try { detail = String(JSON.parse(await ctx.text())?.error ?? detail); } catch { /* keep status */ }
    }
    return { ok: false, detail };
  }
  if (data?.error) return { ok: false, detail: String(data.error) };
  return {
    ok: true,
    synced: data.synced,
    channels: data.channels,
    channel_names: data.channel_names,
    hint: data.hint,
  };
}
