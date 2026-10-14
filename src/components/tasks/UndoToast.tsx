import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Undo2 } from "lucide-react";

/** "Applied 3 changes · Undo", for ten seconds after an AI suggestion is applied. */
export const UNDO_MS = 10_000;

export function UndoToast({ message, onUndo, onDone }: { message: string; onUndo: () => void; onDone: () => void }) {
  useEffect(() => {
    const t = window.setTimeout(onDone, UNDO_MS);
    return () => window.clearTimeout(t);
  }, [message, onDone]);
  return createPortal(
    <div role="status" className="fixed bottom-6 left-1/2 z-[95] flex -translate-x-1/2 items-center gap-3 rounded-xl bg-[rgb(var(--c-text))] px-4 py-2.5 text-sm text-[rgb(var(--c-bg))] shadow-xl">
      <span>{message}</span>
      <button onClick={() => { onUndo(); onDone(); }} className="flex items-center gap-1 font-semibold text-[rgb(var(--c-accent))] hover:underline">
        <Undo2 size={14} /> Undo
      </button>
    </div>,
    document.body,
  );
}
