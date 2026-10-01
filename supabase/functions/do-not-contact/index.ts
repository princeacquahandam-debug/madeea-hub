// Supabase Edge Function: do-not-contact  (self-contained. Paste as-is)
//
// The door n8n uses to the one do-not-contact list (migration 0079).
//
//   POST { action: "check", email?, phone?, instagram?, ghl_contact_id? }
//     -> { blocked: boolean, matches: [{ kind, value, source, created_at }] }
//
//   POST { action: "add", email?, phone?, instagram?, ghl_contact_id?,
//          source: "sms" | "instagram" | "whatsapp" | "email" | "manual",
//          message?, reason?, evidence_id? }
//     -> { blocked: true, added: number }
//
// Each identifier may be a string or an array of strings. Pass every one you
// have: a check blocks on any match, and an add records them all as one
// opt-out, so the next route to reach for this person finds them whichever
// identifier it holds.
//
// Auth: the `x-n8n-secret` header, checked against N8N_SHARED_SECRET, the same
// secret and the same n8n credential ("MadeEA n8n secret") the email organizer
// already uses. Deployed with --no-verify-jwt: n8n holds no Supabase key, and
// never should. Fails CLOSED: no secret configured means every call is refused.
//
// A "check" that cannot reach the list answers 503, never "not blocked". The
// workflows treat any failure as "don't send": a missed message costs a day,
// a message to someone who said stop costs more.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SHARED_SECRET = Deno.env.get("N8N_SHARED_SECRET") ?? "";

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

/** Length-independent constant-time compare, so the secret can't be probed byte by byte. */
function secretOk(given: string): boolean {
  if (!SHARED_SECRET) return false;
  const enc = new TextEncoder();
  const a = enc.encode(given);
  const b = enc.encode(SHARED_SECRET);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a[i % (a.length || 1)] ?? 0) ^ (b[i % (b.length || 1)] ?? 0);
  }
  return diff === 0;
}

const SOURCES = new Set(["sms", "instagram", "whatsapp", "email", "manual"]);

/** A string or an array of strings, as a clean array. */
function list(v: unknown): string[] {
  const arr = Array.isArray(v) ? v : v == null ? [] : [v];
  return arr.map((x) => String(x ?? "").trim()).filter((x) => x && x.length <= 320).slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!secretOk(req.headers.get("x-n8n-secret") ?? "")) return json({ error: "unauthorized" }, 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "body must be JSON" }, 400);
  }

  const ids = {
    email: list(body.email),
    phone: list(body.phone),
    instagram: list(body.instagram),
    ghl_contact: list(body.ghl_contact_id),
  };
  const total = ids.email.length + ids.phone.length + ids.instagram.length + ids.ghl_contact.length;
  if (!total) return json({ error: "give at least one of email, phone, instagram, ghl_contact_id" }, 400);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  if (body.action === "check") {
    const { data, error } = await db.rpc("do_not_contact_match", {
      p_emails: ids.email,
      p_phones: ids.phone,
      p_instagram: ids.instagram,
      p_ghl: ids.ghl_contact,
    });
    if (error) {
      console.error("do-not-contact check failed", error.message);
      return json({ error: "The do-not-contact list could not be read. Do not send." }, 503);
    }
    const matches = (data ?? []).map((m: Record<string, unknown>) => ({
      kind: m.kind, value: m.value, source: m.source, created_at: m.created_at,
    }));
    return json({ blocked: matches.length > 0, matches });
  }

  if (body.action === "add") {
    const source = String(body.source ?? "");
    if (!SOURCES.has(source)) return json({ error: `source must be one of ${[...SOURCES].join(", ")}` }, 400);
    const message = body.message == null ? null : String(body.message).slice(0, 500);
    const reason = body.reason == null ? null : String(body.reason).slice(0, 300);
    const evidence = body.evidence_id == null ? null : String(body.evidence_id).slice(0, 200);
    const batch = crypto.randomUUID();

    let added = 0;
    const errors: string[] = [];
    for (const [kind, values] of Object.entries(ids)) {
      for (const value of values) {
        /* One row at a time so a single bad value (a 4-digit "phone") doesn't
           drop the rest of the opt-out with it. 23505 means this identifier is
           already blocked, or this exact message was already recorded: both
           are the outcome we want. */
        const { error } = await db.from("do_not_contact").insert({
          kind, value, source, message, reason, evidence_id: evidence, batch, created_by: null,
        });
        if (!error) added++;
        else if (error.code !== "23505") errors.push(`${kind}: ${error.message}`);
      }
    }
    if (errors.length) console.error("do-not-contact add errors", errors);
    return json({ blocked: true, added, errors: errors.length ? errors : undefined });
  }

  return json({ error: 'action must be "check" or "add"' }, 400);
});
