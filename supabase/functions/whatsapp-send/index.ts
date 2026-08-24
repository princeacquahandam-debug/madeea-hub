// Edge Function: whatsapp-send   (Verify JWT: ON, the default. Auth is ALSO enforced in code,
// so this is safe either way; leaving verification on is simply stricter. Only
// the two endpoints an outsider calls directly need it off: the OAuth callback
// and whatsapp-webhook.)
// Replies to a WhatsApp conversation through the Cloud API.
//
// THE 24-HOUR WINDOW IS THE WHOLE STORY, and it is stricter than Instagram's.
// A business may send freeform text only within 24 hours of the customer's last
// message. Outside it, Meta accepts nothing but a pre-approved template, and a
// template is not something this function can invent: it has to be written,
// submitted and approved in the WhatsApp Manager days in advance.
//
// So there is no retry-with-a-tag trick here of the kind instagram-send uses.
// Outside the window the honest answer is that the message cannot be sent from
// this app at all, and the person needs to either wait for the customer to
// write first or send an approved template from WhatsApp Manager. Saying
// anything vaguer would have somebody pressing Send at a client who will never
// receive it.
//
// ENV
//   WHATSAPP_PHONE_NUMBER_ID   from WhatsApp Manager, NOT the phone number
//   WHATSAPP_TOKEN             system-user token with whatsapp_business_messaging

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const GRAPH = "https://graph.facebook.com/v21.0";
/** WhatsApp's own cap on a text body. */
const MAX_CHARS = 4096;

const ini = (n: string) => n.split(/[ ._]/).map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const phoneId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
    const token = Deno.env.get("WHATSAPP_TOKEN") ?? Deno.env.get("META_PAGE_ACCESS_TOKEN");
    if (!phoneId || !token) {
      return json({
        error: "WhatsApp not configured (set WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_TOKEN)",
        failure: "not_connected",
      }, 400);
    }

    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "unauthorized" }, 401);
    const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: u } = await supa.auth.getUser();
    if (!u?.user) return json({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const text = String(body.text ?? "").trim();
    /* A wa_id: digits, no plus, no spaces. Normalised rather than rejected,
       because the same number is written four ways by four people and Meta
       accepts exactly one of them. */
    const to = String(body.to ?? "").replace(/[^\d]/g, "");
    if (!text) return json({ error: "text is required" }, 400);
    if (!to) {
      return json({
        error: "This conversation did not record a WhatsApp number to reply to.",
        failure: "not_in_channel",
      }, 400);
    }
    if (text.length > MAX_CHARS) {
      return json({
        error: `WhatsApp caps a message at ${MAX_CHARS} characters and this is ${text.length}.`,
        failure: "too_long",
      }, 400);
    }

    const r = await fetch(`${GRAPH}/${phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        // Link previews off: a preview of a link in a client reply is Meta
        // fetching that URL on our behalf, which is a surprise nobody asked for.
        text: { preview_url: false, body: text },
      }),
    });
    const sent = await r.json().catch(() => ({}));

    if (!r.ok) {
      const err = sent?.error ?? {};
      const code = err.code;
      console.error("whatsapp send failed", r.status, code, err.message, err.error_data?.details);
      /* 131047 is re-engagement: the window has closed. 131026 is undeliverable
         (not a WhatsApp number, or the person has never opted in). 190 is a
         dead token. Three different problems, three different sentences. */
      const windowClosed = code === 131047 || code === 131051;
      const undeliverable = code === 131026 || code === 131052;
      return json({
        error: windowClosed
          ? "WhatsApp only allows a freeform reply within 24 hours of the customer's last message, and that window has closed. They need to message first, or send an approved template from WhatsApp Manager."
          : undeliverable
            ? "WhatsApp cannot deliver to that number. It may not be a WhatsApp account."
            : code === 190
              ? "The WhatsApp token has expired or been revoked. Generate a new system-user token."
              : (err.message ?? "WhatsApp refused the message"),
        failure: windowClosed ? "window_closed" : code === 190 ? "not_connected" : "send_failed",
        detail: err.error_data?.details,
      }, 400);
    }

    const id = sent?.messages?.[0]?.id ?? `sent-${crypto.randomUUID()}`;
    const me = u.user.email ?? "MadeEA";
    const { error: writeErr } = await supa.from("messages").upsert(
      {
        whatsapp_id: id,
        source: "whatsapp",
        direction: "outbound",
        sender_name: me,
        sender_initials: ini(me.split("@")[0]),
        subject: String(body.subject ?? `+${to}`),
        preview: text.slice(0, 140),
        body: text,
        category: "reply",
        received_at: new Date().toISOString(),
        thread_id: to,
        reply_target: to,
      },
      { onConflict: "workspace_id,whatsapp_id" },
    );

    return json({ ok: true, id, recorded: !writeErr, record_error: writeErr?.message });
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e), failure: "send_failed" }, 500);
  }
});
