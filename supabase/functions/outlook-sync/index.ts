// Edge Function: outlook-sync   (Verify JWT: ON)
// Pulls the signed-in user's Outlook inbox into the messages table.
//
// The Gmail twin of this function needs one request per message, because Gmail
// lists ids and nothing else. Graph returns the fields with the list, so a page
// here is a single request and there is no batching to tune. Everything else is
// deliberately the same shape as gmail-sync, including its two hard-won rules:
//
//   1. Page until `limit` is reached, and hand back the continuation link.
//      "The newest fifteen, for ever" was the Gmail bug, and it looked like
//      success every time it ran.
//   2. Count a row as synced only when the write actually succeeded, and keep
//      the reason when it did not. A duplicate skip and a refused insert must
//      never both read as "synced".
//
// WHAT IS NOT STORED. Message bodies. `bodyPreview` is Graph's own snippet and
// is what the list and the reading pane show, exactly as gmail-sync stores
// Gmail's snippet. Pulling full bodies is a different feature (and a much
// bigger privacy question) and belongs in its own change, not smuggled in here.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const TENANT = Deno.env.get("MICROSOFT_TENANT") ?? "common";

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
async function accessToken(admin: Admin, owner: string): Promise<string> {
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
    return cred.access_token;
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

  return t.access_token as string;
}
interface GraphAddress { name?: string; address?: string }
interface GraphRecipient { emailAddress?: GraphAddress }
interface GraphMessage {
  id: string;
  conversationId?: string;
  internetMessageId?: string;
  subject?: string;
  bodyPreview?: string;
  receivedDateTime?: string;
  from?: GraphRecipient;
  sender?: GraphRecipient;
  toRecipients?: GraphRecipient[];
  ccRecipients?: GraphRecipient[];
}

const ini = (n: string) => n.split(" ").map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();

/* Graph hands back structured recipients, so none of gmail-sync's header
   parsing is needed here. Deduped and lowercased all the same, because the same
   address can appear in both To and Cc and downstream code compares strings. */
const emails = (list: GraphRecipient[] | undefined): string[] =>
  [...new Set((list ?? [])
    .map((r) => r.emailAddress?.address?.trim().toLowerCase())
    .filter((a): a is string => Boolean(a)))];

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

    const body = await req.json().catch(() => ({}));
    // Capped for the same reason as gmail-sync: an unbounded "all" on a ten
    // year mailbox times out halfway with no way to tell how far it got.
    const limit = Math.min(Math.max(Number(body.limit ?? 50), 1), 500);

    /* Service role for the token read only: 0048 revokes refresh_token from the
       `authenticated` role, so the caller's own client cannot read it either.
       owner_id is pinned to the JWT-verified user, so this touches exactly one
       row. Every message write below still goes through the caller's
       RLS-scoped client. */
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    let token: string;
    try {
      token = await accessToken(admin, u.user.id);
    } catch (e) {
      const code = (e as Error & { code?: string }).code;
      if (code === "not_connected") return json({ error: "Outlook not connected", failure: "not_connected" }, 400);
      if (code === "reconnect") return json({ error: (e as Error).message, failure: "reconnect" }, 400);
      throw e;
    }

    /* $select is not an optimisation here, it is the contract: without it Graph
       returns the full body of every message, which is both far more data than
       this function stores and far more than it should be handling. */
    const SELECT = "id,conversationId,internetMessageId,subject,bodyPreview,receivedDateTime,from,sender,toRecipients,ccRecipients";
    let next: string | undefined =
      typeof body.next_link === "string" && body.next_link.startsWith("https://graph.microsoft.com/")
        ? body.next_link
        : `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages` +
          `?$select=${SELECT}&$orderby=receivedDateTime%20desc&$top=${Math.min(50, limit)}`;

    const items: GraphMessage[] = [];
    let nextLink: string | undefined;
    while (items.length < limit && next) {
      const res = await fetch(next, { headers: { Authorization: `Bearer ${token}` } });
      const page = await res.json();
      if (!res.ok) {
        const detail = page?.error?.message ?? "Outlook refused the list request";
        console.error("graph list failed", res.status, page?.error?.code, detail);
        /* A scope problem and a broken mailbox are not the same event and do
           not have the same fix, so they are not reported as the same thing. */
        const scopeProblem = res.status === 403 || page?.error?.code === "ErrorAccessDenied";
        return json({
          error: scopeProblem ? "This Microsoft connection cannot read mail. Reconnect and accept the mail permissions." : detail,
          failure: scopeProblem ? "needs_scope" : "list_failed",
        }, res.status);
      }
      for (const m of (page.value ?? []) as GraphMessage[]) items.push(m);
      nextLink = page["@odata.nextLink"];
      next = nextLink;
      if (!next) break;
    }

    let synced = 0;
    const failures: string[] = [];

    for (const m of items.slice(0, limit)) {
      const person = m.from?.emailAddress ?? m.sender?.emailAddress ?? {};
      const sender = (person.name ?? person.address ?? "Unknown").trim() || "Unknown";

      const { error } = await supa.from("messages").upsert(
        {
          outlook_id: m.id,
          source: "outlook",
          sender_name: sender,
          sender_email: person.address?.trim().toLowerCase() ?? null,
          sender_initials: ini(sender),
          subject: m.subject || "(no subject)",
          preview: m.bodyPreview ?? "",
          body: m.bodyPreview ?? "",
          category: "reply",
          received_at: m.receivedDateTime ?? new Date().toISOString(),
          /* Graph's conversationId groups the thread in OUR ui, the way Gmail's
             threadId does. internetMessageId is the RFC 2822 id other mail
             servers thread on. Both are kept and neither substitutes. */
          thread_id: m.conversationId ?? null,
          rfc_message_id: m.internetMessageId ?? null,
          to_emails: emails(m.toRecipients),
          cc_emails: emails(m.ccRecipients),
        },
        { onConflict: "workspace_id,outlook_id" },
      );
      if (error) failures.push(`${m.id}: ${error.message}`);
      else synced++;
    }

    return json({
      synced,
      seen: items.length,
      failed: failures.length,
      errors: failures.length ? failures.slice(0, 5) : undefined,
      // Present only when Graph has more beyond what this call took. Its
      // absence is the only honest way to say "that was the whole inbox".
      next_link: items.length >= limit ? nextLink : undefined,
    });
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
