// Edge Function: whatsapp-webhook   (Verify JWT: OFF. Meta posts here with no session.)
//
// The ONLY way a WhatsApp message ever reaches this app.
//
// The Cloud API has no endpoint for past messages. There is no "list my
// conversations", no history, no cursor. Meta POSTs each inbound message once,
// to this URL, and if the request is refused or the function is down the
// message is retried for a while and then gone for good. That single fact is
// why WhatsApp has no Sync button anywhere in the product, and why this
// function is the integration rather than a convenience on top of it.
//
// ── Two checks, and neither is optional ───────────────────────────────────
//
// 1. GET is Meta's subscription handshake. It sends hub.verify_token and
//    expects hub.challenge echoed back verbatim, as plain text, only when the
//    token matches. Getting this wrong means the webhook never subscribes.
//
// 2. POST is unauthenticated by definition: anyone on the internet can hit this
//    URL and claim to be Meta. X-Hub-Signature-256 is an HMAC of the raw body
//    with the app secret, and verifying it is the only thing standing between a
//    real client message and a stranger writing whatever they like into
//    somebody's inbox. Unsigned requests are refused rather than trusted.
//
// ── Whose inbox it lands in ───────────────────────────────────────────────
//
// Every other writer of `messages` runs as a signed-in person, so owner_id and
// workspace_id come from defaults. Meta is not signed in. The workspace is
// resolved by inbound_message_owner() (0050), which answers only when the
// deployment has exactly one workspace, or is named explicitly by
// INBOUND_WORKSPACE_ID / INBOUND_OWNER_ID. If neither can answer, the message
// is NOT written to a guessed workspace: it is logged and refused, because
// filing a client's WhatsApp message into the wrong team's inbox is worse than
// losing it.
//
// ENV
//   META_VERIFY_TOKEN     any string you also type into Meta's webhook setup
//   META_APP_SECRET       from the Meta app's Basic Settings. Signature check.
//   INBOUND_WORKSPACE_ID  optional, only needed for a multi-workspace deployment
//   INBOUND_OWNER_ID      optional, ditto

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

/** Constant-time compare, so a wrong signature cannot be found byte by byte. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function validSignature(raw: string, header: string | null, secret: string): Promise<boolean> {
  if (!header?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return safeEqual(hex, header.slice(7));
}

const ini = (n: string) => n.split(/[ ._]/).map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();

interface WaContact { wa_id?: string; profile?: { name?: string } }
interface WaMessage {
  id?: string;
  from?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  /** Everything that is not text still says something; see textOf. */
  button?: { text?: string };
  interactive?: { list_reply?: { title?: string }; button_reply?: { title?: string } };
  image?: { caption?: string };
  video?: { caption?: string };
  document?: { filename?: string; caption?: string };
}

/**
 * The readable content of a WhatsApp message.
 *
 * Media is not dropped silently. A client who sends a photo of an invoice with
 * no caption has said something, and an inbox that shows nothing for it looks
 * like the integration is broken. The placeholder names the type so the EA
 * knows to open WhatsApp for it.
 */
