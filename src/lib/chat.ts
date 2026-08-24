import { supabase } from "@/lib/supabase";

/**
 * Answering a chat message, whichever chat it is.
 *
 * WHY ONE FUNCTION FOR THREE SERVICES. Slack, Discord and Teams differ in the
 * name of an edge function and the name of one field. Everything that is
 * actually hard is identical: the reason a post failed lives inside the
 * function's JSON body, which the SDK hides behind `error.context`, so
 * "the bot is not in that channel" and "the token lost a scope" and a genuine
 * outage all arrive looking like "Edge Function returned a non-2xx status
 * code". Three copies of that unwrapping is three chances to get it wrong, and
 * the failure mode is a reply that silently never posted.
 *
 * WHY IT IS NOT useSendEmail. A chat reply has no To, no subject, no
 * attachments, no threading headers, and it cannot fail for want of a mailbox.
 * Bending the mail hook around a second shape would have made both harder to
 * read than having two small ones.
 */

export type ChatSource = "slack" | "discord" | "teams" | "instagram" | "whatsapp";

export interface ChatSendResult {
  ok: boolean;
  /** Named so the UI can offer the fix rather than only the symptom. */
  failure?: "not_connected" | "needs_scope" | "not_in_channel" | "too_long" | "send_failed"
    /* Meta only. Not a fault and not fixable by retrying: the customer has not
       written recently enough for a reply to be allowed at all. */
    | "window_closed";
  detail?: string;
}

/** Which chats can be answered from the reading pane, and how. */
const ROUTE: Record<ChatSource, { fn: string; idField: string }> = {
  /* Slack takes a channel NAME or id and resolves it server-side. The stored
     subject is "#channel-name", which is where the name comes from: slack-sync
     predates thread_id being used for a channel id, and older rows have no id
     at all. Passing the name keeps those rows answerable. */
  slack: { fn: "slack-send", idField: "channel" },
  discord: { fn: "discord-send", idField: "channel_id" },
  teams: { fn: "teams-send", idField: "chat_id" },
  /* Meta's two are addressed to a person rather than to a room, and the id is
     scoped to the app: an IGSID is not an Instagram handle and a wa_id is not a
     dialable number. Both are read off the row (reply_target), never typed. */
  instagram: { fn: "instagram-send", idField: "recipient_id" },
  whatsapp: { fn: "whatsapp-send", idField: "to" },
};

export const isChatSource = (v: string | undefined | null): v is ChatSource =>
  v === "slack" || v === "discord" || v === "teams" || v === "instagram" || v === "whatsapp";

/**
 * Post a reply back into the conversation it came from.
 *
 * `target` is whatever that service needs to identify the room: a Slack channel
 * name, a Discord channel id, a Teams chat id. The caller reads it off the
 * message rather than asking anybody to type it, because a chat reply that can
 * be misaddressed is a chat reply that eventually is.
 */
export async function sendChatReply(
  source: ChatSource,
  target: string,
  text: string,
  subject?: string,
): Promise<ChatSendResult> {
  if (!supabase) return { ok: false, failure: "not_connected", detail: "no backend in demo mode" };
  if (!text.trim()) return { ok: false, failure: "send_failed", detail: "nothing to send" };
  if (!target) return { ok: false, failure: "not_in_channel", detail: "this message did not record where it came from" };

  const route = ROUTE[source];
  const { data, error } = await supabase.functions.invoke(route.fn, {
    body: { text, [route.idField]: target, subject },
  });

  let payload = (data ?? null) as { ok?: boolean; error?: string; failure?: string } | null;
  if (error) {
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.text === "function") {
      try { payload = JSON.parse(await ctx.text()); } catch { payload = null; }
    }
  }

  if (error || payload?.error || payload?.ok === false) {
    const failure = payload?.failure as ChatSendResult["failure"];
    return {
      ok: false,
      failure: failure ?? "send_failed",
      detail: payload?.error ?? error?.message ?? "The message was refused.",
    };
  }
  return { ok: true };
}
