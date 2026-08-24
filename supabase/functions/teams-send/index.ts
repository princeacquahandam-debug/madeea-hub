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

/**
 * ── THE TOKEN MANAGER ────────────────────────────────────────────────────
 *
 * One question, asked the only way it may be asked: "what credential does THIS
 * PERSON hold for THIS PROVIDER?"
 *
 * The lookup takes workspace, user and provider. Never workspace and provider
 * alone — that is the shape that hands one colleague another's mailbox, and it
 * is the reason 0058 exists. A caller who does not know who is asking cannot
 * use this.
 *
 * WHAT IT DOES, in order:
 *   1. finds the caller's own integration row
 *   2. decrypts the access token
 *   3. returns it if it is still good
 *   4. refreshes it if it is not, re-encrypts, and writes it back
 *   5. marks the row reauth_required if the refresh token is dead
 *
 * A dead refresh token is a terminal state, not a retry: invalid_grant means
 * the person revoked access or changed their password, and hammering it just
 * turns one broken connection into a rate limit.
 *
 * WHY THE LEGACY FALLBACK IS HERE. google_credentials and microsoft_credentials
 * were already per-person and still hold live tokens for everybody who
 * connected before 0058. Falling back to them means nobody's mail stops syncing
 * on the day this deploys; the fallback disappears when those tables do.
 *
 * Duplicated across the functions that need it: Edge Functions here are
 * deployed one file at a time, so there is no shared module. If this changes,
 * it changes in all of them.
 */
interface Credential {
  /** Integration row id. Null when this came from a legacy table. */
  id: string | null;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
  scopes: string | null;
  metadata: Record<string, string | null>;
}

async function aesKey(usage: KeyUsage[]) {
  const raw = Deno.env.get("INTEGRATION_ENCRYPTION_KEY");
  if (!raw) throw new Error("INTEGRATION_ENCRYPTION_KEY is not configured");
  return await crypto.subtle.importKey(
    "raw", Uint8Array.from(atob(raw), (c) => c.charCodeAt(0)),
    { name: "AES-GCM" }, false, usage,
  );
}

async function encryptSecret(plain: string): Promise<string> {
  const key = await aesKey(["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain)),
  );
  const out = new Uint8Array(iv.length + cipher.length);
  out.set(iv);
  out.set(cipher, iv.length);
  return btoa(String.fromCharCode(...out));
}

async function decryptSecret(payload: string | null): Promise<string | null> {
  if (!payload) return null;
  try {
    const key = await aesKey(["decrypt"]);
    const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.slice(0, 12) }, key, bytes.slice(12),
    );
    return new TextDecoder().decode(plain);
  } catch {
    /* A row encrypted under a key that has since changed. Reported as "no
       credential" rather than as a crash, because the fix is the same one the
       UI already offers: reconnect. */
    console.error("could not decrypt a stored token; the encryption key may have changed");
    return null;
  }
}

/** The caller's own connection, decrypted. Legacy tables are the fallback. */
async function credentialFor(
  admin: Admin,
  userId: string,
  provider: "google" | "microsoft" | "slack" | "meta" | "discord" | "linkedin",
): Promise<Credential | null> {
  const { data: m } = await admin
    .from("memberships").select("workspace_id").eq("user_id", userId).limit(1).maybeSingle();

  if (m?.workspace_id) {
    /* workspace + user + provider. All three, always: this is the lookup the
       whole per-user model rests on. */
    const { data } = await admin
      .from("integrations")
      .select("id, access_token_encrypted, refresh_token_encrypted, token_expires_at, scopes, metadata, status")
      .eq("workspace_id", m.workspace_id)
      .eq("user_id", userId)
      .eq("provider", provider)
      .neq("status", "disconnected")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (data) {
      return {
        id: data.id as string,
        access_token: await decryptSecret(data.access_token_encrypted as string | null),
        refresh_token: await decryptSecret(data.refresh_token_encrypted as string | null),
        token_expires_at: (data.token_expires_at as string | null) ?? null,
        scopes: (data.scopes as string | null) ?? null,
        metadata: (data.metadata ?? {}) as Record<string, string | null>,
      };
    }
  }

  // Legacy, per-person, plaintext. Present until those tables are dropped.
  const table = provider === "google" ? "google_credentials"
    : provider === "microsoft" ? "microsoft_credentials"
    : null;
  if (!table) return null;

  const { data: old } = await admin
    .from(table).select("refresh_token, access_token, token_expiry, scopes").eq("owner_id", userId).maybeSingle();
  if (!old?.refresh_token) return null;
  return {
    id: null,
    access_token: (old.access_token as string | null) ?? null,
    refresh_token: old.refresh_token as string,
    token_expires_at: (old.token_expiry as string | null) ?? null,
    scopes: (old.scopes as string | null) ?? null,
    metadata: {},
  };
}

