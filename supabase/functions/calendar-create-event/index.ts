// Edge Function: calendar-create-event   (Verify JWT: OFF. Auth enforced in code.)
//
// Books a real event on the caller's Google Calendar, and mirrors it into
// `meetings` so the app shows it without waiting for the next sync.
//
// WHY THIS EXISTS. The calendar could be read and never written. "Plan the
// Calendar" would describe a better arrangement of somebody's day and then
// leave them to go and type all of it into Google by hand, which is most of the
// work it claimed to save. Reading a calendar you cannot act on is a report,
// not a tool.
//
// The scope is calendar.events, not the full calendar scope: create, update and
// delete events on calendars this account can already see, and nothing about
// calendar settings or new calendars. Narrowest thing that makes booking work.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

/* ── STORED TOKENS, ENCRYPTED (CASA pre-check, 19 Nov 2026) ───────────────
   The connection is read from `integrations`, where tokens are AES-256-GCM
   ciphertext, base64(iv || ciphertext || tag), with the key in
   INTEGRATION_ENCRYPTION_KEY and never in the database. This function used to
   read the plain-text copy in google_credentials / microsoft_credentials,
   which the old sign-in kept writing alongside; those copies are being wiped.
   Same scheme as gmail-sync's token manager. Edge Functions here are deployed
   one file at a time, so it is repeated in each function that needs it. */
async function tokAesKey(usage: KeyUsage[]) {
  const raw = Deno.env.get("INTEGRATION_ENCRYPTION_KEY");
  if (!raw) throw new Error("INTEGRATION_ENCRYPTION_KEY is not configured");
  return await crypto.subtle.importKey(
    "raw", Uint8Array.from(atob(raw), (c) => c.charCodeAt(0)),
    { name: "AES-GCM" }, false, usage,
  );
}

async function tokEncrypt(plain: string): Promise<string> {
  const key = await tokAesKey(["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain)),
  );
  const out = new Uint8Array(iv.length + cipher.length);
  out.set(iv);
  out.set(cipher, iv.length);
  return btoa(String.fromCharCode(...out));
}

async function tokDecrypt(payload: string | null | undefined): Promise<string | null> {
  if (!payload) return null;
  try {
    const key = await tokAesKey(["decrypt"]);
    const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, key, bytes.slice(12));
    return new TextDecoder().decode(plain);
  } catch {
    // Encrypted under a key that has since changed: same fix as no connection, reconnect.
    console.error("could not decrypt a stored token; the encryption key may have changed");
    return null;
  }
}

/** This person's own connection for a provider: refresh token decrypted, plus the granted scopes.
    user_id and provider, always both. Rows without a stored token (0058's
    reauth placeholders) and disconnected rows are skipped. Oldest first, the
    same choice gmail-sync makes, so send and sync use the same account. */
// deno-lint-ignore no-explicit-any
async function storedConnection(admin: any, userId: string, provider: "google" | "microsoft"):
  Promise<{ id: string; refresh_token: string | null; scopes: string | null } | null> {
  const { data, error } = await admin
    .from("integrations")
    .select("id, refresh_token_encrypted, scopes")
    .eq("user_id", userId)
    .eq("provider", provider)
    .neq("status", "disconnected")
    .not("refresh_token_encrypted", "is", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("integrations read failed", error.message);
    throw new Error("Could not read the connection.");
  }
  if (!data) return null;
  return {
    id: data.id as string,
    refresh_token: await tokDecrypt(data.refresh_token_encrypted as string | null),
    scopes: (data.scopes as string | null) ?? null,
  };
}

/** Keep a refreshed token, encrypted. Microsoft rotates refresh tokens; Google does not. */
// deno-lint-ignore no-explicit-any
async function saveRefreshedTokens(admin: any, connectionId: string,
  t: { access_token: string; refresh_token?: string | null; expires_in?: number | string | null }) {
  const patch: Record<string, unknown> = {
    access_token_encrypted: await tokEncrypt(t.access_token),
    token_expires_at: new Date(Date.now() + Number(t.expires_in ?? 3600) * 1000).toISOString(),
    status: "connected",
    last_error: null,
    updated_at: new Date().toISOString(),
  };
  if (t.refresh_token) patch.refresh_token_encrypted = await tokEncrypt(t.refresh_token);
  await admin.from("integrations").update(patch).eq("id", connectionId);
}


const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

