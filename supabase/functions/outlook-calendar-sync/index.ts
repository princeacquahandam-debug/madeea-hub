// Edge Function: outlook-calendar-sync   (deployed with --no-verify-jwt; checks the JWT itself)
// Pulls a CLIENT's own Outlook / Microsoft 365 calendar into the meetings table
// (client portal, Connected accounts; 0084). Teams meetings are Outlook
// calendar events, so they arrive here too, with their Join link.
//
// CLIENTS ONLY. Staff Microsoft connections are granted mail and Teams chat,
// not the calendar, so for them this would only ever fail; it says so instead.
//
// WHO WRITES. The client's login holds no membership, so their own session
// cannot write meetings (workspace_id would be null). The server writes these
// rows: owner_id pinned to the verified caller, workspace and client taken
// from client_users, source 'outlook-client' (0084 limits those to the lead EA
// and admins).
//
// WHERE THE EVENT ID GOES. meetings is keyed per owner on gcal_event_id (0054).
// Outlook ids go in the same column, prefixed "ms:" so they can never collide
// with a Google id, rather than adding a second uniqueness for one provider.
//
// WHAT IS NOT STORED. The event body. Graph's bodyPreview is enough for a
// calendar, and the client's meeting notes are theirs.

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

const TENANT = Deno.env.get("MICROSOFT_TENANT") ?? "common";
const SCOPES = "offline_access https://graph.microsoft.com/Calendars.Read";

// deno-lint-ignore no-explicit-any
type Admin = any;

/** A fresh access token. Microsoft rotates refresh tokens, so the new one is kept. */
async function accessToken(admin: Admin, connectionId: string, refresh: string): Promise<string> {
  const r = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("MICROSOFT_CLIENT_ID") ?? Deno.env.get("MICROSOFT_APP_ID") ?? "",
      client_secret: Deno.env.get("MICROSOFT_CLIENT_SECRET") ?? "",
      refresh_token: refresh,
      grant_type: "refresh_token",
      scope: SCOPES,
    }),
  });
  const t = await r.json().catch(() => ({}));
  // Log the provider's detail; don't return it to the browser.
  if (!r.ok || !t.access_token) {
    console.error("microsoft token refresh failed", r.status, JSON.stringify(t));
    throw new Error("Your Outlook connection has expired. Disconnect and connect it again.");
  }
  await saveRefreshedTokens(admin, connectionId, t);
  return t.access_token;
}

