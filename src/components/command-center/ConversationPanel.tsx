/**
 * ConversationPanel — the running transcript. Each turn shows the user's prompt,
 * then a live ToolExecution indicator while running, and a ResultCard once
 * resolved. Auto-scrolls to the newest turn.
 */
import { useEffect, useRef } from "react";
import { ToolExecution } from "./ToolExecution";
import { ResultCard } from "./ResultCard";
import type { Turn } from "@/lib/command-center/types";

export function ConversationPanel({ turns, onNavigate }: { turns: Turn[]; onNavigate: (path: string) => void }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [turns]);

  if (!turns.length) return null;
  return (
    <div className="max-h-[46vh] space-y-4 overflow-y-auto px-3 py-3" aria-label="Conversation" aria-live="polite">
      {turns.map((t) => (
        <div key={t.id} className="space-y-2">
          <div className="flex justify-end">
            <p className="cc-glass-soft max-w-[85%] rounded-2xl rounded-br-sm px-3 py-1.5 text-sm text-zinc-100">{t.prompt}</p>
          </div>
          {t.status === "running" ? (
            <ToolExecution turn={t} />
          ) : (
            t.result && <ResultCard result={t.result} onNavigate={onNavigate} />
          )}
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}
