// Edge Function: n8n-inbox-triage   (deploy with --no-verify-jwt)
//
// The server half of the team email organizer. n8n has no user session, so this
// function authenticates with a shared secret instead of a JWT and does every
// privileged thing itself. n8n only ever sees message metadata. Never a Google
// refresh token, never an access token.
//
//   POST { action: "members" }
//     -> { members: [{ user_id, workspace_id, name }] }   every teammate with Google connected
//
//   POST { action: "fetch", user_id, max? }
//     -> { user_id, workspace_id, pulled, rules, messages: [...] }
//        Pulls new Gmail since this mailbox's cursor, stores it, advances the
//        cursor, then returns the UNTRIAGED BACKLOG (not just the new mail).
//        That last part is what makes the workflow self-healing: if a run dies
//        after fetch, the next run re-offers everything still unfiled.
//
//   POST { action: "commit", user_id, results: [{ gmail_id, category, ... }], error? }
//     -> { updated }
//        Writes the filing decision. Rows a human has re-filed are skipped.
//
// WHY --no-verify-jwt is safe here: the gateway's JWT check is replaced by the
// x-n8n-secret check below, which fails closed when the secret is unset. Nothing
// in this function trusts anything else the caller says about identity, the
// mailbox is always addressed by user_id, and that user_id must resolve to a
// real membership before a single Gmail call is made.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SHARED_SECRET = Deno.env.get("N8N_SHARED_SECRET") ?? "";

// Server-to-server only. No Access-Control-Allow-Origin on purpose: a browser
// has no business calling this, and omitting CORS means a page on some other
// origin cannot read a response even if it managed to send a request.
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

/** Length-independent constant-time compare, so the secret can't be probed byte by byte. */
function secretOk(given: string): boolean {
  if (!SHARED_SECRET) return false; // fail closed when unconfigured
  const enc = new TextEncoder();
  const a = enc.encode(given);
  const b = enc.encode(SHARED_SECRET);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a[i % (a.length || 1)] ?? 0) ^ (b[i % (b.length || 1)] ?? 0);
  }
  return diff === 0;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CATEGORIES = ["urgent", "reply", "delegate", "archive"] as const;
type Category = (typeof CATEGORIES)[number];

const admin = () =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

// ---------------- Google ----------------

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
  if (!r.ok) {
    console.error("google token refresh failed", r.status, JSON.stringify(t));
    throw new Error("Google connection expired, this member must reconnect in Integrations.");
  }
  return t.access_token;
}

const g = (token: string, u: string) =>
  fetch(u, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());

const senderName = (from: string) =>
  (from.match(/^"?([^"<]+?)"?\s*</)?.[1] ?? from.replace(/<.*>/, "")).trim() || from;
const senderEmail = (from: string) =>
  (from.match(/<([^>]+)>/)?.[1] ?? from).trim().toLowerCase();
const ini = (n: string) =>
  n.split(" ").map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();

const BULK_LABELS = ["CATEGORY_PROMOTIONS", "CATEGORY_UPDATES", "CATEGORY_FORUMS", "CATEGORY_SOCIAL"];

// ---------------- helpers ----------------

/** Resolves user_id -> workspace_id, and proves the caller named a real member. */
async function memberWorkspace(db: ReturnType<typeof admin>, userId: string): Promise<string> {
  const { data, error } = await db
    .from("memberships").select("workspace_id").eq("user_id", userId).maybeSingle();
  if (error) {
    console.error("membership lookup failed", error.message);
    throw new Error("Could not resolve the member's workspace.");
  }
  if (!data?.workspace_id) throw new Error("Not a workspace member.");
  return data.workspace_id as string;
}

async function noteSyncResult(
  db: ReturnType<typeof admin>,
  ownerId: string,
  workspaceId: string,
  patch: Record<string, unknown>,
) {
  await db.from("gmail_sync_state").upsert(
    { owner_id: ownerId, workspace_id: workspaceId, last_synced_at: new Date().toISOString(), ...patch },
    { onConflict: "owner_id" },
  );
}

// ---------------- actions ----------------

async function listMembers(db: ReturnType<typeof admin>) {
  const { data: creds, error } = await db
    .from("google_credentials").select("owner_id, refresh_token");
  if (error) {
    console.error("google_credentials read failed", error.message);
    throw new Error("Could not list connected mailboxes.");
  }
  // Only the ids leave this scope, the tokens stay in this function.
  const ids = (creds ?? []).filter((c) => c.refresh_token).map((c) => c.owner_id as string);
  if (!ids.length) return [];

  const [{ data: mems }, { data: profs }] = await Promise.all([
    db.from("memberships").select("user_id, workspace_id").in("user_id", ids),
    db.from("profiles").select("id, full_name").in("id", ids),
  ]);
  const nameOf = new Map((profs ?? []).map((p) => [p.id as string, p.full_name as string]));

  return (mems ?? []).map((m) => ({
    user_id: m.user_id as string,
    workspace_id: m.workspace_id as string,
    name: nameOf.get(m.user_id as string) ?? "Team member",
  }));
}

