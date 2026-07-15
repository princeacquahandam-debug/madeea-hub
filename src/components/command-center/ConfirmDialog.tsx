/**
 * ConfirmDialog — the confirmation gate for high-risk / destructive actions
 * (send, delete, archive…). Renders above the Command Center, traps Enter/Esc,
 * and autofocuses the confirm button for keyboard-only confirmation.
 */
import { useEffect, useRef } from "react";
import { ShieldAlert } from "lucide-react";

export function ConfirmDialog({
  label, onConfirm, onCancel,
}: {
  label: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onCancel(); }
      if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); onConfirm(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onConfirm, onCancel]);

  return (
    <div className="absolute inset-0 z-10 grid place-items-center rounded-2xl bg-black/50 p-6 backdrop-blur-sm" role="alertdialog" aria-modal="true" aria-label="Confirm action">
      <div className="cc-glass w-full max-w-sm rounded-xl p-5 text-center cc-pop">
        <ShieldAlert size={22} className="mx-auto mb-2 text-amber-400" />
        <p className="mb-4 text-sm text-zinc-100">{label}</p>
        <div className="flex justify-center gap-2">
          <button className="btn-ghost border border-border" onClick={onCancel}>Cancel</button>
          <button ref={confirmRef} className="btn-primary" onClick={onConfirm}>Confirm</button>
        </div>
      </div>
    </div>
  );
}
