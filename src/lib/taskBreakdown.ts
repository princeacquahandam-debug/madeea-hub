import { generate } from "@/lib/ai";
import type { Task } from "@/types/db";

/**
 * "Break down a task" (Abder's spec, 14 Oct 2026): 3 to 7 steps, each starting
 * with a verb and at most 10 words, in working order, with an optional time
 * estimate. If the task is too vague, one short question instead of a guess.
 *
 * Reads only the selected task: title, notes, attachments, client and the
 * subtasks it already has. The generate function answers with JSON on the
 * cheaper model (tool "task_breakdown").
 */
export interface Step { text: string; minutes: number | null }
export type Breakdown = { steps: Step[] } | { question: string };

export async function breakDownTask(task: Task, clientName: string | null, answer?: string): Promise<Breakdown> {
  const output = await generate({
    tool: "task_breakdown",
    format: "Break down a task",
    inputs: {
      Title: task.title,
      Notes: task.notes ?? "",
      Client: clientName ?? "",
      "Existing subtasks": (task.subtasks ?? []).map((s) => s.label).join("; "),
      Attachments: (task.attachments ?? []).map((a) => a.label || a.url).join("; "),
      // The answer to Madeline's question, when the first try was too vague.
      "Extra detail from me": answer ?? "",
    },
  });
  return parse(output);
}

/** Only well-formed answers get through; anything else is an error, never a guess. */
export function parse(output: string): Breakdown {
  const raw = String(output ?? "").trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  let data: unknown;
  try { data = JSON.parse(raw); } catch { throw new Error("Couldn't break this task down. Try again."); }
  const d = data as { steps?: unknown; question?: unknown };
  if (typeof d.question === "string" && d.question.trim()) return { question: d.question.trim().slice(0, 200) };
  if (Array.isArray(d.steps)) {
    const steps = d.steps
      .map((s) => s as { text?: unknown; minutes?: unknown })
      .filter((s) => typeof s.text === "string" && s.text.trim())
      .map((s) => ({
        // At most 10 words, as the spec says, whatever came back.
        text: String(s.text).trim().replace(/\.$/, "").split(/\s+/).slice(0, 10).join(" "),
        minutes: typeof s.minutes === "number" && s.minutes > 0 ? Math.round(s.minutes) : null,
      }))
      .slice(0, 7);
    if (steps.length >= 3) return { steps };
  }
  throw new Error("Couldn't break this task down. Try again.");
}
