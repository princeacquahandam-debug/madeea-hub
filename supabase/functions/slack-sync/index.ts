// Edge Function: slack-sync   (Verify JWT: OFF — auth enforced in code)
// Pulls recent messages from channels the bot is in into the messages table.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

async function slack(method: string, token: string, params: Record<string, string> = {}) {
  const r = await fetch(`https://slack.com/api/${method}?${new URLSearchParams(params)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const d = await r.json();
  if (!d.ok) throw new Error(`slack ${method}: ${d.error}`);
  return d;
}

const ini = (n: string) => n.split(/[ .]/).map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const token = Deno.env.get("SLACK_BOT_TOKEN");
    if (!token) return json({ error: "Slack not configured (set SLACK_BOT_TOKEN)" }, 400);

    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "unauthorized" }, 401);
    const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: u } = await supa.auth.getUser();
    if (!u?.user) return json({ error: "unauthorized" }, 401);

    // user id -> display name
    const users = await slack("users.list", token, { limit: "200" });
    const names: Record<string, string> = {};
    for (const m of users.members ?? []) names[m.id] = m.profile?.real_name || m.real_name || m.name || "Slack user";

    const conv = await slack("conversations.list", token, {
      types: "public_channel,private_channel",
      exclude_archived: "true",
      limit: "100",
    });
    const channels = (conv.channels ?? []).filter((c: { is_member: boolean }) => c.is_member).slice(0, 8);

    let synced = 0;
    for (const ch of channels) {
      const hist = await slack("conversations.history", token, { channel: ch.id, limit: "10" });
      for (const msg of hist.messages ?? []) {
        if (msg.subtype || !msg.text || !msg.user) continue;
        const sender = names[msg.user] ?? "Slack user";
        const { error } = await supa.from("messages").upsert(
          {
            slack_ts: msg.ts,
            source: "slack",
            sender_name: sender,
            sender_initials: ini(sender),
            subject: `#${ch.name}`,
            preview: String(msg.text).slice(0, 140),
            body: msg.text,
            category: "reply",
            received_at: new Date(parseFloat(msg.ts) * 1000).toISOString(),
          },
          { onConflict: "workspace_id,slack_ts" },
        );
        if (!error) synced++;
      }
    }
    return json({ synced, channels: channels.length });
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
