// Edge Function: slack-sync   (Verify JWT: OFF. Auth enforced in code)
// Pulls recent messages from channels the bot is in into the messages table.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

/* Slack returns the token's granted scopes in a response header on every call.
   Captured here because "which scopes do we actually have" is the first
   question whenever Slack refuses something, and reading it off a header beats
   asking somebody to open the Slack admin and squint at a checklist. */
let grantedScopes = "";

async function slack(method: string, token: string, params: Record<string, string> = {}) {
  const r = await fetch(`https://slack.com/api/${method}?${new URLSearchParams(params)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const hdr = r.headers.get("x-oauth-scopes");
  if (hdr) grantedScopes = hdr;
  const d = await r.json();
  if (!d.ok) throw new Error(`slack ${method}: ${d.error}`);
  return d;
}

/** What the integration needs, and why, so a gap explains itself. */
const NEEDED: Record<string, string> = {
  "channels:read": "see which public channels the bot is in",
  "groups:read": "see private channels the bot is in",
  "channels:history": "read messages in public channels",
  "groups:history": "read messages in private channels",
  "users:read": "turn a Slack user id into a person's name",
  "chat:write": "post a message from the Communication Center",
};

const ini = (n: string) => n.split(/[ .]/).map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();


/**
 * The workspace's slack connection, or null.
 *
 * Read with the service role because access_token is revoked from the
 * `authenticated` role (0056): the browser can see THAT a channel is connected
 * and never the token behind it, which also means the caller's own client
 * cannot read it here. The workspace is resolved from the caller's membership,
 * so this can only ever return the connection of a workspace they are in.
 *
 * Falls back to the environment when there is no row. That fallback is what
 * lets a deployment that was configured the old way (a token pasted into
 * Supabase secrets) keep working until somebody presses Connect, rather than
 * every channel going dark the moment this ships.
 */
async function integration(admin: ReturnType<typeof createClient>, userId: string) {
  const { data: m } = await admin
    .from("memberships").select("workspace_id").eq("user_id", userId).limit(1).maybeSingle();
  if (!m?.workspace_id) return null;
  const { data } = await admin
    .from("workspace_integrations")
    .select("access_token, external_id, account_label, details")
    .eq("workspace_id", m.workspace_id)
    .eq("provider", "slack")
    .maybeSingle();
  return (data ?? null) as
    | { access_token: string | null; external_id: string | null; account_label: string | null; details: Record<string, string | null> }
    | null;
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

    /* The workspace's own Slack install, from pressing Connect. The env token
       is the fallback for a deployment configured before install flows
       existed. */
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const conn = await integration(admin, u.user.id);
    const token = conn?.access_token ?? Deno.env.get("SLACK_BOT_TOKEN");
    if (!token) {
      return json({ ok: false, configured: false, error: "Slack is not connected. Press Connect on the Slack card.", channels: [] }, 200);
    }

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

    /* Reports what actually happened, per channel, rather than one number.
       The previous version did `if (!error) synced++`, so a channel the bot
       could not read and a write the database refused both came back as
       "synced: 0" and looked identical to an empty channel. Three different
       problems wearing the same answer is the worst thing a sync can report. */
    let synced = 0;
    let skipped = 0;
    const detail: Record<string, unknown>[] = [];
    const errors: string[] = [];

    for (const ch of channels) {
      const row: Record<string, unknown> = { channel: ch.name, id: ch.id };
      let hist;
      try {
        hist = await slack("conversations.history", token, { channel: ch.id, limit: "20" });
      } catch (e) {
        // Almost always a missing channels:history / groups:history scope, or
        // the bot was removed from the channel. Say which channel.
        row.error = String(e instanceof Error ? e.message : e);
        errors.push(`#${ch.name}: ${row.error}`);
        detail.push(row);
        continue;
      }

      const all = hist.messages ?? [];
      row.messages_seen = all.length;
      let wrote = 0, skip = 0;
      const writeErrors: string[] = [];

      for (const msg of all) {
        // Joins, leaves and channel-topic changes are not correspondence.
        if (msg.subtype || !msg.text || !msg.user) { skip++; continue; }
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
        if (error) { writeErrors.push(error.message); } else { wrote++; }
      }

      row.written = wrote;
      row.skipped_non_messages = skip;
      if (writeErrors.length) {
        row.write_error = writeErrors[0];
        errors.push(`#${ch.name}: ${writeErrors[0]}`);
      }
      synced += wrote;
      skipped += skip;
      detail.push(row);
    }

    /* The app's own id, resolved from the bot token rather than asked for.
       App Configuration Tokens can edit an app's manifest but cannot list which
       apps exist, so the id has to come from somewhere. auth.test gives the bot
       id and bots.info turns that into the app id, which saves somebody digging
       through the Slack admin for a string they should not have to know. */
    let appId: string | undefined;
    try {
      const who = await slack("auth.test", token);
      if (who.bot_id) {
        const b = await slack("bots.info", token, { bot: String(who.bot_id) });
        appId = b.bot?.app_id;
      }
    } catch { /* diagnostics only; never fail the sync over this */ }

    const have = grantedScopes.split(",").map((x) => x.trim()).filter(Boolean);
    const missing = Object.keys(NEEDED).filter((n) => !have.includes(n));

    return json({
      synced,
      skipped,
      // The token's own answer, not our assumption about it.
      scopes: have,
      app_id: appId,
      missing_scopes: missing.length ? missing.map((m) => ({ scope: m, needed_to: NEEDED[m] })) : undefined,
      can_send: have.includes("chat:write"),
      channels: channels.length,
      channel_names: channels.map((c: { name: string }) => c.name),
      detail,
      errors: errors.length ? errors : undefined,
    });
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
