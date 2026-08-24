// Edge Function: calendar-sync   (Verify JWT: ON)
// Pulls the signed-in user's upcoming Google Calendar events into the meetings table.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

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
    const { data: cred, error: credErr } = await admin
      .from("google_credentials").select("refresh_token").eq("owner_id", u.user.id).maybeSingle();
    if (credErr) {
      console.error("google_credentials read failed", credErr.message);
      return json({ error: "Could not read the Google connection." }, 500);
    }
    if (!cred?.refresh_token) return json({ error: "Google not connected" }, 400);
    const token = await accessToken(cred.refresh_token);

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

      const { error } = await supa.from("meetings").upsert(
        {
          gcal_event_id: ev.id,
          source: "gcal",
          title: ev.summary ?? "(busy)",
          starts_at: new Date(start).toISOString(),
          ends_at: end ? new Date(end).toISOString() : null,
          all_day: allDay,
          location: ev.location ?? null,
          html_link: ev.htmlLink ?? null,
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
