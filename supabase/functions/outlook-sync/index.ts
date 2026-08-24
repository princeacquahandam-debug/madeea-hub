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
 * A live access token for `owner`, refreshing only when the cached one is spent.
 *
 * WHY THE ROTATION HANDLING MATTERS. Microsoft returns a NEW refresh_token on
 * most refreshes and expects the old one to be dropped. Ignoring that is the
 * classic way an integration works for a fortnight and then dies with an
 * invalid_grant nobody can reproduce, because the stored token has been
 * superseded so many times it fell out of the rotation window. So the new one
 * is written back every time it appears.
 *
 * Duplicated verbatim in outlook-send. Supabase Edge Functions here have no
 * shared module (see gmail-sync and gmail-send, which duplicate theirs), so the
 * rule is: if this changes, change it in both.
 */
async function accessToken(admin: Admin, owner: string): Promise<string> {
  const { data: cred, error } = await admin
    .from("microsoft_credentials")
    .select("refresh_token, access_token, token_expiry")
    .eq("owner_id", owner)
    .maybeSingle();
  if (error) {
    console.error("microsoft_credentials read failed", error.message);
    throw new Error("Could not read the Microsoft connection.");
  }
  if (!cred?.refresh_token) {
    const e = new Error("Outlook not connected");
    (e as Error & { code?: string }).code = "not_connected";
    throw e;
  }

  // 60s of slack, so a token that expires mid-request is refreshed now rather
  // than failing one call into the sync.
  const expiry = cred.token_expiry ? new Date(cred.token_expiry as string).getTime() : 0;
  if (cred.access_token && expiry > Date.now() + 60_000) return cred.access_token as string;

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
    // Microsoft's detail goes to the log; the browser gets the action to take.
    console.error("microsoft token refresh failed", r.status, t?.error, t?.error_description);
    const e = new Error("Microsoft connection expired. Please reconnect in Integrations.");
    (e as Error & { code?: string }).code = "reconnect";
    throw e;
  }

  const patch: Record<string, unknown> = {
    access_token: t.access_token,
    token_expiry: new Date(Date.now() + (t.expires_in ?? 3600) * 1000).toISOString(),
  };
  if (t.refresh_token) patch.refresh_token = t.refresh_token;   // rotation, see above
  if (typeof t.scope === "string" && t.scope.length) patch.scopes = t.scope;
  await admin.from("microsoft_credentials").update(patch).eq("owner_id", owner);

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