async function fetchMailbox(db: ReturnType<typeof admin>, userId: string, max: number) {
  const workspaceId = await memberWorkspace(db, userId);

  const { data: cred, error: credErr } = await db
    .from("google_credentials").select("refresh_token").eq("owner_id", userId).maybeSingle();
  if (credErr) {
    console.error("google_credentials read failed", credErr.message);
    throw new Error("Could not read the Google connection.");
  }
  if (!cred?.refresh_token) throw new Error("Google not connected");

  // Cursor. A brand-new mailbox starts 2 days back rather than at the epoch,
  // enough to look alive on the first run without importing a decade of mail.
  const { data: state } = await db
    .from("gmail_sync_state").select("last_internal_date").eq("owner_id", userId).maybeSingle();
  const cursorMs = Number(state?.last_internal_date ?? 0) ||
    Date.now() - 2 * 24 * 60 * 60 * 1000;

  const token = await accessToken(cred.refresh_token);

  // Gmail's `after:` takes whole seconds and is inclusive, so the newest already-
  // seen message can come back again. That's fine: it's filtered out below by
  // gmail_id before anything is inserted.
  const afterSec = Math.floor(cursorMs / 1000);
  const q = encodeURIComponent(`in:inbox -in:chats after:${afterSec}`);
  const list = await g(
    token,
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${max}&q=${q}`,
  );
  if (list.error) {
    console.error("gmail list failed", JSON.stringify(list.error));
    throw new Error("Gmail rejected the request for this mailbox.");
  }

  const incoming = list.messages ?? [];
  let newest = cursorMs;
  let pulled = 0;

  if (incoming.length) {
    // Which of these do we already have? Skipping them keeps this function from
    // ever rewriting a row. No upsert, so a human's filing can't be clobbered.
    const ids = incoming.map((m: { id: string }) => m.id);
    const { data: known } = await db
      .from("messages").select("gmail_id").eq("workspace_id", workspaceId).in("gmail_id", ids);
    const seen = new Set((known ?? []).map((k) => k.gmail_id as string));

    // Client lookup, fetched once and matched in memory.
    const { data: clients } = await db
      .from("clients").select("id, email, domains").eq("workspace_id", workspaceId);
    const byEmail = new Map<string, string>();
    const byDomain = new Map<string, string>();
    for (const c of clients ?? []) {
      if (c.email) byEmail.set(String(c.email).toLowerCase(), c.id as string);
      for (const d of (c.domains ?? []) as string[]) byDomain.set(d.toLowerCase().replace(/^@/, ""), c.id as string);
    }

    const rows: Record<string, unknown>[] = [];
    for (const m of incoming) {
      const full = await g(
        token,
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}` +
          `?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=List-Unsubscribe`,
      );
      const internal = parseInt(full.internalDate ?? `${Date.now()}`);
      if (internal > newest) newest = internal;
      if (seen.has(m.id)) continue;

      const headers: Record<string, string> = Object.fromEntries(
        (full.payload?.headers ?? []).map((h: { name: string; value: string }) => [h.name, h.value]),
      );
      const labels: string[] = full.labelIds ?? [];
      const from = headers.From ?? "Unknown";
      const name = senderName(from);
      const email = senderEmail(from);
      const domain = email.split("@")[1] ?? "";

      rows.push({
        owner_id: userId,
        workspace_id: workspaceId,
        gmail_id: m.id,
        thread_id: full.threadId ?? null,
        source: "gmail",
        sender_name: name,
        sender_initials: ini(name),
        sender_email: email,
        subject: headers.Subject ?? "(no subject)",
        preview: full.snippet ?? "",
        body: full.snippet ?? "",
        client_id: byEmail.get(email) ?? byDomain.get(domain) ?? null,
        direction: labels.includes("SENT") ? "outbound" : "inbound",
        is_bulk: Boolean(headers["List-Unsubscribe"]) || labels.some((l) => BULK_LABELS.includes(l)),
        received_at: new Date(internal).toISOString(),
        // category stays at its 'reply' default until the workflow files it;
        // triaged_at null is what marks it as still queued.
      });
    }

    if (rows.length) {
      const { error: insErr } = await db.from("messages").insert(rows);
      if (insErr) {
        console.error("message insert failed", JSON.stringify(insErr));
        // The caller here is an operator holding the shared secret, not a
        // browser, so the real Postgres error is more useful than it is risky,
        // without it a failed run is undiagnosable from outside the dashboard.
        throw new Error(
          `Could not store the fetched mail: ${insErr.message}` +
            (insErr.details ? ` | ${insErr.details}` : "") +
            (insErr.hint ? ` | hint: ${insErr.hint}` : ""),
        );
      }
      pulled = rows.length;
    }
  }

  await noteSyncResult(db, userId, workspaceId, {
    last_internal_date: newest,
    last_status: "ok",
    last_error: null,
  });

  // The queue: everything still unfiled for this mailbox, new or left over.
  const { data: queue } = await db
    .from("messages")
    .select("id, gmail_id, sender_name, sender_email, subject, preview, received_at, is_bulk, client_id")
    .eq("workspace_id", workspaceId)
    .eq("owner_id", userId)
    .eq("direction", "inbound")
    .eq("category_locked", false)
    .is("triaged_at", null)
    .order("received_at", { ascending: false })
    .limit(max);

  // Rules travel with the payload so the workflow needs no DB access of its own.
  const { data: rules } = await db
    .from("triage_rules")
    .select("name, match_type, match_value, category, priority, mailbox_owner_id")
    .eq("workspace_id", workspaceId)
    .eq("enabled", true)
    .or(`mailbox_owner_id.is.null,mailbox_owner_id.eq.${userId}`)
    .order("priority", { ascending: true });

  return {
    user_id: userId,
    workspace_id: workspaceId,
    pulled,
    rules: rules ?? [],
    messages: (queue ?? []).map((m) => ({
      message_id: m.id,
      gmail_id: m.gmail_id,
      sender_name: m.sender_name,
      sender_email: m.sender_email,
      subject: m.subject,
      preview: m.preview,
      received_at: m.received_at,
      is_bulk: m.is_bulk,
      is_client: m.client_id !== null,
    })),
  };
}

