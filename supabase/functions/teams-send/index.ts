// Edge Function: teams-send   (Verify JWT: ON)
// Posts a reply into a Teams chat the signed-in user is already in.
//
// Runs on the same Microsoft credential as outlook-send and teams-sync, and
// needs ChatMessage.Send on top of Chat.Read. Delegated, so it posts AS the
// person, into chats they are a member of, and cannot reach a chat they are
// not: Graph enforces that, not this function.
//
// The reply goes back into the chat it came from. There is no "new Teams
// message" path here on purpose: starting a conversation means resolving a
// person to a directory id and creating a chat, which is a different feature
// with a different consent (Chat.Create), and half-building it would put a
// compose box on screen that fails at the last step.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const TENANT = Deno.env.get("MICROSOFT_TENANT") ?? "common";
const SEND_SCOPE = "ChatMessage.Send";

type Admin = ReturnType<typeof createClient>;

/** Third copy, after outlook-sync/outlook-send. See teams-sync's note. */
async function accessToken(admin: Admin, owner: string): Promise<{ token: string; scopes: string }> {
  const { data: cred, error } = await admin
    .from("microsoft_credentials")
    .select("refresh_token, access_token, token_expiry, scopes")
    .eq("owner_id", owner)
    .maybeSingle();
  if (error) {
    console.error("microsoft_credentials read failed", error.message);
    throw new Error("Could not read the Microsoft connection.");
  }
  if (!cred?.refresh_token) {
    const e = new Error("Microsoft not connected");
    (e as Error & { code?: string }).code = "not_connected";
    throw e;
  }

  const scopes = String(cred.scopes ?? "");
  const expiry = cred.token_expiry ? new Date(cred.token_expiry as string).getTime() : 0;
  if (cred.access_token && expiry > Date.now() + 60_000) {
    return { token: cred.access_token as string, scopes };
  }

  const r = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("MICROSOFT_CLIENT_ID") ?? "",
      client_secret: Deno.env.get("MICROSOFT_CLIENT_SECRET") ?? "",
      refresh_token: cred.refresh_token as string,
      grant_type: "refresh_token",
    }),
  });
  const t = await r.json();
  if (!r.ok || !t.access_token) {
    console.error("microsoft token refresh failed", r.status, t?.error, t?.error_description);
    const e = new Error("Microsoft connection expired. Please reconnect in Integrations.");
    (e as Error & { code?: string }).code = "reconnect";
    throw e;
  }

  const patch: Record<string, unknown> = {
    access_token: t.access_token,
    token_expiry: new Date(Date.now() + (t.expires_in ?? 3600) * 1000).toISOString(),
  };
  if (t.refresh_token) patch.refresh_token = t.refresh_token;
  if (typeof t.scope === "string" && t.scope.length) patch.scopes = t.scope;
  await admin.from("microsoft_credentials").update(patch).eq("owner_id", owner);

  return { token: t.access_token as string, scopes: typeof t.scope === "string" ? t.scope : scopes };
}

const ini = (n: string) => n.split(/[ .]/).map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();

/** Text to the minimal HTML Teams renders. Escaped first, so a message
    containing < or & arrives as typed rather than as broken markup. */
function toHtml(text: string): string {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc.split("\n").map((l) => `<div>${l || "<br>"}</div>`).join("");
}

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

    const body = await req.json().catch(() => ({}));
    const text = String(body.text ?? "").trim();
    const chatId = String(body.chat_id ?? "").trim();
    if (!text) return json({ error: "text is required" }, 400);
    if (!chatId) return json({ error: "chat_id is required" }, 400);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    let token: string, scopes: string;
    try {
      ({ token, scopes } = await accessToken(admin, u.user.id));
    } catch (e) {
      const code = (e as Error & { code?: string }).code;
      if (code === "not_connected") {
        return json({ error: "Microsoft is not connected for this account.", failure: "not_connected" }, 400);
      }
      if (code === "reconnect") return json({ error: (e as Error).message, failure: "needs_scope" }, 400);
      throw e;
    }

    if (scopes && !scopes.includes(SEND_SCOPE)) {
      return json({
        error: "This Microsoft connection can read Teams but not post to it. Reconnect Outlook once and accept the Teams permissions.",
        failure: "needs_scope",
        missing_scope: SEND_SCOPE,
        recorded_scopes: scopes,
      }, 400);
    }

    const res = await fetch(`https://graph.microsoft.com/v1.0/chats/${encodeURIComponent(chatId)}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ body: { contentType: "html", content: toHtml(text) } }),
    });
    const sent = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error("teams send failed", res.status, sent?.error?.code, sent?.error?.message);
      const scopeProblem = res.status === 403 || sent?.error?.code === "Authorization_RequestDenied";
      return json({
        error: scopeProblem
          ? "This Microsoft connection cannot post to Teams yet."
          : (sent?.error?.message ?? "Teams refused the message"),
        failure: scopeProblem ? "needs_scope" : "send_failed",
        missing_scope: scopeProblem ? SEND_SCOPE : undefined,
      }, res.status);
    }

    const me = u.user.email ?? "MadeEA";
    const { error: writeErr } = await supa.from("messages").upsert(
      {
        teams_id: sent.id,
        source: "teams",
        direction: "outbound",
        sender_name: me,
        sender_initials: ini(me.split("@")[0].replace(/[._]/g, " ")),
        subject: String(body.subject ?? "Teams chat"),
        preview: text.slice(0, 140),
        body: text,
        category: "reply",
        received_at: sent.createdDateTime ?? new Date().toISOString(),
        thread_id: chatId,
      },
      { onConflict: "workspace_id,teams_id" },
    );

    return json({ ok: true, id: sent.id, recorded: !writeErr, record_error: writeErr?.message });
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e), failure: "send_failed" }, 500);
  }
});
