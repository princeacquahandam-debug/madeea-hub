// Supabase Edge Function: delegation-coach  (self-contained. Paste as-is)
// POST { kind, data } -> { ok, result }
// The AI behind the Delegation Coach, ported from the standalone Lovable app.
//
// FOUR FUNCTIONS BECAME ONE. The original shipped analyze-assessment,
// clarify-task, generate-delegation-plan and suggest-follow-ups as four
// separate Edge Functions. All four posted to the SAME n8n webhook, with the
// same envelope, the same 30s timeout, the same error handling and the same
// response unwrapping. The only things that differed were a function_type
// string, two prompts, and the shape of `data`.
//
// Four copies of that meant four places to fix a webhook change and four
// deploys to keep in step, which is how one of them ends up a version behind
// without anybody noticing. The differences live in PROMPTS below; everything
// else is written once.
//
// NO AI KEY LIVES HERE. The webhook is MadeEA's own n8n, which holds the model
// credentials. That is why this feature costs nothing against the OpenAI
// balance the 14 September call spent an hour on, and it is worth keeping that
// way: if a future version calls a model directly, it starts drawing on the
// same shared balance as the quick actions and the EOD drafts.
//
// Security:
//  - Auth enforced in-code (deploy with Verify JWT OFF so CORS preflight passes).
//  - The caller must hold a client_users row: this is a client-facing tool, and
//    an assistant reads the output rather than generating it.
//  - The webhook URL stays server-side. In the bundle it would be an open
//    endpoint anybody could post to.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

const URL_SUPA = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

/** MadeEA's own n8n. Overridable by env so a staging flow does not need a redeploy. */
const WEBHOOK = Deno.env.get("DELEGATION_WEBHOOK_URL")
  ?? "https://madeeas.app.n8n.cloud/webhook/delegate/ai";

const line = (label: string, v: unknown) => (v ? `${label}: ${v}\n` : "");

/** The only thing that differs between the four original functions. */
const PROMPTS: Record<string, { type: string; system: string; user: (d: Record<string, any>) => string }> = {
  assessment: {
    type: "analyze_assessment",
    system:
      "You are an expert delegation coach. Analyze the user's delegation assessment and provide insights. Identify: 1) Key patterns in their delegation approach, 2) Specific barriers preventing effective delegation, 3) Actionable recommendations to improve. Be empathetic, specific, and encouraging.",
    user: (d) =>
      `Assessment Responses:\n` +
      `- Tasks draining time: ${d.draining_tasks ?? ""}\n` +
      `- Tasks not delegating: ${d.tasks_not_delegating ?? ""}\n` +
      `- Barriers to delegation: ${d.delegation_barriers ?? ""}\n` +
      `- Team members available: ${d.team_members ?? ""}\n\n` +
      `Analyze these responses and provide specific insights.`,
  },
  clarify: {
    type: "clarify_task",
    system:
      "You are a delegation coach helping clarify task requirements. Ask probing questions to help the user define clear, measurable outcomes. Refine vague descriptions into precise, actionable objectives.",
    user: (d) =>
      `Task to delegate: ${d.task ?? ""}\n\nUser responses so far:\n` +
      Object.entries(d.responses ?? {}).map(([q, a]) => `${q}: ${a}`).join("\n") +
      `\n\nBased on this information, provide:\n1. Any additional clarifying questions needed\n2. A refined, clear outcome statement\n3. Suggested context the team member needs\n4. Recommended success criteria`,
  },
  plan: {
    type: "generate_plan",
    system:
      "You are a delegation coach creating professional delegation plans. Generate a comprehensive plan with clear outcomes, success criteria, and handoff messaging. Be specific, actionable, and professional.",
    user: (d) =>
      `Create a delegation plan for:\n` +
      line("Task", d.task_name) + line("Outcome", d.outcome) + line("Context", d.context) +
      line("Team Member", d.team_member) + line("Deadline", d.deadline) +
      line("Autonomy Level", d.autonomy_level) + line("Support Needed", d.support_needed) +
      `\nGenerate:\n1. Refined success criteria (3-5 specific, measurable items)\n2. Identified risks and mitigation strategies\n3. Recommended check-in schedule\n4. Professional handoff message for the team member\n5. Best practice tips specific to this delegation`,
  },
  followups: {
    type: "suggest_followups",
    system:
      "You are a delegation coach helping set up effective follow-ups. Provide practical templates and accountability questions.",
    user: (d) =>
      line("Task", d.task_name) + line("Team Member", d.team_member) +
      line("Timeline", d.deadline) + line("Autonomy", d.autonomy_level) +
      `\nGenerate:\n1. Follow-up message templates (3-5 for different check-ins)\n2. Reflection questions for later review\n3. Recommended follow-up frequency`,
  },
};

/**
 * n8n wraps its answer differently depending on which node last touched it, and
 * all four original functions carried this same unwrapper. Kept verbatim rather
 * than tidied: each branch is a real response shape somebody hit.
 */
function unwrap(data: any): any {
  if (data?.success && data?.result) return data.result;
  if (data?.success_criteria || data?.handoff_message || data?.risks) return data;
  if (Array.isArray(data) && data[0]) return unwrap(data[0]);
  if (data?.output) return unwrap(typeof data.output === "string" ? JSON.parse(data.output) : data.output);
  return data;
}

/** n8n says "tips"; every screen in the app reads "best_practices". */
function normalise(r: any) {
  const risks = Array.isArray(r?.risks)
    ? r.risks.map((x: any) => (typeof x === "string" ? { risk: x, mitigation: "" } : x))
    : [];
  return {
    ...r,
    risks,
    best_practices: r?.best_practices ?? r?.tips ?? [],
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "unauthorized" }, 401);

    /* Checked against the database with the caller's own token. The coach
       writes nothing here -- the RPCs in 0076 do that, and they check the role
       again -- but an endpoint that will call an AI on request should not be
       open to any authenticated account in the project. */
    const res = await fetch(`${URL_SUPA}/rest/v1/client_users?select=client_id&limit=1`, {
      headers: { Authorization: auth, apikey: ANON },
    });
    const rows = res.ok ? await res.json() : [];
    if (!Array.isArray(rows) || rows.length === 0) {
      return json({ error: "The delegation coach is for client accounts." }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const spec = PROMPTS[String(body.kind ?? "")];
    if (!spec) {
      return json({ error: `kind must be one of: ${Object.keys(PROMPTS).join(", ")}` }, 400);
    }

    const data = (body.data ?? {}) as Record<string, any>;

    const upstream = await fetch(WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: crypto.randomUUID(),
        function_type: spec.type,
        system_prompt: spec.system,
        user_prompt: spec.user(data),
        data,
      }),
      // The original's timeout, kept. n8n plus a model is slow, and a browser
      // waiting forever on a hung flow is worse than a refusal it can retry.
      signal: AbortSignal.timeout(30_000),
    });

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => "");
      /* Say which failure this is. "Non-2xx" sent somebody hunting a deploy
         that had been live for days, which is the lesson lib/edgeError.ts was
         written from. */
      return json(
        { error: `The coaching service answered ${upstream.status}. ${detail.slice(0, 200)}` },
        502,
      );
    }

    return json({ ok: true, result: normalise(unwrap(await upstream.json())) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unexpected error";
    if (msg.includes("timed out") || msg.includes("aborted")) {
      return json({ error: "The coaching service took too long. Try again in a moment." }, 504);
    }
    return json({ error: msg }, 500);
  }
});
