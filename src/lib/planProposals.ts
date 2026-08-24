/**
 * Reading the planner's answer.
 *
 * Pure, and in its own file so it can be tested without a browser. The
 * interesting cases are all failure cases: a model that returns no block, a
 * truncated one, a time that is not a time, or a block that ends before it
 * begins. Every one of those has to produce "no buttons" rather than a
 * plausible-looking booking.
 */

export interface Proposal {
  title: string;
  start: string; // HH:MM
  end: string;   // HH:MM
  why?: string;
}

/** Pulls the fenced json block out of the model's answer. Null when absent. */
export function parseProposals(output: string): { prose: string; proposals: Proposal[] | null } {
  const fence = output.match(/```json\s*([\s\S]*?)```/i);
  const prose = (fence ? output.slice(0, fence.index ?? 0) : output).trim();
  if (!fence) return { prose, proposals: null };

  try {
    const raw = JSON.parse(fence[1].trim());
    if (!Array.isArray(raw)) return { prose, proposals: null };
    const hhmm = /^([01]?\d|2[0-3]):[0-5]\d$/;
    const proposals = raw
      .filter((p: unknown): p is Proposal => {
        const o = p as Proposal;
        return Boolean(o && typeof o.title === "string" && o.title.trim()
          && typeof o.start === "string" && hhmm.test(o.start)
          && typeof o.end === "string" && hhmm.test(o.end)
          /* A block that ends before it starts is not a near miss to be
             tidied up. Google accepts it and draws a one-line event that
             looks booked, so it is dropped rather than corrected. */
          && o.end > o.start);
      })
      .slice(0, 6);
    return { prose, proposals };
  } catch {
    return { prose, proposals: null };
  }
}
