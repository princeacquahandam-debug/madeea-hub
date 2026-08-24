import { useState } from "react";
import { supabase } from "@/lib/supabase";
import type { MailProvider } from "@/types/db";
import { connectAccount } from "@/lib/connect";

/**
 * Sending an email, in one place.
 *
 * WHY THIS WAS EXTRACTED. The reading pane grew its own reply box, and the
 * obvious way to build it was a second call to gmail-send. That would have
 * duplicated the part of this that is not obvious: the send functions report
 * refusals inside a 200-shaped JSON body AND through the SDK's error channel,
 * so the reason a send failed lives in `error.context`, a Response that has to
 * be read and parsed before "not connected" can be told apart from "the token
 * lost a scope" or a genuine fault. A second copy would have got that wrong,
 * and the failure mode is the worst one available: a reply that silently does
 * not arrive while the screen says it did.
 *
 * WHY THE PROVIDER IS A PARAMETER AND NOT A SECOND HOOK. Gmail and Outlook fail
 * in exactly the same four ways and differ only in which function is invoked
 * and how a reply threads. A useSendOutlook alongside this would have copied
 * the error handling above into a second place to change one string, and the
 * two composers would then each have had to know which of two hooks to call.
 * One hook, one `provider`, and both composers stay provider-blind: they pass
 * on what the message they are answering already told them.
 */

export type SendState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent"; id: string }
  /** Connected, but the stored token cannot send (or, on Outlook, cannot draft). */
  | { kind: "needs_scope"; provider: MailProvider }
  /** No account linked at all for that provider. */
  | { kind: "not_connected"; provider: MailProvider }
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
  /** Gmail threading: the original's RFC 2822 Message-ID. */
  inReplyTo?: string | null;
  /* Outlook threading: Graph's id for the message being answered. Graph refuses
     to write In-Reply-To/References, so a reply is threaded by being CREATED
     from the original rather than by carrying its id in a header. Different
     mechanism, same purpose, which is why both fields exist. */
  replyToOutlookId?: string | null;
  /** Which mailbox sends it. Defaults to Gmail, which is what shipped first. */
  provider?: MailProvider;
}

const FUNCTION: Record<MailProvider, string> = {
  gmail: "gmail-send",
  outlook: "outlook-send",
};

export const PROVIDER_LABEL: Record<MailProvider, string> = {
  gmail: "Google",
  outlook: "Outlook",
};

export function useSendEmail() {
  const [state, setState] = useState<SendState>({ kind: "idle" });

  /** Resolves true only when the message actually went. */
  async function send(input: SendInput): Promise<boolean> {
    if (!input.to.trim() || !input.text.trim() || !supabase) return false;
    const provider: MailProvider = input.provider ?? "gmail";

    setState({ kind: "sending" });
    try {
      const { data, error } = await supabase.functions.invoke(FUNCTION[provider], {
        body: {
          to: input.to.trim(),
          cc: input.cc?.trim() || undefined,
          bcc: input.bcc?.trim() || undefined,
          subject: input.subject.trim(),
          text: input.text,
          html: input.html,
          attachments: input.attachments ?? [],
          thread_id: input.threadId ?? undefined,
          // Each provider reads only its own; sending both is harmless and
          // keeps this call site free of a branch that would have to be kept
          // in step with the two functions.
          in_reply_to: input.inReplyTo ?? undefined,
          reply_to_outlook_id: input.replyToOutlookId ?? undefined,
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
      if (failure === "needs_scope") { setState({ kind: "needs_scope", provider }); return false; }
      if (failure === "not_connected") { setState({ kind: "not_connected", provider }); return false; }
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

/**
 * Reconnect from inside a composer, when a send failed for want of a scope.
 *
 * Thin over connectAccount so there is ONE consent path in the app. It used to
 * be its own redirect, which meant a reply half-written in the box was thrown
 * away by the navigation: you came back to an empty composer and had to type it
 * again. A popup leaves the draft where it is.
 *
 * Null when it worked; a sentence worth showing when it did not.
 */
export async function reconnectMail(provider: MailProvider = "gmail"): Promise<string | null> {
  const r = await connectAccount(provider === "outlook" ? "microsoft" : "google");
  return r.ok ? null : (r.error ?? `Could not connect ${PROVIDER_LABEL[provider]}.`);
}

/** Plain text to the HTML the body expects, escaping as it goes. */
export function textToHtml(v: string): string {
  const esc = v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc.split("\n").map((l) => `<div>${l || "<br>"}</div>`).join("");
}
