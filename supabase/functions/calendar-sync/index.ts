// Edge Function: calendar-sync   (Verify JWT: ON)
// Pulls the signed-in user's upcoming Google Calendar events into the meetings table.
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
  // Log the provider's detail; don't return it to the browser.
  if (!r.ok) {
    console.error("google token refresh failed", r.status, JSON.stringify(t));
    throw new Error("Google connection expired. Please reconnect in Integrations.");
  }
  return t.access_token;
}

/** Google Meet first, then any other video entry point (Zoom add-on etc.). */
function meetLink(ev: Record<string, any>): string | null {
  if (typeof ev.hangoutLink === "string") return ev.hangoutLink;
  const video = (ev.conferenceData?.entryPoints ?? []).find((p: { entryPointType?: string }) => p?.entryPointType === "video");
  return typeof video?.uri === "string" ? video.uri : null;
}

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

    // Service role for this read only: 0016 revokes refresh_token from the
    // `authenticated` role so the browser can never read it, which also means
    // the caller's own token can't. owner_id is pinned to the JWT-verified user
    // above, so this reads exactly one row (the caller's) and never anyone
    // else's. Everything below still runs through the caller's RLS-scoped client.
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const cred = await storedConnection(admin, u.user.id, "google");
    if (!cred?.refresh_token) return json({ error: "Google not connected" }, 400);
    const token = await accessToken(cred.refresh_token);

    /* A CLIENT'S CALENDAR (client portal). Their login holds no membership,
       so a write through their own session fails RLS (workspace_id would be
       null), and their events must carry client_id for client_calendar to
       show them. So the server writes these rows: owner_id pinned to the
       verified caller, the workspace and client taken from client_users,
       source 'gcal-client' (0083 limits those to the lead EA and admins). */
    const { data: clientUser } = await admin
      .from("client_users").select("client_id, workspace_id").eq("user_id", u.user.id).maybeSingle();
    const writer = clientUser ? admin : supa;
    const clientFields = clientUser
      ? { owner_id: u.user.id, workspace_id: clientUser.workspace_id, client_id: clientUser.client_id }
      : {};

    /* A WINDOW, not "the next ten things".
       This asked for maxResults=10 from now, which is a dashboard widget, not a
       calendar: opening last month showed nothing, and a busy fortnight was
       truncated without saying so. The page asks for the range it is drawing. */
    const body = await req.json().catch(() => ({}));
    const timeMin = typeof body.timeMin === "string"
      ? new Date(body.timeMin).toISOString()
      : new Date(Date.now() - 30 * 864e5).toISOString();
    const timeMax = typeof body.timeMax === "string"
      ? new Date(body.timeMax).toISOString()
      : new Date(Date.now() + 90 * 864e5).toISOString();

    /* Paginated. Google caps a page at 250 and hands back a token; stopping at
       the first page would silently drop the rest of a busy month, which looks
       identical to having no meetings. Bounded at 10 pages so a pathological
       calendar cannot run the function until it times out. */
    const items: Record<string, any>[] = [];
    let calendarTz = "";
    let pageToken: string | undefined;
    for (let page = 0; page < 10; page++) {
      const qs = new URLSearchParams({
        timeMin, timeMax,
        maxResults: "250",
        singleEvents: "true",   // expands recurring events into occurrences
        orderBy: "startTime",
        showDeleted: "false",
      });
      if (pageToken) qs.set("pageToken", pageToken);

      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events?${qs}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) {
        const detail = await res.text();
        /* 403 here is almost always the calendar scope missing from a token
           granted before it was asked for. Naming it beats "sync failed",
           which cannot be acted on. */
        if (res.status === 403) {
          return json({
            error: "This Google connection cannot read your calendar. Reconnect and allow calendar access.",
            failure: "needs_scope",
          }, 403);
        }
        return json({ error: `Google Calendar refused the request: ${detail.slice(0, 200)}` }, res.status);
      }
      const listPage = await res.json();
      /* The zone the calendar is kept in. Google renders in this and we were
         rendering in the browser's, so an 8pm Manila meeting read as 5am on a
         laptop set to Mountain time. */
      if (!calendarTz && typeof listPage.timeZone === "string") calendarTz = listPage.timeZone;
      items.push(...(listPage.items ?? []));
      pageToken = listPage.nextPageToken;
      if (!pageToken) break;
    }

    const syncedAt = new Date().toISOString();
    let synced = 0;
    let failed = 0;
    let firstError = "";
    for (const ev of items) {
      // An all-day event carries `date`; a timed one carries `dateTime`.
      const allDay = Boolean(ev.start?.date && !ev.start?.dateTime);
      const start = ev.start?.dateTime ?? ev.start?.date;
      const end = ev.end?.dateTime ?? ev.end?.date;
      if (!start) continue;

      const { error } = await writer.from("meetings").upsert(
        {
          ...clientFields,
          gcal_event_id: ev.id,
          source: clientUser ? "gcal-client" : "gcal",
          title: ev.summary ?? "(busy)",
          starts_at: new Date(start).toISOString(),
          ends_at: end ? new Date(end).toISOString() : null,
          all_day: allDay,
          location: ev.location ?? null,
          html_link: ev.htmlLink ?? null,
          /* The Meet room, so a client (and the EA) can join from MadeEA. Only
             written when Google has one: an event booked by
             calendar-create-event already carries its link, and an empty
             answer here must not wipe it. */
          ...(meetLink(ev) ? { hangout_link: meetLink(ev) } : {}),
          organizer_email: ev.organizer?.email ?? null,
          description: typeof ev.description === "string" ? ev.description.slice(0, 4000) : null,
          calendar_id: "primary",
          event_timezone: ev.start?.timeZone ?? calendarTz ?? null,
          /* This account's own answer, not the meeting's. `self` is the flag
             Google sets on the attendee that is you; the organiser often has
             no attendee entry at all, which is why this can be null. */
          response_status:
            (Array.isArray(ev.attendees)
              ? ev.attendees.find((a: { self?: boolean }) => a?.self)?.responseStatus
              : null) ?? null,
          attendee_emails: Array.isArray(ev.attendees)
            ? ev.attendees.map((a: { email?: string }) => a.email).filter(Boolean)
            : [],
          synced_at: syncedAt,
          status: "pending",
        },
        /* Per owner, not per workspace. Everyone here shares one workspace and
           "Team Meeting" is on all nine calendars: a workspace-scoped conflict
           target made the second person's sync overwrite the first person's
           row instead of creating their own. See 0053. */
        { onConflict: "owner_id,gcal_event_id" },
      );
      /* A write that fails must say so. This counted successes and discarded
         every error, so a broken conflict target reported "synced 0" from 16
         events and read as an empty calendar rather than a failure. */
      if (error) { if (!firstError) firstError = error.message; failed++; }
      else synced++;
    }

    if (synced === 0 && failed > 0) {
      return json({ error: `No events could be saved. ${firstError}`, scanned: items.length, failed }, 500);
    }

    return json({ synced, failed, scanned: items.length, timeMin, timeMax });
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
