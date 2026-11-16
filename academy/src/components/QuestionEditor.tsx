import { ArrowDown, ArrowUp, Check, Plus, Trash2 } from "lucide-react";
import type { Difficulty } from "@/lib/api";

export interface DraftQuestion {
  id: string;
  kind: "choice" | "text";
  prompt: string;
  choices: string[];
  correct_index: number | null;
  model_answer: string;
  explanation: string;
  difficulty: Difficulty;
}

export const newQuestion = (kind: "choice" | "text" = "choice"): DraftQuestion => ({
  id: crypto.randomUUID(), kind, prompt: "", choices: kind === "choice" ? ["", ""] : [], correct_index: kind === "choice" ? 0 : null,
  model_answer: "", explanation: "", difficulty: "medium",
});

/** Questions with their answers: multiple choice or free text (16 Nov). */
export function QuestionList({ items, onChange, allowText = true, showDifficulty = false }: {
  items: DraftQuestion[]; onChange: (q: DraftQuestion[]) => void; allowText?: boolean; showDifficulty?: boolean;
}) {
  const set = (i: number, q: DraftQuestion) => onChange(items.map((x, j) => (j === i ? q : x)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d; if (j < 0 || j >= items.length) return;
    const n = [...items]; [n[i], n[j]] = [n[j], n[i]]; onChange(n);
  };
  return (
    <div className="space-y-3">
      {items.map((q, i) => (
        <div key={q.id} className="rounded-lg border border-border bg-bg p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-faint">Q{i + 1}</span>
            {allowText && (
              <select className="input !h-8 !w-auto" value={q.kind}
                onChange={(e) => {
                  const kind = e.target.value as "choice" | "text";
                  set(i, { ...q, kind, choices: kind === "choice" && q.choices.length < 2 ? ["", ""] : q.choices, correct_index: kind === "choice" ? q.correct_index ?? 0 : null });
                }}>
                <option value="choice">Multiple choice</option>
                <option value="text">Free text</option>
              </select>
            )}
            {showDifficulty && (
              <select className="input !h-8 !w-auto" value={q.difficulty} onChange={(e) => set(i, { ...q, difficulty: e.target.value as Difficulty })}>
                <option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option>
              </select>
            )}
            <div className="flex-1" />
            <button className="btn-ghost !h-7" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up"><ArrowUp size={14} /></button>
            <button className="btn-ghost !h-7" onClick={() => move(i, 1)} disabled={i === items.length - 1} aria-label="Move down"><ArrowDown size={14} /></button>
            <button className="btn-ghost !h-7" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label="Remove question"><Trash2 size={14} /></button>
          </div>
          <textarea className="textarea mb-2" rows={2} placeholder="Question" value={q.prompt} onChange={(e) => set(i, { ...q, prompt: e.target.value })} />
          {q.kind === "choice" ? (
            <div className="space-y-1.5">
              {q.choices.map((c, ci) => (
                <div key={ci} className="flex items-center gap-2">
                  <button onClick={() => set(i, { ...q, correct_index: ci })} title="Mark as the right answer" aria-label={`Answer ${ci + 1} is right`}
                    className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border ${q.correct_index === ci ? "border-good bg-good text-white" : "border-border text-transparent hover:text-faint"}`}>
                    <Check size={14} />
                  </button>
                  <input className="input !h-8" placeholder={`Answer ${ci + 1}`} value={c}
                    onChange={(e) => set(i, { ...q, choices: q.choices.map((x, k) => (k === ci ? e.target.value : x)) })} />
                  <button className="btn-ghost !h-7" disabled={q.choices.length <= 2} aria-label="Remove answer"
                    onClick={() => set(i, { ...q, choices: q.choices.filter((_, k) => k !== ci), correct_index: q.correct_index === ci ? 0 : q.correct_index != null && q.correct_index > ci ? q.correct_index - 1 : q.correct_index })}>
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
              {q.choices.length < 6 && <button className="btn-ghost" onClick={() => set(i, { ...q, choices: [...q.choices, ""] })}><Plus size={13} />Answer</button>}
              <p className="text-[11px] text-faint">Tick the right answer.</p>
            </div>
          ) : (
            <textarea className="textarea" rows={2} placeholder="A strong answer (shown to the learner after they answer)" value={q.model_answer}
              onChange={(e) => set(i, { ...q, model_answer: e.target.value })} />
          )}
          <input className="input mt-2" placeholder="Why (optional, shown after answering)" value={q.explanation} onChange={(e) => set(i, { ...q, explanation: e.target.value })} />
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <button className="btn" onClick={() => onChange([...items, newQuestion("choice")])}><Plus size={14} />Multiple choice</button>
        {allowText && <button className="btn" onClick={() => onChange([...items, newQuestion("text")])}><Plus size={14} />Free text</button>}
      </div>
    </div>
  );
}

/** Problems that would make a question unusable; empty when it's fine. */
export function questionProblems(q: DraftQuestion): string | null {
  if (!q.prompt.trim()) return "a question has no text";
  if (q.kind === "choice") {
    const filled = q.choices.filter((c) => c.trim()).length;
    if (filled < 2) return `"${q.prompt.slice(0, 40)}" needs at least two answers`;
    if (q.correct_index == null || !q.choices[q.correct_index]?.trim()) return `"${q.prompt.slice(0, 40)}" has no right answer ticked`;
  }
  return null;
}
