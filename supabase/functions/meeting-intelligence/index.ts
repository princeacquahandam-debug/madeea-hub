// Edge Function: meeting-intelligence   (Verify JWT: ON)
//
// Reads Fathom transcripts and gives back the tasks, decisions and memory hiding
// inside them.
//
//   POST { action: "sync",   limit?, since? }  -> pull new recordings, extract, route
//   POST { action: "status" }                  -> cursor + counters, no side effects
//
// Everything is written through the CALLER's client, so RLS applies exactly as it
// would in the browser and a member can never write outside their workspace. The
// only privileged thing here is the Fathom key, which never leaves the function.
//
// Idempotent by construction: meeting_notes has a unique index on
// (workspace_id, fathom_recording_id) and this checks it before spending a model
// call, so a re-run or an overlapping backfill costs nothing and duplicates nothing.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const FATHOM_API_KEY = Deno.env.get("FATHOM_API_KEY") ?? "";
const MODEL = "gpt-4o";              // extraction quality matters more here than cost
const FATHOM_BASE = "https://api.fathom.ai/external/v1";
const MAX_TRANSCRIPT_CHARS = 90_000; // ~1h of talk; longer gets truncated with a note

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

// ── extraction prompt ────────────────────────────────────────────────────────

const SYSTEM = `You extract structured intelligence from meeting transcripts for an executive-support team.

Return ONLY JSON, shaped exactly:
{
  "summary": string,
  "action_items": [{ "title": string, "owner": string, "due": string, "quote": string, "priority": "urgent"|"high"|"normal"|"low" }],
  "decisions":    [{ "decision": string, "context": string, "quote": string, "timestamp": string }],
  "open_questions":[{ "question": string, "quote": string }],
  "commitments":  [{ "who": string, "commitment": string, "quote": string }],
  "insights":     [{ "insight": string, "quote": string }]
}

Rules that matter more than completeness:
- EVERY item must carry a "quote" copied verbatim from the transcript. If you cannot
  quote it, you are inferring, and you must leave it out. An unquotable item is the
  one that destroys trust in the whole system.
- "owner": the person's name as spoken, or "" if genuinely unassigned. Never guess.
- "due": an ISO date (YYYY-MM-DD) when a real date was said or is unambiguous from
  the meeting date; a short phrase like "next week" when it was vague; "" if absent.
  Never invent a deadline that nobody stated.
- An action item is something a person committed to DO. A decision is a choice that
  was MADE. A commitment is a promise about future behaviour or delivery. If a line
  is genuinely two of these, put it in both.
- "insights": durable knowledge worth keeping — how a client works, a constraint, a
  preference, a number. Not meeting chatter, not restated action items.
- "timestamp": the transcript timestamp if one is present, else "".
- summary: 2-4 sentences. What was this meeting actually about and what changed.
- Return empty arrays rather than inventing content. A short honest extraction beats
  a padded one; the team will act on these.`;

async function extract(transcript: string, title: string, when: string): Promise<Record<string, unknown>> {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");
  const truncated = transcript.length > MAX_TRANSCRIPT_CHARS;
  const body = truncated ? transcript.slice(0, MAX_TRANSCRIPT_CHARS) + "\n\n[transcript truncated]" : transcript;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      response_format: { type: "json_object" },
      temperature: 0.2,
      max_tokens: 3000,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `Meeting: ${title}\nDate: ${when}\n\nTranscript:\n${body}` },
      ],
    }),
  });
  if (!res.ok) {
    console.error("openai failed", res.status, await res.text());
    throw new Error("The extraction model is unavailable right now.");
  }
  const j = await res.json();
  try {
    return JSON.parse(String(j?.choices?.[0]?.message?.content ?? "{}"));
  } catch {
    throw new Error("The model returned something unreadable.");
  }
}

// ── Fathom ───────────────────────────────────────────────────────────────────

interface FathomMeeting {
  recording_id?: number;
  title?: string;
  meeting_title?: string;
  url?: string;
  share_url?: string;
  created_at?: string;
  recording_start_time?: string;
  scheduled_start_time?: string;
  transcript?: unknown;
  default_summary?: unknown;
  calendar_invitees?: { email?: string; name?: string }[];
}

async function fathomMeetings(since: string | null, limit: number): Promise<FathomMeeting[]> {
  if (!FATHOM_API_KEY) throw new Error("FATHOM_API_KEY is not set — add it in Supabase secrets.");
  const qs = new URLSearchParams({ include_transcript: "true", include_summary: "true" });
  if (since) qs.set("created_after", since);

  const r = await fetch(`${FATHOM_BASE}/meetings?${qs.toString()}`, {
    headers: { "X-Api-Key": FATHOM_API_KEY, Accept: "application/json" },
  });
  if (!r.ok) {
    console.error("fathom list failed", r.status, await r.text());
    throw new Error(r.status === 401 ? "Fathom rejected the API key." : "Could not reach Fathom.");
  }
  const j = await r.json();
  const items: FathomMeeting[] = j?.items ?? [];
  // Oldest first, so the cursor advances monotonically even if we stop early.
  items.sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")));
  return items.slice(0, limit);
}

