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
    const { data: cred, error: credErr } = await admin
      .from("google_credentials").select("refresh_token").eq("owner_id", u.user.id).maybeSingle();
    if (credErr) {
      console.error("google_credentials read failed", credErr.message);
      return json({ error: "Could not read the Google connection." }, 500);
    }
    if (!cred?.refresh_token) return json({ error: "Google not connected" }, 400);
    const token = await accessToken(cred.refresh_token);

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
