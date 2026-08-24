// Edge Function: gmail-sync   (Verify JWT: ON)
// Pulls the signed-in user's inbox into the messages table.
//
// WHAT CHANGED AND WHY.
//
// 1. It could not load an inbox. The list call was a bare maxResults=15 with no
//    pagination, so "sync" meant "the newest fifteen" for ever. Running it twice
//    fetched the same fifteen again. Anyone with more than fifteen emails simply
//    could not get the rest, and nothing said so, which is worse than failing.
//    Now it pages until it reaches `limit` or Gmail runs out, and it returns
//    Gmail's own next page token so a caller can keep going deliberately rather
//    than guessing whether more exists.
//
// 2. It reported success it had not verified. `if (!error) synced++` counted a
//    row as synced whenever the write did not throw, so a message skipped as a
//    duplicate and a message the database refused looked identical, and both
//    looked like success. The same pattern was already removed from slack-sync
//    for the same reason. Writes are now counted separately from failures and
//    failures come back with their reason attached.
//
// 3. It never stored the sender's address. Only a display name was parsed out of
//    the From header, so sender_email was null on every row ever synced. A
//    Communication Center whose whole job is replying could not address a reply,
//    and the composer opened with an empty To field. The address was in the
//    header the entire time.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

/**
 * A live Google access token for one person.
 *
 * Reuses the stored one while it is good, refreshes when it is not, and writes
 * the new one back encrypted. A refusal from Google is terminal: invalid_grant
 * means access was revoked or the password changed, so the row is marked
 * reauth_required and the UI offers Reconnect rather than retrying for ever.
 */
async function accessToken(admin: Admin, cred: Credential): Promise<string> {
  const expiry = cred.token_expires_at ? new Date(cred.token_expires_at).getTime() : 0;
  // 60s of slack, so a token expiring mid-sync is refreshed now rather than
  // failing one request in.
  if (cred.access_token && expiry > Date.now() + 60_000) return cred.access_token;

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
      refresh_token: cred.refresh_token!,
      grant_type: "refresh_token",
    }),
  });
  const t = await r.json();
  if (!r.ok || !t.access_token) {
    // The provider's words go to the log, never to the browser and never near
    // the token itself.
    console.error("google token refresh failed", r.status, t?.error);
    await markReauth(admin, cred.id, String(t?.error ?? "refresh failed"));
    throw new Error("Google connection expired. Please reconnect in Integrations.");
  }
  await storeRefreshed(admin, cred, t);
  return t.access_token as string;
}

const g = (token: string, u: string) => fetch(u, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());

/** "Rio Castillo <rio@x.com>" -> "Rio Castillo". Falls back to the raw value. */
const senderName = (from: string) => (from.match(/^"?([^"<]+?)"?\s*</)?.[1] ?? from.replace(/<.*>/, "")).trim() || from;

/** The half that was being thrown away: the address a reply has to go to. */
const senderEmail = (from: string): string | null => {
  const angled = from.match(/<([^>]+)>/)?.[1];
  if (angled) return angled.trim().toLowerCase();
  // A bare "someone@example.com" with no display name is still an address.
  const bare = from.match(/[^\s<>,"]+@[^\s<>,"]+/)?.[0];
  return bare ? bare.trim().toLowerCase() : null;
};

const ini = (n: string) => n.split(" ").map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();

/**
 * Every address in a To/Cc header.
 *
 * Not a split on commas. `"Petran, Rowena" <r@x.com>, bob@y.com` is two
 * recipients, and splitting naively makes it three, one of which is the string
 * `Rowena" <r@x.com>`. Pulling the addresses out directly sidesteps the whole
 * quoting problem: an address cannot contain a comma or a space, so matching
 * the addresses is unambiguous where splitting the list is not.
 */
function addresses(header: string | undefined): string[] {
  if (!header) return [];
  const found = header.match(/[^\s<>,"]+@[^\s<>,"]+/g) ?? [];
  return [...new Set(found.map((a) => a.trim().toLowerCase().replace(/[.,;]+$/, "")))];
}

/* Gmail wants one request per message for the headers, so a large inbox is a
   lot of round trips. Done in small concurrent batches: serial is slow enough
   to hit the function's wall clock on a few hundred messages, and unbounded
   concurrency gets rate limited by Google. */
