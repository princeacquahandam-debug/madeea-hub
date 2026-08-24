import { supabase } from "@/lib/supabase";

/**
 * Connecting an account, by signing in to it.
 *
 * WHY A POPUP AND NOT A REDIRECT. A full-page redirect throws away whatever the
 * person was doing: the app unloads, the provider takes over the tab, and they
 * come back to a fresh page scrolled to the top. That is tolerable once, and
 * this screen is a grid where somebody connects three channels in a row. A
 * popup leaves the page underneath alive, so the card can turn green while they
 * are still looking at it.
 *
 * WHY THE RESULT COMES BACK BY postMessage. The popup ends up on our own
 * callback function, which cannot reach into the opener to update React state.
 * It posts a message instead, targeted at this exact origin, and this listens
 * for it. The alternative is polling the database until something appears,
 * which is slower, noisier, and cannot tell "still deciding" from "declined".
 *
 * WHAT HAPPENS WHEN A POPUP IS BLOCKED. Every browser blocks a window opened
 * outside a user gesture, and some block them anyway. `window.open` returning
 * null is that case, and it falls back to a full-page redirect rather than
 * failing silently: slower, still works, and nobody is left pressing a button
 * that does nothing.
 */

export type ConnectProvider = "google" | "microsoft" | "slack" | "discord" | "meta" | "linkedin";

export interface ConnectResult {
  ok: boolean;
  /** Present on success where the provider told us what was connected. */
  account?: string;
  /** Why it did not happen, in words worth showing. */
  error?: string;
}

/**
 * One consent path for every provider.
 *
 * Google and Microsoft used to have their own pair of functions. They now go
 * through the same one as the rest, and that is the point rather than tidiness:
 * the shared path is what writes the per-user `integrations` row, with the
 * account id, the encrypted tokens and the audit log. Leaving two providers on
 * the old route would have left them outside the model that exists to keep one
 * colleague out of another's mailbox.
 *
 * The old functions still exist and still work; nothing calls them from here.
 */
const URL_FUNCTION = "integration-oauth-url";

/** Read the reason out of an edge function's body, which the SDK hides. */
async function reasonFrom(error: { message: string; context?: Response }): Promise<string> {
  const ctx = error.context;
  if (ctx && typeof ctx.text === "function") {
    try { return String(JSON.parse(await ctx.text())?.error ?? error.message); } catch { /* keep status */ }
  }
  return error.message;
}

function openCentred(url: string, name: string): Window | null {
  const w = 620;
  const h = 720;
  /* Centred on the SCREEN the browser is on rather than the viewport, so a
     second monitor does not put the login window somewhere the person is not
     looking. */
  const left = Math.max(0, Math.round((window.screen.width - w) / 2));
  const top = Math.max(0, Math.round((window.screen.height - h) / 2));
  return window.open(url, name, `width=${w},height=${h},left=${left},top=${top},menubar=no,toolbar=no`);
}

/**
 * Start a connection and resolve when the popup has finished with it.
 *
 * Resolves rather than rejects on refusal: "the person changed their mind" and
 * "the provider refused us" are both ordinary outcomes a card has to render,
 * and an exception is the wrong shape for either.
 */
export async function connectAccount(provider: ConnectProvider): Promise<ConnectResult> {
  if (!supabase) return { ok: false, error: "Supabase is not configured, so nothing can be connected." };

  const { data, error } = await supabase.functions.invoke(URL_FUNCTION, {
    body: { provider, origin: window.location.origin, popup: true },
  });
  let payload = (data ?? null) as { url?: string; error?: string } | null;
  if (error) payload = { error: await reasonFrom(error as { message: string; context?: Response }) };
  if (!payload?.url) {
    return { ok: false, error: payload?.error ?? `Could not start the ${provider} connection.` };
  }

  const popup = openCentred(payload.url, `madeea-connect-${provider}`);
  if (!popup) {
    // Blocked. Take the whole page instead of pretending nothing happened.
    window.location.href = payload.url;
    return { ok: false, error: "Opening the login window was blocked, so this page will go there instead." };
  }

  return await new Promise<ConnectResult>((resolve) => {
    let done = false;
    const finish = (r: ConnectResult) => {
      if (done) return;
      done = true;
      window.removeEventListener("message", onMessage);
      clearInterval(watch);
      resolve(r);
    };

    function onMessage(e: MessageEvent) {
      /* Origin checked before the payload is looked at: any page can post to
         this window, and a message claiming a connection succeeded is worth
         forging if it makes the UI say connected when nothing is. */
      if (e.origin !== window.location.origin) return;
      const d = e.data as
        { source?: string; ok?: boolean; provider?: string; account?: string; error?: string } | null;
      if (!d || d.source !== "madeea-oauth") return;

      /* The Microsoft claim step is gone. It existed because the old callback
         could not know who was asking, so it parked the tokens and handed back
         a code for the app to redeem. The unified callback reads the user from
         the state row it minted while the caller was authenticated, so there is
         nobody left to ask: the connection is already filed by the time this
         message arrives. */
      finish({ ok: Boolean(d.ok), account: d.account, error: d.error });
    }
    window.addEventListener("message", onMessage);

    /* Closing the window IS an answer: people abandon a consent screen by
       shutting it, and without this the card would sit on "connecting…" for
       ever waiting for a message that is never coming. */
    const watch = setInterval(() => {
      if (popup.closed) finish({ ok: false, error: "The login window was closed before it finished." });
    }, 500);
  });
}
