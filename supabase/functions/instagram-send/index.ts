// Edge Function: instagram-send   (Verify JWT: ON, the default. Auth is ALSO enforced in code,
// so this is safe either way; leaving verification on is simply stricter. Only
// the two endpoints an outsider calls directly need it off: the OAuth callback
// and whatsapp-webhook.)
// Replies to an Instagram DM.
//
// THE RULE THAT WILL BITE, stated here because it is Meta's and not ours: a
// Page may message a person only within 24 hours of that person's last message.
// Outside the window Meta refuses with error 10 and the only way through is the
// HUMAN_AGENT tag, which extends it to 7 days and requires the message to be
// written by a person (which, here, it is: this function exists to send what
// somebody typed).
//
// So the tag is applied when the caller says the window may have closed, and a
// refusal is reported as what it is: not a permission problem, not an outage,
// but "this conversation went quiet too long ago to reopen it here". Anything
// else would have somebody retrying a send that can never succeed.
//
// ENV
//   META_PAGE_ID, META_PAGE_ACCESS_TOKEN

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const GRAPH = "https://graph.facebook.com/v21.0";
/** Instagram's own cap on a DM. Refused here so the refusal is legible. */
const MAX_CHARS = 1000;

const ini = (n: string) => n.split(/[ ._]/).map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();


/**
 * The caller's own meta connection, decrypted.
 *
 * PER PERSON, not per workspace. This used to read workspace_integrations,
 * where one row served the whole team: the second colleague to connect
 * overwrote the first, and everybody sent through whichever account was
 * attached last. The lookup now takes the user as well, which is the rule 0058
 * exists to enforce — a caller who does not know who is asking cannot use it.
 *
 * Tokens are AES-256-GCM at rest, so this decrypts on the way out. A row
 * written under a key that has since changed reports as "no credential" rather
 * than crashing: the fix is the one the card already offers, which is
 * reconnect.
 *
 * The environment variables remain the fallback for a deployment configured
 * before install flows existed, and disappear with them.
 */
async function integration(admin: ReturnType<typeof createClient>, userId: string) {
  const { data: m } = await admin
    .from("memberships").select("workspace_id").eq("user_id", userId).limit(1).maybeSingle();
  if (!m?.workspace_id) return null;

  const { data } = await admin
    .from("integrations")
    .select("id, access_token_encrypted, metadata, provider_account_name, status")
    .eq("workspace_id", m.workspace_id)
    .eq("user_id", userId)
    .eq("provider", "meta")
    .neq("status", "disconnected")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!data) return null;

  let access_token: string | null = null;
  const payload = data.access_token_encrypted as string | null;
  if (payload) {
    try {
      const raw = Deno.env.get("INTEGRATION_ENCRYPTION_KEY");
      if (!raw) throw new Error("INTEGRATION_ENCRYPTION_KEY is not configured");
      const key = await crypto.subtle.importKey(
        "raw", Uint8Array.from(atob(raw), (c) => c.charCodeAt(0)),
        { name: "AES-GCM" }, false, ["decrypt"],
      );
      const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
      const plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: bytes.slice(0, 12) }, key, bytes.slice(12),
      );
      access_token = new TextDecoder().decode(plain);
    } catch {
      // Never the ciphertext, never the key: just that it could not be read.
      console.error("could not decrypt the stored meta token");
    }
  }

  return {
    access_token,
    account_label: (data.provider_account_name as string | null) ?? null,
    details: (data.metadata ?? {}) as Record<string, string | null>,
  };
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "unauthorized" }, 401);
    const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: u } = await supa.auth.getUser();
    if (!u?.user) return json({ error: "unauthorized" }, 401);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const conn = await integration(admin, u.user.id);
    const pageId = conn?.details?.page_id ?? Deno.env.get("META_PAGE_ID");
    const token = conn?.access_token ?? Deno.env.get("META_PAGE_ACCESS_TOKEN");
    if (!pageId || !token) {
      return json({ error: "Instagram is not connected. Press Connect on the Instagram card.", failure: "not_connected" }, 400);
    }

    const body = await req.json().catch(() => ({}));
    const text = String(body.text ?? "").trim();
    const recipient = String(body.recipient_id ?? "").trim();
    if (!text) return json({ error: "text is required" }, 400);
    if (!recipient) {
      return json({
        error: "This conversation did not record an Instagram id to reply to. Sync again and the newer copy will be answerable.",
        failure: "not_in_channel",
      }, 400);
    }
    if (text.length > MAX_CHARS) {
      return json({
        error: `Instagram caps a direct message at ${MAX_CHARS} characters and this is ${text.length}.`,
        failure: "too_long",
      }, 400);
    }

    const send = async (useHumanAgent: boolean) => {
      const payload: Record<string, unknown> = {
        recipient: { id: recipient },
        message: { text },
      };
      // MESSAGE_TAG + HUMAN_AGENT is the documented way to answer outside the
      // 24-hour window. Not sent by default: inside the window it is
      // unnecessary, and tagging every message would misrepresent ordinary
      // replies to Meta.
      if (useHumanAgent) {
        payload.messaging_type = "MESSAGE_TAG";
        payload.tag = "HUMAN_AGENT";
      }
      const r = await fetch(`${GRAPH}/${pageId}/messages?access_token=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      return { ok: r.ok, status: r.status, body: await r.json().catch(() => ({})) };
    };

    let res = await send(false);
    /* Code 10 outside the window. Retried ONCE with the human-agent tag rather
       than asking the person to press send again with a different checkbox:
       they typed the message themselves, which is exactly the condition the tag
       exists to declare. */
    if (!res.ok && res.body?.error?.code === 10) res = await send(true);

    if (!res.ok) {
      const err = res.body?.error ?? {};
      const code = err.code;
      console.error("instagram send failed", res.status, code, err.message);
      const windowClosed = code === 10 || code === 551;
      return json({
        error: windowClosed
          ? "Instagram will not deliver this: the person has not messaged in over 24 hours, and Meta only allows a reply inside that window (7 days for a human reply). They need to message first."
          : code === 190
            ? "The Instagram token has expired or been revoked. Generate a new Page access token."
            : (err.message ?? "Instagram refused the message"),
        failure: windowClosed ? "window_closed" : code === 190 ? "not_connected" : "send_failed",
      }, 400);
    }

    const me = u.user.email ?? "MadeEA";
    const { error: writeErr } = await supa.from("messages").upsert(
      {
        instagram_id: res.body?.message_id ?? `sent-${crypto.randomUUID()}`,
        source: "instagram",
        direction: "outbound",
        sender_name: me,
        sender_initials: ini(me.split("@")[0]),
        subject: String(body.subject ?? "Instagram"),
        preview: text.slice(0, 140),
        body: text,
        category: "reply",
        received_at: new Date().toISOString(),
        thread_id: body.thread_id ? String(body.thread_id) : null,
        reply_target: recipient,
      },
      { onConflict: "workspace_id,instagram_id" },
    );

    return json({ ok: true, id: res.body?.message_id, recorded: !writeErr, record_error: writeErr?.message });
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e), failure: "send_failed" }, 500);
  }
});