function textOf(m: WaMessage): string {
  if (m.text?.body) return m.text.body;
  if (m.button?.text) return m.button.text;
  if (m.interactive?.button_reply?.title) return m.interactive.button_reply.title;
  if (m.interactive?.list_reply?.title) return m.interactive.list_reply.title;
  if (m.image) return m.image.caption ? `[photo] ${m.image.caption}` : "[photo]";
  if (m.video) return m.video.caption ? `[video] ${m.video.caption}` : "[video]";
  if (m.document) return `[file] ${m.document.filename ?? ""}${m.document.caption ? ` ${m.document.caption}` : ""}`.trim();
  if (m.type === "audio") return "[voice note]";
  if (m.type === "location") return "[location]";
  if (m.type === "sticker") return "[sticker]";
  return "";
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // ── Meta's subscription handshake ──────────────────────────────────────
  if (req.method === "GET") {
    const verify = Deno.env.get("META_VERIFY_TOKEN");
    const mode = url.searchParams.get("hub.mode");
    const tokenSent = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge") ?? "";
    if (!verify) return new Response("META_VERIFY_TOKEN is not configured", { status: 500 });
    if (mode === "subscribe" && tokenSent && safeEqual(tokenSent, verify)) {
      // Plain text, exactly as sent. Meta rejects anything else, JSON included.
      return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
    }
    return new Response("verification failed", { status: 403 });
  }

  if (req.method !== "POST") return new Response("POST only", { status: 405 });

  try {
    const secret = Deno.env.get("META_APP_SECRET");
    // No secret, no writes. An unverifiable webhook is an open door into the
    // team's inbox, and running without the check "just for now" is how it
    // stays off for a year.
    if (!secret) {
      console.error("META_APP_SECRET is not set; refusing unverifiable webhook");
      return json({ error: "not configured" }, 500);
    }

    const raw = await req.text();
    if (!(await validSignature(raw, req.headers.get("x-hub-signature-256"), secret))) {
      console.error("whatsapp webhook: bad signature");
      return json({ error: "bad signature" }, 401);
    }

    const payload = JSON.parse(raw);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Where it lands. Explicit env wins; otherwise the single-workspace answer.
    let workspaceId = Deno.env.get("INBOUND_WORKSPACE_ID") ?? null;
    let ownerId = Deno.env.get("INBOUND_OWNER_ID") ?? null;
    if (!workspaceId || !ownerId) {
      const { data } = await admin.rpc("inbound_message_owner");
      const row = Array.isArray(data) ? data[0] : data;
      workspaceId = workspaceId ?? row?.workspace_id ?? null;
      ownerId = ownerId ?? row?.owner_id ?? null;
    }
    if (!workspaceId || !ownerId) {
      /* 200 on purpose. Meta retries a non-2xx for hours and this is not a
         transient fault: it is a deployment that has not said where inbound
         mail belongs. Retrying cannot fix it, and the log says what will. */
      console.error("whatsapp webhook: no workspace to file into. Set INBOUND_WORKSPACE_ID and INBOUND_OWNER_ID.");
      return json({ ok: true, stored: 0, error: "no workspace configured" });
    }

    let stored = 0;
    const errors: string[] = [];

    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value ?? {};
        const contacts: WaContact[] = value.contacts ?? [];
        const nameOf = (waId: string) =>
          contacts.find((c) => c.wa_id === waId)?.profile?.name ?? `+${waId}`;

        /* statuses are delivery receipts (sent/delivered/read) for messages WE
           sent. Real events, but not correspondence: an inbox that shows three
           rows every time a message is read is unusable. */
        for (const m of (value.messages ?? []) as WaMessage[]) {
          const from = m.from ?? "";
          const text = textOf(m);
          if (!from || !m.id || !text) continue;

          const who = nameOf(from);
          const { error } = await admin.from("messages").upsert(
            {
              workspace_id: workspaceId,
              owner_id: ownerId,
              whatsapp_id: m.id,
              source: "whatsapp",
              direction: "inbound",
              sender_name: who,
              sender_initials: ini(who.replace(/^\+/, "")),
              subject: who,
              preview: text.slice(0, 140),
              body: text,
              category: "reply",
              received_at: m.timestamp
                ? new Date(Number(m.timestamp) * 1000).toISOString()
                : new Date().toISOString(),
              /* The wa_id twice, deliberately: as the thread so the
                 conversation groups by person, and as the reply target because
                 that is literally the address a reply is sent to. */
              thread_id: from,
              reply_target: from,
            },
            { onConflict: "workspace_id,whatsapp_id" },
          );
          if (error) errors.push(error.message);
          else stored++;
        }
      }
    }

    if (errors.length) console.error("whatsapp webhook write errors", errors.slice(0, 3));
    /* Always 200 once the signature is good. Meta treats anything else as a
       failed delivery and redelivers the same message repeatedly; a database
       error is ours to see in the logs, not Meta's to retry into. */
    return json({ ok: true, stored });
  } catch (e) {
    console.error("whatsapp webhook error", e instanceof Error ? e.message : e);
    return json({ ok: true, stored: 0 });
  }
});