const BATCH = 8;

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
type Admin = ReturnType<typeof createClient>;

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
    /* Capped rather than unbounded. "All" on a ten-year mailbox is tens of
       thousands of messages and would time out halfway with no way to tell how
       far it got. The page token in the response is how you continue. */
    const limit = Math.min(Math.max(Number(body.limit ?? 50), 1), 500);
    const query = typeof body.query === "string" && body.query.trim() ? body.query.trim() : "in:inbox";
    let pageToken: string | undefined = typeof body.pageToken === "string" ? body.pageToken : undefined;

    // Service role for this read only: 0016 revokes refresh_token from the
    // `authenticated` role so the browser can never read it, which also means
    // the caller's own token can't. owner_id is pinned to the JWT-verified user
    // above, so this reads exactly one row (the caller's) and never anyone
    // else's. Everything below still runs through the caller's RLS-scoped client.
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const cred = await credentialFor(admin, u.user.id, "google");
    if (!cred?.refresh_token) {
      return json({ error: "Google is not connected. Press Connect on the Gmail card.", failure: "not_connected" }, 400);
    }
    const token = await accessToken(admin, cred);

    // Collect ids across as many pages as `limit` calls for.
    const ids: string[] = [];
    let nextPageToken: string | undefined;
    while (ids.length < limit) {
      const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
      url.searchParams.set("maxResults", String(Math.min(100, limit - ids.length)));
      url.searchParams.set("q", query);
      if (pageToken) url.searchParams.set("pageToken", pageToken);

      const list = await g(token, url.toString());
      if (list.error) {
        return json({ error: list.error?.message ?? "Gmail refused the list request", detail: list.error }, 502);
      }
      for (const m of list.messages ?? []) ids.push(m.id);

      nextPageToken = list.nextPageToken;
      if (!nextPageToken) break;
      pageToken = nextPageToken;
    }

    let synced = 0;
    const failures: string[] = [];

    for (let i = 0; i < ids.length; i += BATCH) {
      const slice = ids.slice(i, i + BATCH);
      await Promise.all(slice.map(async (id) => {
        const full = await g(
          token,
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}` +
            `?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date` +
            /* The rest of what a reply needs. Message-Id is what makes a reply
               thread; To and Cc are what make reply-all possible. Without them
               a reply lands as a new conversation addressed to one person. */
            `&metadataHeaders=Message-Id&metadataHeaders=To&metadataHeaders=Cc`,
        );
        if (full.error) { failures.push(`${id}: ${full.error?.message ?? "fetch failed"}`); return; }

        const headers: Record<string, string> = Object.fromEntries(
          (full.payload?.headers ?? []).map((h: { name: string; value: string }) => [h.name, h.value]),
        );
        const from = headers.From ?? "Unknown";
        const sender = senderName(from);

        const { error } = await supa.from("messages").upsert(
          {
            gmail_id: id,
            source: "gmail",
            sender_name: sender,
            sender_email: senderEmail(from),
            sender_initials: ini(sender),
            subject: headers.Subject ?? "(no subject)",
            preview: full.snippet ?? "",
            body: full.snippet ?? "",
            category: "reply",
            received_at: new Date(parseInt(full.internalDate ?? `${Date.now()}`)).toISOString(),
            /* Gmail's own thread id, which groups the conversation in OUR ui.
               Distinct from rfc_message_id, which is what other mail servers
               thread on. Both are needed and neither substitutes. */
            thread_id: full.threadId ?? null,
            rfc_message_id: headers["Message-Id"] ?? headers["Message-ID"] ?? null,
            to_emails: addresses(headers.To),
            cc_emails: addresses(headers.Cc),
          },
          { onConflict: "workspace_id,gmail_id" },
        );
        // Counted only when the write actually succeeded, and the reason kept
        // when it did not. The old version treated both as a success.
        if (error) failures.push(`${id}: ${error.message}`);
        else synced++;
      }));
    }

    return json({
      synced,
      seen: ids.length,
      failed: failures.length,
      // First few only: enough to diagnose, not enough to bury the numbers.
      errors: failures.length ? failures.slice(0, 5) : undefined,
      // Present when Gmail has more beyond what this call took. Its absence is
      // the only honest way to say "that was the whole inbox".
      next_page_token: nextPageToken,
    });
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
