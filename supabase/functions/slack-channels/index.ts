// Edge Function: slack-channels   (Verify JWT: OFF. Auth enforced in code.)
//
// Lists the workspace's channels so the Communication Center can SHOW where a
// message is going instead of asking somebody to type a channel name from
// memory.
//
// WHY THIS EXISTS AS ITS OWN FUNCTION. slack-sync reads messages and only ever
// looked at channels the bot had joined, because those are the only ones it can
// read. But posting and reading have different requirements: with
// chat:write.public the bot can post to a public channel it has never joined,
// while reading that same channel returns nothing. A picker built from the sync
// list would therefore hide channels you can perfectly well post to.
//
// So this reports every channel with both capabilities stated separately, and
// the UI can be honest about the asymmetry rather than flattening it into one
// "connected" boolean that is wrong half the time.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

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

interface SlackChannel {
  id: string;
  name: string;
  is_member: boolean;
  is_private: boolean;
  is_archived: boolean;
  num_members?: number;
  topic?: { value?: string };
  purpose?: { value?: string };
}


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

    const conv = await slack("conversations.list", token, {
      types: "public_channel,private_channel",
      exclude_archived: "true",
      limit: "200",
    });

    const have = grantedScopes.split(",").map((s) => s.trim()).filter(Boolean);
    const canWritePublic = have.includes("chat:write.public");
    const canWrite = have.includes("chat:write");

    const channels = (conv.channels ?? [])
      .filter((c: SlackChannel) => !c.is_archived)
      .map((c: SlackChannel) => ({
        id: c.id,
        name: c.name,
        is_member: c.is_member,
        is_private: c.is_private,
        members: c.num_members ?? null,
        topic: c.topic?.value || c.purpose?.value || null,

        /* The two capabilities kept apart on purpose.
           Reading always requires membership: Slack returns nothing for a
           channel the bot is not in, which on screen is indistinguishable from
           a channel where nobody has spoken.
           Posting requires membership only for PRIVATE channels; a public one
           is reachable with chat:write.public. Collapsing these into a single
           flag is what made the old picker misleading. */
        can_read: c.is_member,
        can_post: canWrite && (c.is_member || (!c.is_private && canWritePublic)),

        /* Named here rather than inferred in the UI, because the fix differs:
           one is an invite, the other is a scope. */
        blocked_reason: c.is_member
          ? null
          : c.is_private
            ? "invite"
            : canWritePublic
              ? null
              : "scope",
      }))
      .sort((a: { is_member: boolean; name: string }, b: { is_member: boolean; name: string }) =>
        // Channels the bot is in first: those are the ones that actually work
        // in both directions, so they belong at the top of a picker.
        a.is_member === b.is_member ? a.name.localeCompare(b.name) : a.is_member ? -1 : 1,
      );

    return json({
      channels,
      scopes: have,
      can_post: canWrite,
      can_post_uninvited: canWritePublic,
      joined: channels.filter((c: { can_read: boolean }) => c.can_read).length,
      total: channels.length,
    });
  } catch (e) {
    const detail = String(e instanceof Error ? e.message : e);
    return json({ error: detail, failure: detail.includes("missing_scope") ? "missing_scope" : "unknown" }, 500);
  }
});
