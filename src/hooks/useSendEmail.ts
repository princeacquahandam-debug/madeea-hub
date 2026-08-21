import { useState } from "react";
import { supabase } from "@/lib/supabase";

/**
 * Sending an email, in one place.
 *
 * WHY THIS WAS EXTRACTED. The reading pane grew its own reply box, and the
 * obvious way to build it was a second call to gmail-send. That would have
 * duplicated the part of this that is not obvious: gmail-send reports refusals
 * inside a 200-shaped JSON body AND through the SDK's error channel, so the
 * reason a send failed lives in `error.context`, a Response that has to be read
 * and parsed before "not connected" can be told apart from "the token lost a
 * scope" or a genuine fault. A second copy would have got that wrong, and the
 * failure mode is the worst one available: a reply that silently does not
 * arrive while the screen says it did.
 *
 * So there is one send, and both composers report the same four failures.
 */

export type SendState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent"; id: string }
  /** Connected, but the stored token is missing gmail.send. */
  | { kind: "needs_scope" }
  /** No Google account linked at all. */
  | { kind: "not_connected" }
  | { kind: "error"; detail: string };

export interface SendInput {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  /** Always sent alongside the HTML. See ComposeWindow on why both. */
  text: string;
  html: string;
  attachments?: { filename: string; mime_type: string; data: string }[];
  threadId?: string | null;
  inReplyTo?: string | null;
}

export function useSendEmail() {
  const [state, setState] = useState<SendState>({ kind: "idle" });

  /** Resolves true only when the message actually went. */
  async function send(input: SendInput): Promise<boolean> {
    if (!input.to.trim() || !input.text.trim() || !supabase) return false;

    setState({ kind: "sending" });
    try {
      const { data, error } = await supabase.functions.invoke("gmail-send", {
        body: {
          to: input.to.trim(),
          cc: input.cc?.trim() || undefined,
          bcc: input.bcc?.trim() || undefined,
          subject: input.subject.trim(),
          text: input.text,
          html: input.html,
          attachments: input.attachments ?? [],
          thread_id: input.threadId ?? undefined,
          in_reply_to: input.inReplyTo ?? undefined,
        },
      });

      let payload: Record<string, unknown> | null = data ?? null;
      if (error) {
        // The function's JSON body carries the reason; the SDK message is the status.
        const ctx = (error as { context?: Response }).context;
        if (ctx && typeof ctx.text === "function") {
          try { payload = JSON.parse(await ctx.text()); } catch { payload = null; }
        }
      }

      const failure = String(payload?.failure ?? "");
      if (failure === "needs_scope") { setState({ kind: "needs_scope" }); return false; }
      if (failure === "not_connected") { setState({ kind: "not_connected" }); return false; }
      if (error || payload?.error) {
        setState({ kind: "error", detail: String(payload?.error ?? error?.message ?? "send failed") });
        return false;
      }

      setState({ kind: "sent", id: String(payload?.id ?? "") });
      return true;
    } catch (e) {
      setState({ kind: "error", detail: e instanceof Error ? e.message : String(e) });
      return false;
    }
  }

  return { state, setState, send };
}

/** Sends the user back through Google consent, for needs_scope and not_connected. */
export async function reconnectGoogle() {
  if (!supabase) return;
  const { data } = await supabase.functions.invoke("google-oauth-url", { body: {} });
  if (data?.url) window.location.href = data.url as string;
}

/** Plain text to the HTML the body expects, escaping as it goes. */
export function textToHtml(v: string): string {
  const esc = v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc.split("\n").map((l) => `<div>${l || "<br>"}</div>`).join("");
}
