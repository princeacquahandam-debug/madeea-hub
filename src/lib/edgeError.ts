/**
 * The reason an Edge Function refused, rather than the fact that it did.
 *
 * WHY THIS EXISTS. supabase-js reports every non-2xx from a function as the
 * same sentence: "Edge Function returned a non-2xx status code". The actual
 * reason is in the response body, reachable only through `error.context`, a
 * Response that has to be read and parsed. Code that skips that step cannot
 * tell "already a member" from "not deployed" from "your token expired", and
 * what gets shown to the user is whatever the developer guessed at the time.
 *
 * That guess was wrong on the invite screen, and expensively so: inviting
 * somebody who was already a member printed "Invite service isn't enabled yet.
 * Deploy the invite-member function", so the answer to a 409 was to go looking
 * for a deployment that had been live for days.
 */

export interface EdgeFailure {
  /** What the function said, if it said anything. */
  message: string;
  status?: number;
  /** True only when the function genuinely is not there. */
  missing: boolean;
}

export async function edgeFailure(error: unknown, fallback: string): Promise<EdgeFailure> {
  const ctx = (error as { context?: Response })?.context;
  const status = ctx?.status;

  let message = "";
  if (ctx && typeof ctx.text === "function") {
    try {
      const raw = await ctx.text();
      try {
        const parsed = JSON.parse(raw) as { error?: unknown; message?: unknown };
        message = String(parsed.error ?? parsed.message ?? "").trim();
      } catch {
        // Not JSON. A short body is more use than nothing; a stack trace is not.
        message = raw.trim().slice(0, 200);
      }
    } catch {
      message = "";
    }
  }

  if (!message) {
    const m = (error as { message?: string })?.message ?? "";
    // Suppress the SDK's placeholder, which tells the reader nothing.
    message = /non-2xx status code/i.test(m) ? "" : m;
  }

  return {
    message: message || fallback,
    status,
    /* 404 is the only status that actually means "no such function". Treating
       any failure as "not deployed" is what produced the misleading advice. */
    missing: status === 404,
  };
}
