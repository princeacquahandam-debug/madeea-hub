// Edge Function: calendar-sync   (Verify JWT: ON)
// Pulls the signed-in user's upcoming Google Calendar events into the meetings table.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    throw new Error("Google connection expired — please reconnect in Integrations.");
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

    const { data: cred } = await supa.from("google_credentials").select("refresh_token").eq("owner_id", u.user.id).maybeSingle();
    if (!cred?.refresh_token) return json({ error: "Google not connected" }, 400);
    const token = await accessToken(cred.refresh_token);

    const now = new Date().toISOString();
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(now)}&maxResults=10&singleEvents=true&orderBy=startTime`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const list = await res.json();
    let synced = 0;
    for (const ev of list.items ?? []) {
      const start = ev.start?.dateTime ?? ev.start?.date;
      const { error } = await supa.from("meetings").upsert(
        {
          gcal_event_id: ev.id,
          source: "gcal",
          title: ev.summary ?? "(busy)",
          starts_at: start ? new Date(start).toISOString() : null,
          status: "pending",
        },
        { onConflict: "workspace_id,gcal_event_id" },
      );
      if (!error) synced++;
    }
    return json({ synced });
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
