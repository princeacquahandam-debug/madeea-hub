/**
 * Emitting an event out of the app.
 *
 * Every tab in the Hub was a closed loop: data arrived, rendered, and stopped.
 * This is the one way out. The browser names what happened; the `emit-alert`
 * edge function decides whether it is real, where it goes, and records what
 * came of it.
 *
 * The browser deliberately does NOT know the destination. The n8n base URL and
 * key are server env vars. In the bundle they would be public, and any page on
 * the internet could post fake breaches into the team's Slack.
 *
 * Dedupe is server-side, on a unique index over (workspace, event, subject).
 * That matters because the trigger here is a render: five EAs opening the
 * dashboard at 9am all notice the same overnight breach, and exactly one alert
 * should result.
 */
import { supabase } from "@/lib/supabase";

/**
 * Every event this app can emit.
 *
 *   sla_breach   — internal. We were late; the team needs to know.
 *   ea_timed_in  — client-facing. Their assistant has started the day.
 *
 * The two audiences are opposite on purpose and 0036 spelled out why: a breach
 * alert tells a client we were late at the moment that is least useful to hear,
 * so it stays internal. A time-in is addressed to the client, true when it is
 * sent, and carries nothing they should not see.
 */
export type AlertEvent = "sla_breach" | "ea_timed_in";

export interface EmitResult {
  ok: boolean;
  /** False when no destination is configured. Not an error. */
  delivered: boolean;
  deduped?: boolean;
  error?: string;
}

/**
 * Fire and forget. Never throws: an alert that could not be sent must not take
 * a page down with it, and the failure is already recorded server-side in
 * alert_deliveries where an operator would look for it.
 */
export async function emitAlert(
  event: AlertEvent,
  subjectId: string,
  payload: Record<string, unknown> = {},
): Promise<EmitResult> {
  if (!supabase) return { ok: false, delivered: false, error: "demo mode" };
  try {
    const { data, error } = await supabase.functions.invoke("emit-alert", {
      body: { event, subject_id: subjectId, payload },
    });
    if (error) return { ok: false, delivered: false, error: error.message };
    return data as EmitResult;
  } catch (e) {
    return { ok: false, delivered: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Emit each subject at most once per browser session, on top of the server's
 * permanent dedupe. Saves a round trip per render rather than relying on the
 * database to say "already seen" forty times while somebody sits on the
 * dashboard with it open.
 */
const seen = new Set<string>();

export function emitOnce(event: AlertEvent, subjectId: string, payload: Record<string, unknown> = {}): void {
  const key = `${event}:${subjectId}`;
  if (seen.has(key)) return;
  seen.add(key);
  void emitAlert(event, subjectId, payload);
}