/** Fathom's transcript shape has moved around; accept the plausible ones rather than one. */
function transcriptText(t: unknown): string {
  if (typeof t === "string") return t;
  if (!Array.isArray(t)) return "";
  return t.map((seg) => {
    if (typeof seg === "string") return seg;
    const s = seg as Record<string, unknown>;
    const speakerRaw = s.speaker ?? s.speaker_name ?? s.display_name;
    const speaker = typeof speakerRaw === "object" && speakerRaw
      ? String((speakerRaw as Record<string, unknown>).display_name ?? (speakerRaw as Record<string, unknown>).name ?? "")
      : String(speakerRaw ?? "");
    const text = String(s.text ?? s.transcript ?? s.content ?? "");
    const ts = String(s.timestamp ?? s.start_time ?? "");
    if (!text) return "";
    return `${ts ? `[${ts}] ` : ""}${speaker ? `${speaker}: ` : ""}${text}`;
  }).filter(Boolean).join("\n");
}

const summaryText = (s: unknown): string => {
  if (typeof s === "string") return s;
  if (s && typeof s === "object") {
    const o = s as Record<string, unknown>;
    return String(o.markdown_formatted ?? o.text ?? o.summary ?? "");
  }
  return "";
};

const PRIORITIES = ["urgent", "high", "normal", "low"];
const str = (v: unknown, max = 500) => String(v ?? "").trim().slice(0, max);

