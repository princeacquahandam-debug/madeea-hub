import { supabase } from "@/lib/supabase";

/**
 * When each task entered the stage it's in now.
 *
 * updated_at moves for any edit (a typo fixed, a checklist tick), so a task
 * can sit in In progress for five weeks and still look fresh. The stage
 * history in task_activity (0029: a 'created' row, then one 'status' row per
 * move) says how long it has really been there, which is what Abder asked the
 * AI to judge (21 Oct 2026: "stuck for more than four weeks").
 *
 * Best effort: no database, or a read that fails, gives an empty map and the
 * callers fall back to the last update.
 */
export async function fetchStageSince(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!supabase || !ids.length) return out;
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabase
      .from("task_activity")
      .select("task_id,created_at")
      .in("task_id", ids.slice(i, i + 100))
      .in("verb", ["status", "created"])
      .order("created_at", { ascending: false })
      .limit(3000);
    if (error) return out;
    // Newest first, so the first row seen per task is the latest stage change.
    for (const r of (data ?? []) as { task_id: string; created_at: string }[]) {
      if (!out.has(r.task_id)) out.set(r.task_id, r.created_at);
    }
  }
  return out;
}