interface TriageResult {
  gmail_id?: string;
  message_id?: string;
  category?: string;
  reason?: string;
  source?: string;
  confidence?: number;
}

async function commitTriage(
  db: ReturnType<typeof admin>,
  userId: string,
  results: TriageResult[],
  reportedError?: string,
) {
  const workspaceId = await memberWorkspace(db, userId);

  if (reportedError) {
    await noteSyncResult(db, userId, workspaceId, {
      last_status: "error",
      last_error: String(reportedError).slice(0, 500),
    });
  }

  let updated = 0;
  for (const r of results) {
    const category = String(r.category ?? "").toLowerCase() as Category;
    if (!CATEGORIES.includes(category)) continue;           // ignore anything the model invented
    if (!r.gmail_id && !r.message_id) continue;
    const source = r.source === "rules" ? "rules" : "ai";

    let q = db.from("messages")
      .update({
        category,
        triage_reason: r.reason ? String(r.reason).slice(0, 300) : null,
        triage_source: source,
        triage_confidence: typeof r.confidence === "number" ? r.confidence : null,
        triaged_at: new Date().toISOString(),
      })
      .eq("workspace_id", workspaceId)
      .eq("owner_id", userId)         // a member can only be filed into their own mailbox
      .eq("category_locked", false);  // never overwrite a human's correction

    q = r.message_id ? q.eq("id", r.message_id) : q.eq("gmail_id", r.gmail_id!);

    const { data, error } = await q.select("id");
    if (error) {
      console.error("triage update failed", error.message);
      continue;
    }
    updated += data?.length ?? 0;
  }

  if (!reportedError) {
    const { data: prev } = await db
      .from("gmail_sync_state").select("messages_triaged, messages_seen").eq("owner_id", userId).maybeSingle();
    await noteSyncResult(db, userId, workspaceId, {
      last_status: "ok",
      last_error: null,
      messages_triaged: (prev?.messages_triaged ?? 0) + updated,
      messages_seen: (prev?.messages_seen ?? 0) + results.length,
    });
  }

  return { updated };
}

// ---------------- entrypoint ----------------

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  if (!secretOk(req.headers.get("x-n8n-secret") ?? "")) {
    return json({ error: "unauthorized" }, 401);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");
    const db = admin();

    if (action === "members") return json({ members: await listMembers(db) });

    const userId = String(body.user_id ?? "");
    if (!UUID_RE.test(userId)) return json({ error: "user_id must be a uuid" }, 400);

    if (action === "fetch") {
      const max = Math.min(Math.max(parseInt(String(body.max ?? 25)) || 25, 1), 50);
      try {
        return json(await fetchMailbox(db, userId, max));
      } catch (e) {
        // Record the failure against the mailbox so it shows up in the app, then
        // report it. One member's expired token must not stall the whole run.
        const msg = e instanceof Error ? e.message : String(e);
        try {
          const ws = await memberWorkspace(db, userId);
          await noteSyncResult(db, userId, ws, { last_status: "error", last_error: msg.slice(0, 500) });
        } catch { /* membership already gone. Nothing to record against */ }
        return json({ user_id: userId, error: msg, rules: [], messages: [], pulled: 0 }, 200);
      }
    }

    if (action === "commit") {
      const results = Array.isArray(body.results) ? (body.results as TriageResult[]).slice(0, 200) : [];
      return json(await commitTriage(db, userId, results, body.error ? String(body.error) : undefined));
    }

    return json({ error: "unknown action" }, 400);
  } catch (e) {
    console.error("n8n-inbox-triage failed", e);
    return json({ error: e instanceof Error ? e.message : "unexpected error" }, 500);
  }
});