/** Record that a connection needs signing in again, and why. */
async function markReauth(admin: Admin, id: string | null, reason: string) {
  if (!id) return;
  await admin.from("integrations")
    .update({ status: "reauth_required", last_error: reason, updated_at: new Date().toISOString() })
    .eq("id", id);
}

/** Store a freshly refreshed token, encrypted. No-op for a legacy row. */
async function storeRefreshed(
  admin: Admin,
  cred: Credential,
  next: { access_token: string; refresh_token?: string | null; expires_in?: number | null; scope?: string | null },
) {
  const patch: Record<string, unknown> = {
    access_token_encrypted: await encryptSecret(next.access_token),
    token_expires_at: next.expires_in ? new Date(Date.now() + next.expires_in * 1000).toISOString() : null,
    status: "connected",
    last_error: null,
    updated_at: new Date().toISOString(),
  };
  /* Only when the provider sent a new one. Microsoft rotates refresh tokens and
     Google does not; overwriting with null would end the connection on the
     provider that does not. */
  if (next.refresh_token) patch.refresh_token_encrypted = await encryptSecret(next.refresh_token);
  if (next.scope) patch.scopes = next.scope;

  if (cred.id) {
    await admin.from("integrations").update(patch).eq("id", cred.id);
  }
}

/**
 * A live Microsoft access token for ONE PERSON.
 *
 * The credential comes from the token manager, which takes the user and cannot
 * be asked without one. This function used to read microsoft_credentials by
 * owner_id directly, which happened to be per-person; going through the manager
 * makes that a property of the lookup rather than a lucky table shape, and
 * brings the encrypted store with it.
 *
 * Microsoft rotates refresh tokens on most refreshes and expects the old one to
 * be dropped, so the new one is written back every time it appears. Ignoring
 * that is the classic way an integration works for a fortnight and then dies
 * with an invalid_grant nobody can reproduce.
 */
async function accessToken(admin: Admin, owner: string): Promise<{ token: string; scopes: string }> {
  const cred = await credentialFor(admin, owner, "microsoft");
  if (!cred?.refresh_token) {
    const e = new Error("Microsoft not connected");
    (e as Error & { code?: string }).code = "not_connected";
    throw e;
  }

  const scopes = cred.scopes ?? "";
  const expiry = cred.token_expires_at ? new Date(cred.token_expires_at).getTime() : 0;
  // 60s of slack, so a token expiring mid-request is refreshed now rather than
  // failing one call in.
  if (cred.access_token && expiry > Date.now() + 60_000) {
    return { token: cred.access_token, scopes };
  }

  const r = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("MICROSOFT_CLIENT_ID") ?? "",
      client_secret: Deno.env.get("MICROSOFT_CLIENT_SECRET") ?? "",
      refresh_token: cred.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const t = await r.json();
  if (!r.ok || !t.access_token) {
    /* Terminal, not transient. invalid_grant means access was revoked or the
       password changed; retrying turns one broken connection into a rate
       limit. The row is marked so the card can offer Reconnect. */
    console.error("microsoft token refresh failed", r.status, t?.error, t?.error_description);
    await markReauth(admin, cred.id, String(t?.error ?? "refresh failed"));
    const e = new Error("Microsoft connection expired. Please reconnect in Integrations.");
    (e as Error & { code?: string }).code = "reconnect";
    throw e;
  }

  await storeRefreshed(admin, cred, t);
  /* The legacy row too, while ten functions still read it. Dropped with the
     table. */
  await admin.from("microsoft_credentials").update({
    access_token: t.access_token,
    token_expiry: new Date(Date.now() + (t.expires_in ?? 3600) * 1000).toISOString(),
    ...(t.refresh_token ? { refresh_token: t.refresh_token } : {}),
    ...(typeof t.scope === "string" && t.scope.length ? { scopes: t.scope } : {}),
  }).eq("owner_id", owner);

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