/** Graph times arrive as "2026-10-07T14:00:00.0000000" in the zone asked for (UTC here). */
const utc = (s: string | undefined) => (s ? new Date(s.endsWith("Z") ? s : `${s}Z`).toISOString() : null);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "unauthorized" }, 401);
    const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: u } = await supa.auth.getUser();
    if (!u?.user) return json({ error: "unauthorized" }, 401);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: clientUser } = await admin
      .from("client_users").select("client_id, workspace_id").eq("user_id", u.user.id).maybeSingle();
    if (!clientUser) return json({ error: "Outlook calendar sync is for client accounts." }, 403);

    // Service role for this read only; the token is decrypted here and never leaves the function.
    const cred = await storedConnection(admin, u.user.id, "microsoft");
    if (!cred?.refresh_token) return json({ error: "Outlook is not connected." }, 400);
    const token = await accessToken(admin, cred.id, cred.refresh_token);

    const body = await req.json().catch(() => ({}));
    const timeMin = typeof body.timeMin === "string" ? new Date(body.timeMin).toISOString() : new Date(Date.now() - 30 * 864e5).toISOString();
    const timeMax = typeof body.timeMax === "string" ? new Date(body.timeMax).toISOString() : new Date(Date.now() + 120 * 864e5).toISOString();

    /* calendarView, not events: it expands recurring meetings into the
       occurrences in the window, which is what a calendar draws. Paged, and
       bounded at 10 pages so a pathological calendar cannot run the function
       until it times out. */
    const items: Record<string, any>[] = [];
    let next: string | undefined =
      `https://graph.microsoft.com/v1.0/me/calendarView?${new URLSearchParams({
        startDateTime: timeMin, endDateTime: timeMax, $top: "100", $orderby: "start/dateTime",
        $select: "id,subject,start,end,isAllDay,isCancelled,location,webLink,organizer,attendees,responseStatus,onlineMeeting,onlineMeetingUrl,bodyPreview,showAs",
      })}`;
    for (let page = 0; page < 10 && next; page++) {
      const res: Response = await fetch(next, {
        headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.timezone="UTC"' },
      });
      if (!res.ok) {
        const detail = await res.text();
        console.error("graph calendarView failed", res.status, detail.slice(0, 500));
        if (res.status === 403) {
          return json({ error: "This Outlook connection cannot read your calendar. Disconnect, connect again, and allow calendar access.", failure: "needs_scope" }, 403);
        }
        return json({ error: "Outlook refused the request. Try again in a minute." }, 502);
      }
      const d = await res.json();
      items.push(...(d.value ?? []));
      next = d["@odata.nextLink"];
    }

    const syncedAt = new Date().toISOString();
    let synced = 0;
    let failed = 0;
    let firstError = "";
    for (const ev of items) {
      if (ev.isCancelled) continue;
      const allDay = Boolean(ev.isAllDay);
      /* An all-day event is a date, not an instant: store it at UTC midnight
         of that date, as Google's all-day events are. */
      const start = allDay ? `${String(ev.start?.dateTime ?? "").slice(0, 10)}T00:00:00Z` : utc(ev.start?.dateTime);
      const end = allDay ? `${String(ev.end?.dateTime ?? "").slice(0, 10)}T00:00:00Z` : utc(ev.end?.dateTime);
      if (!start || start.startsWith("T")) continue;
      const id = `ms:${ev.id}`;

      const { error } = await admin.from("meetings").upsert(
        {
          owner_id: u.user.id,
          workspace_id: clientUser.workspace_id,
          client_id: clientUser.client_id,
          gcal_event_id: id,
          source: "outlook-client",
          title: ev.subject || "(busy)",
          starts_at: new Date(start).toISOString(),
          ends_at: end ? new Date(end).toISOString() : null,
          all_day: allDay,
          location: ev.location?.displayName || null,
          html_link: ev.webLink ?? null,
          hangout_link: ev.onlineMeeting?.joinUrl ?? ev.onlineMeetingUrl ?? null,
          organizer_email: ev.organizer?.emailAddress?.address ?? null,
          description: typeof ev.bodyPreview === "string" ? ev.bodyPreview.slice(0, 4000) : null,
          calendar_id: "outlook",
          /* Graph names zones the Windows way ("Pacific Standard Time"), which
             the browser cannot read. Left empty, the portal shows these in the
             viewer's own zone, which is right for a client's own calendar. */
          event_timezone: null,
          response_status: ev.responseStatus?.response ?? null,
          attendee_emails: Array.isArray(ev.attendees)
            ? ev.attendees.map((a: { emailAddress?: { address?: string } }) => a.emailAddress?.address).filter(Boolean)
            : [],
          synced_at: syncedAt,
          status: "pending",
        },
        { onConflict: "owner_id,gcal_event_id" },
      );
      if (error) { if (!firstError) firstError = error.message; failed++; }
      else synced++;
    }

    /* Moved or cancelled since the last sync: anything of theirs in this
       window that this run did not write (every row it wrote carries this
       run's synced_at). Only when the listing was whole (no page cap hit) and
       nothing failed, or a busy or half-saved calendar would lose events. */
    if (!next && failed === 0) {
      const { error } = await admin.from("meetings").delete()
        .eq("owner_id", u.user.id).eq("source", "outlook-client")
        .gte("starts_at", timeMin).lte("starts_at", timeMax)
        .lt("synced_at", syncedAt);
      if (error) console.error("stale outlook events not removed", error.message);
    }

    if (synced === 0 && failed > 0) {
      return json({ error: `No events could be saved. ${firstError}`, scanned: items.length, failed }, 500);
    }
    return json({ synced, failed, scanned: items.length, timeMin, timeMax });
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
