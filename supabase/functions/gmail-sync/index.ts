// Edge Function: gmail-sync   (Verify JWT: ON)
// Pulls the signed-in user's recent inbox into the messages table.
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

const g = (token: string, u: string) => fetch(u, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
const senderName = (from: string) => (from.match(/^"?([^"<]+?)"?\s*</)?.[1] ?? from.replace(/<.*>/, "")).trim() || from;
const ini = (n: string) => n.split(" ").map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();

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
    // above, so this reads exactly one row — the caller's — and never anyone
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

    const list = await g(token, "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=15&q=in:inbox");
    let synced = 0;
    for (const m of list.messages ?? []) {
      const full = await g(token, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`);
      const headers: Record<string, string> = Object.fromEntries((full.payload?.headers ?? []).map((h: { name: string; value: string }) => [h.name, h.value]));
      const sender = senderName(headers.From ?? "Unknown");
      const { error } = await supa.from("messages").upsert(
        {
          gmail_id: m.id,
          source: "gmail",
          sender_name: sender,
          sender_initials: ini(sender),
          subject: headers.Subject ?? "(no subject)",
          preview: full.snippet ?? "",
          body: full.snippet ?? "",
          category: "reply",
          received_at: new Date(parseInt(full.internalDate ?? `${Date.now()}`)).toISOString(),
        },
        { onConflict: "workspace_id,gmail_id" },
      );
      if (!error) synced++;
    }
    return json({ synced });
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