async function accessToken(refresh: string): Promise<string> {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
      refresh_token: refresh,
      grant_type: "refresh_token",
    }),
  });
  const t = await r.json();
  if (!r.ok) {
    console.error("google token refresh failed", r.status, JSON.stringify(t));
    throw new Error("Google connection expired. Please reconnect in Integrations.");
  }
  return t.access_token;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

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

    /* Service role for the credential read only. 0016 revokes refresh_token
       from `authenticated`, so the caller's own token cannot read it either.
       owner_id is pinned to the verified user, so this reads exactly one row. */
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const cred = await storedConnection(admin, u.user.id, "google");
    if (!cred?.refresh_token) return json({ error: "Google is not connected.", failure: "not_connected" }, 400);

    /* Checked BEFORE calling Google, so the answer is "reconnect and allow
       calendar changes" rather than a 403 from an API the user never saw. A
       token granted when the app only asked for calendar.readonly is perfectly
       valid and simply cannot write. */
    const scopes = String(cred.scopes ?? "");
    if (!scopes.includes("calendar.events") && !scopes.includes("auth/calendar ")) {
      return json({
        error: "This Google connection can read your calendar but not add to it. Reconnect and allow calendar changes.",
        failure: "needs_scope",
      }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const title = String(body.title ?? "").trim();
    const startsAt = String(body.startsAt ?? "");
    const endsAt = String(body.endsAt ?? "");
    const timeZone = String(body.timeZone ?? "UTC");
    const description = String(body.description ?? "").trim();
    const location = String(body.location ?? "").trim();
    /* Whether to attach a Google Meet room. Opt-in rather than always: a
        "block focus time" event with a video call on it is noise, and Google
        charges a conference create against the organiser either way. */
    const addMeet = body.addMeet === true;
    const attendees: string[] = Array.isArray(body.attendees)
      ? body.attendees.map((a: unknown) => String(a).trim().toLowerCase()).filter((a: string) => EMAIL_RE.test(a))
      : [];

    if (!title) return json({ error: "A title is required." }, 400);
    const start = new Date(startsAt);
    const end = new Date(endsAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return json({ error: "A valid start and end are required." }, 400);
    }
    /* Google accepts an end before a start and produces an event that renders
       as a single line, which looks like a successful booking and is not one. */
    if (end <= start) return json({ error: "The end time must be after the start time." }, 400);

    const token = await accessToken(cred.refresh_token);

    const res = await fetch(
      // sendUpdates=all so invitees are actually told. Creating an event with
      // attendees who are never notified is worse than not inviting them.
      /* conferenceDataVersion=1 is what makes Google honour conferenceData at
         all. At 0 — which this used to send unconditionally — the field is
         accepted and silently ignored, so the event is created with no room and
         no error to explain it. */
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all&conferenceDataVersion=${addMeet ? 1 : 0}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          summary: title,
          description: description || undefined,
          location: location || undefined,
          start: { dateTime: start.toISOString(), timeZone },
          end: { dateTime: end.toISOString(), timeZone },
          attendees: attendees.length ? attendees.map((email) => ({ email })) : undefined,
          /* requestId is Google's idempotency key for the conference. A retry
             carrying the same id returns the SAME room rather than minting a
             second one, which is what makes a network-level retry safe here. */
          conferenceData: addMeet
            ? {
                createRequest: {
                  requestId: crypto.randomUUID(),
                  conferenceSolutionKey: { type: "hangoutsMeet" },
                },
              }
            : undefined,
        }),
      },
    );

    const ev = await res.json();

    /* Where the call actually is. hangoutLink is the convenient form; the
       entryPoints array is the authoritative one, and Google has returned a
       conference with entry points and no hangoutLink. Read both. */
    const meetUrl: string | null =
      ev?.hangoutLink ??
      ev?.conferenceData?.entryPoints?.find((e: { entryPointType?: string; uri?: string }) =>
        e.entryPointType === "video")?.uri ??
      null;
    if (!res.ok) {
      console.error("calendar insert failed", res.status, JSON.stringify(ev));
      if (res.status === 401 || res.status === 403) {
        return json({
          error: "Google refused to add the event. Reconnect and allow calendar changes.",
          failure: "needs_scope",
        }, 403);
      }
      return json({ error: ev?.error?.message ?? "Google could not create the event." }, res.status);
    }

    /* Mirrored immediately, through the CALLER's client so RLS and the column
       defaults apply. Waiting for the next sync would mean creating an event
       and watching the calendar not change, which reads as a failure. */
    const { error: rowErr } = await supa.from("meetings").upsert(
      {
        gcal_event_id: ev.id,
        source: "gcal",
        title,
        starts_at: start.toISOString(),
        ends_at: end.toISOString(),
        all_day: false,
        location: location || null,
        html_link: ev.htmlLink ?? null,
        hangout_link: meetUrl,
        organizer_email: ev.organizer?.email ?? null,
        description: description || null,
        calendar_id: "primary",
        attendee_emails: attendees,
        event_timezone: timeZone,
        response_status: "accepted",
        synced_at: new Date().toISOString(),
        status: "pending",
      },
      { onConflict: "owner_id,gcal_event_id" },
    );

    return json({
      ok: true,
      id: ev.id,
      htmlLink: ev.htmlLink ?? null,
      hangoutLink: meetUrl,
      /* Asked for and not given. A Workspace policy can forbid Meet creation,
         and Google's answer is a perfectly successful event with no conference
         on it. Reporting that as a clean success is how somebody sends out an
         invitation to a call that does not exist. */
      meetRequested: addMeet,
      meetMissing: addMeet && !meetUrl,
      /* The event IS on Google at this point. If only the mirror failed, say so
         rather than reporting a clean success or a failure, because both would
         be wrong and one of them invites a duplicate booking. */
      warning: rowErr ? `Added to Google, but this app's copy did not update: ${rowErr.message}` : undefined,
    });
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