// ── entrypoint ───────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "unauthorized" }, 401);

    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: u } = await db.auth.getUser();
    if (!u?.user) return json({ error: "unauthorized" }, 401);

    const { data: mem } = await db.from("memberships").select("workspace_id").maybeSingle();
    const workspaceId = mem?.workspace_id;
    if (!workspaceId) return json({ error: "Not a workspace member." }, 403);

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "sync");

    if (action === "status") {
      const { data } = await db.from("fathom_sync_state").select("*").eq("workspace_id", workspaceId).maybeSingle();
      return json({ state: data ?? null, configured: { fathom: !!FATHOM_API_KEY, model: !!OPENAI_API_KEY } });
    }

    if (action !== "sync") return json({ error: "Unknown action." }, 400);

    // Refuse the run outright when the model key is missing, rather than letting
    // extract() throw once per meeting. That path is not merely noisy: each throw
    // writes a "failed" note row and the cursor advances past it, and because an
    // existing row is treated as already-done, those meetings are never looked at
    // again. One press against an unconfigured function would silently burn a slice
    // of history that only a manual delete could recover.
    if (!OPENAI_API_KEY) {
      return json({ error: "OPENAI_API_KEY is not set — add it in Supabase secrets and redeploy this function." }, 503);
    }

    // Fails CLOSED like every other AI path in this project.
    const { data: allowed, error: rlErr } = await db.rpc("check_ai_rate_limit", { p_fn: "meeting-intelligence", p_max: 40 });
    if (rlErr) console.error("check_ai_rate_limit failed", rlErr.message);
    if (allowed !== true) return json({ error: "Rate limit reached — please try again in a little while." }, 429);

    // Bounded per invocation: an Edge Function has a wall clock, and a 79-meeting
    // backfill must not be one request that times out and loses everything. The
    // cursor makes "press Sync again" the whole resume story.
    const limit = Math.min(Math.max(parseInt(String(body?.limit ?? 3)) || 3, 1), 5);

    const { data: state } = await db.from("fathom_sync_state").select("*").eq("workspace_id", workspaceId).maybeSingle();
    const since = body?.since ? String(body.since) : (state?.last_created_at ?? null);

    let meetings: FathomMeeting[];
    try {
      meetings = await fathomMeetings(since, limit);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await db.from("fathom_sync_state").upsert(
        { workspace_id: workspaceId, last_synced_at: new Date().toISOString(), last_status: "error", last_error: msg.slice(0, 500) },
        { onConflict: "workspace_id" },
      );
      return json({ error: msg }, 502);
    }

    let processed = 0, skipped = 0, tasksCreated = 0, decisionsLogged = 0, memoriesWritten = 0;
    let cursor = state?.last_created_at ?? null;
    const failures: string[] = [];

    for (const m of meetings) {
      const recId = Number(m.recording_id);
      const title = str(m.meeting_title || m.title || "Untitled meeting", 300);
      if (!recId) continue;

      // Cursor advances even when we skip, so an already-extracted meeting is never
      // re-examined on the next run.
      if (m.created_at && (!cursor || m.created_at > cursor)) cursor = m.created_at;

      const { data: existing } = await db.from("meeting_notes")
        .select("id").eq("workspace_id", workspaceId).eq("fathom_recording_id", recId).maybeSingle();
      if (existing) { skipped++; continue; }

      const transcript = transcriptText(m.transcript);
      if (transcript.length < 200) { skipped++; continue; }   // nothing worth a model call

      const when = str(m.recording_start_time || m.scheduled_start_time || m.created_at || "", 40);
      let ex: Record<string, unknown>;
      try {
        ex = await extract(transcript, title, when);
      } catch (e) {
        failures.push(title);
        await db.from("meeting_notes").insert({
          workspace_id: workspaceId, fathom_recording_id: recId, title,
          meeting_url: str(m.url, 500), share_url: str(m.share_url, 500),
          recorded_at: when || null, transcript_chars: transcript.length,
          status: "failed", error: (e instanceof Error ? e.message : String(e)).slice(0, 300),
        });
        continue;
      }

      const attendees = (m.calendar_invitees ?? [])
        .map((a) => str(a?.email || a?.name, 200)).filter(Boolean);

      const { data: note, error: noteErr } = await db.from("meeting_notes").insert({
        workspace_id: workspaceId,
        fathom_recording_id: recId,
        title,
        meeting_url: str(m.url, 500),
        share_url: str(m.share_url, 500),
        recorded_at: when || null,
        attendees,
        transcript_chars: transcript.length,
        summary: str(ex.summary ?? summaryText(m.default_summary), 4000),
        extracted: ex,
        status: "extracted",
      }).select("id").single();

      if (noteErr || !note) { failures.push(title); continue; }
      processed++;

      // ---- route: action items -> tasks ----
      for (const a of (Array.isArray(ex.action_items) ? ex.action_items : []).slice(0, 30)) {
        const it = a as Record<string, unknown>;
        const t = str(it.title, 300);
        const quote = str(it.quote, 1000);
        if (!t || !quote) continue;                 // unquotable = inferred, so it is dropped
        const due = str(it.due, 40);
        const iso = /^\d{4}-\d{2}-\d{2}$/.test(due) ? `${due}T09:00:00Z` : null;
        const priority = PRIORITIES.includes(str(it.priority, 20)) ? str(it.priority, 20) : "normal";
        const owner = str(it.owner, 120);
        const { error } = await db.from("tasks").insert({
          workspace_id: workspaceId,
          title: owner ? `${t} (${owner})` : t,
          due_label: iso ? null : (due || null),
          due_at: iso,
          priority,
          source_meeting_id: note.id,
          source_quote: quote,
        });
        if (!error) tasksCreated++;
      }

      // ---- route: decisions -> the append-only log ----
      for (const d of (Array.isArray(ex.decisions) ? ex.decisions : []).slice(0, 30)) {
        const it = d as Record<string, unknown>;
        const decision = str(it.decision, 500);
        const quote = str(it.quote, 1000);
        if (!decision || !quote) continue;
        const { error } = await db.from("meeting_decisions").insert({
          workspace_id: workspaceId, meeting_note_id: note.id,
          decision, context: str(it.context, 1000), quote,
          timestamp_label: str(it.timestamp, 40), decided_at: when || null,
        });
        if (!error) decisionsLogged++;
      }

      // ---- route: commitments + insights -> memories ----
      const src = `${title}${when ? ` · ${when.slice(0, 10)}` : ""}`;
      for (const c of (Array.isArray(ex.commitments) ? ex.commitments : []).slice(0, 30)) {
        const it = c as Record<string, unknown>;
        const text = str(it.commitment, 1000);
        if (!text || !str(it.quote, 10)) continue;
        const who = str(it.who, 120);
        const { error } = await db.from("memories").insert({
          workspace_id: workspaceId, kind: "commitment",
          body: who ? `${who}: ${text}` : text, source: src, source_meeting_id: note.id,
        });
        if (!error) memoriesWritten++;
      }
      for (const i of (Array.isArray(ex.insights) ? ex.insights : []).slice(0, 30)) {
        const it = i as Record<string, unknown>;
        const text = str(it.insight, 1000);
        if (!text || !str(it.quote, 10)) continue;
        const { error } = await db.from("memories").insert({
          workspace_id: workspaceId, kind: "context",
          body: text, source: src, source_meeting_id: note.id,
        });
        if (!error) memoriesWritten++;
      }

      await db.from("meeting_notes").update({ status: "routed", routed_at: new Date().toISOString() }).eq("id", note.id);
    }

    await db.from("fathom_sync_state").upsert({
      workspace_id: workspaceId,
      last_created_at: cursor,
      last_synced_at: new Date().toISOString(),
      last_status: failures.length ? "partial" : "ok",
      last_error: failures.length ? `Could not extract: ${failures.join(", ")}`.slice(0, 500) : null,
      meetings_seen: (state?.meetings_seen ?? 0) + processed,
      tasks_created: (state?.tasks_created ?? 0) + tasksCreated,
      decisions_logged: (state?.decisions_logged ?? 0) + decisionsLogged,
      memories_written: (state?.memories_written ?? 0) + memoriesWritten,
    }, { onConflict: "workspace_id" });

    return json({
      processed, skipped, tasksCreated, decisionsLogged, memoriesWritten, failures,
      cursor,
      // The page uses this to decide whether to offer "keep going" — a 79-meeting
      // backfill is many presses, and pretending otherwise would look stalled.
      more: meetings.length === limit,
    });
  } catch (e) {
    console.error("meeting-intelligence failed", e);
    return json({ error: e instanceof Error ? e.message : "Unexpected error." }, 500);
  }
});
