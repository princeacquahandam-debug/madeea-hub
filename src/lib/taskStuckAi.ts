import { generate } from "@/lib/ai";
import type { Task } from "@/types/db";
import { dayKey, findStuck, type Assignable, type StuckRow } from "@/lib/taskInsights";
import { fetchStageSince } from "@/lib/taskStageSince";
import { taskLine } from "@/lib/taskPrioritizeAi";

/**
 * "Find stuck tasks" (Abder's "AI quick actions and cost" deck, 6 Nov 2026,
 * slide 7): the rules in code decide what is stuck (overdue, Blocked, no
 * update in 7+ days, approval waiting 3+ days), so the list is instant, the
 * same every time and never wrong. The AI only writes each reason and the next
 * step, for at most 5 tasks. If it can't be reached, the rules' own wording
 * shows and the card says so.
 *
 * (From 27 Oct to 6 Nov the AI chose which tasks were stuck; the deck moved
 * that decision back into code.)
 */
export const MAX_STUCK = 5;
const words = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().split(" ").slice(0, n).join(" ");

export interface StuckResult { checked: number; rows: StuckRow[]; summary: string; ai: boolean }

interface AiRow { id?: unknown; why?: unknown; next?: unknown }

/** The AI's wording laid over the rules' rows; unknown ids are ignored. */
export function mergeStuckWording(output: string, byRef: Map<string, StuckRow>): { summary: string; rows: StuckRow[] } {
  const raw = String(output ?? "").trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  const data = JSON.parse(raw) as { summary?: unknown; rows?: unknown };
  if (!Array.isArray(data.rows)) throw new Error("no rows");
  const text = new Map<string, AiRow>();
  for (const r of data.rows as AiRow[]) text.set(String(r?.id ?? "").trim().toUpperCase(), r);
  const rows = [...byRef].map(([ref, row]) => {
    const t = text.get(ref);
    return t ? { ...row, why: words(t.why, 16) || row.why, next: words(t.next, 16) || undefined } : row;
  });
  const summary = typeof data.summary === "string" && data.summary.trim() ? data.summary.trim().slice(0, 300) : "";
  return { summary, rows };
}

export async function findStuckWithAi(tasks: Task[], opts: { now: Date; members: Assignable[] }): Promise<StuckResult> {
  const { now } = opts;
  const rules = findStuck(tasks, now);
  const picked = rules.rows.slice(0, MAX_STUCK);
  if (!picked.length) return { checked: rules.checked, rows: [], summary: "", ai: false };

  const today = dayKey(now);
  const name = (id: string | null | undefined) => opts.members.find((m) => m.user_id === id)?.name ?? "Unassigned";
  const byRef = new Map(picked.map((r, i) => [`T${i + 1}`, r]));
  try {
    const since = await fetchStageSince(picked.map((r) => r.task.id));
    const output = await generate({
      tool: "task_stuck",
      format: "Find stuck tasks",
      inputs: {
        Today: `${today} (${now.toLocaleDateString("en-GB", { weekday: "long" })})`,
        "Stuck tasks": "\n" + [...byRef].map(([ref, r]) =>
          `${taskLine(ref, r.task, now, today, name, since.get(r.task.id))} | flagged: ${r.why} (${r.days} days)`).join("\n"),
        ...(rules.rows.length > picked.length ? { Note: `${rules.rows.length} tasks are stuck in total; these are the ${picked.length} most stuck.` } : {}),
      },
    });
    const { summary, rows } = mergeStuckWording(output, byRef);
    return { checked: rules.checked, rows, summary, ai: true };
  } catch (e) {
    console.error("AI wording for stuck tasks failed, using the rules' own", e);
    return { checked: rules.checked, rows: picked, summary: "Madeline couldn't be reached, so these are the board's own reasons.", ai: false };
  }
}
