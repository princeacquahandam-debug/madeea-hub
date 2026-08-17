/**
 * Slack, from the browser's side.
 *
 * Two directions, two functions on the server:
 *   slack-sync   pulls channel messages into `messages`
 *   slack-send   posts one out and records it
 *
 * The bot token never reaches the browser. The browser names a channel; the
 * server checks the bot is actually in it before posting.
 *
 * WHY THE ERROR STRINGS ARE PARSED HERE. Slack's failures are not all the same
 * kind of problem, and a demo that says "something went wrong" when the real
 * answer is "an admin needs to tick one box in the Slack app" wastes everyone's
 * time. missing_scope in particular is a configuration gap, not an outage, and
 * the UI says so in those words.
 */
import { supabase } from "@/lib/supabase";

export type SlackFailure = "not_configured" | "missing_scope" | "not_in_channel" | "unauthorized" | "unknown";

export interface SlackSendResult {
  ok: boolean;
  /** Slack's own message id. Present only on a real send. */
  ts?: string;
  channel?: string;
  recorded?: boolean;
  failure?: SlackFailure;
  detail?: string;
}

function classify(message: string): SlackFailure {
  const m = message.toLowerCase();
  if (m.includes("missing_scope")) return "missing_scope";
  if (m.includes("not_in_channel") || m.includes("not in any channel") || m.includes("channel_not_found")) return "not_in_channel";
  if (m.includes("not configured")) return "not_configured";
  if (m.includes("unauthorized") || m.includes("invalid_auth") || m.includes("token")) return "unauthorized";
  return "unknown";
}

/** What to tell a human, in words that name the fix. */
export const SLACK_MESSAGE: Record<SlackFailure, string> = {
  not_configured: "Slack is not connected. Set SLACK_BOT_TOKEN on the server.",
  missing_scope:
    "The Slack app can read this workspace but cannot post to it. A Slack admin needs to add the chat:write scope and reinstall the app.",
  not_in_channel: "The bot is not in that channel. Invite it with /invite @MadeEA in Slack.",
  unauthorized: "The Slack token was rejected. It may have been revoked.",
  unknown: "Slack refused the message.",
};

export async function sendToSlack(text: string, channel?: string): Promise<SlackSendResult> {
  if (!supabase) return { ok: false, failure: "not_configured", detail: "no backend in demo mode" };
  try {
    const { data, error } = await supabase.functions.invoke("slack-send", { body: { text, channel } });
    if (error) {
      // The function's own JSON body carries the real reason; the SDK's error
      // message is usually just the status code.
      let detail = error.message;
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.text === "function") {
        try { detail = await ctx.text(); } catch { /* keep the status message */ }
      }
      return { ok: false, failure: classify(detail), detail };
    }
    if (data?.error) return { ok: false, failure: classify(String(data.error)), detail: String(data.error) };
    return { ok: true, ts: data.ts, channel: data.channel, recorded: data.recorded };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return { ok: false, failure: classify(detail), detail };
  }
}

/** Pull recent channel messages in. Returns how many landed. */
export async function syncSlack(): Promise<{ ok: boolean; synced?: number; channels?: number; detail?: string }> {
  if (!supabase) return { ok: false, detail: "no backend in demo mode" };
  const { data, error } = await supabase.functions.invoke("slack-sync", { body: {} });
  if (error) return { ok: false, detail: error.message };
  if (data?.error) return { ok: false, detail: String(data.error) };
  return { ok: true, synced: data.synced, channels: data.channels };
}
