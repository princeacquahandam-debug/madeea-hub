import { useEffect, useRef, type RefObject } from "react";

/**
 * Close an AI result when the user clicks anywhere else (6 Nov 2026 call:
 * "once I click outside of this, it should be closed as well").
 *
 * Clicks inside the element itself, inside any dialog (a task opened from the
 * result, a date picker's modal) or inside something marked data-keep-open
 * (the Undo toast, the buttons that start the AI actions) do not count.
 */
export function useOutsideClose(ref: RefObject<HTMLElement | null>, onClose: () => void, enabled = true) {
  const latest = useRef(onClose);
  latest.current = onClose;
  useEffect(() => {
    if (!enabled) return;
    const onDown = (e: PointerEvent) => {
      const el = ref.current;
      const target = e.target as Element | null;
      if (!el || !target || !target.isConnected) return;
      if (el.contains(target)) return;
      if (target.closest('[role="dialog"], [aria-modal="true"], [data-keep-open]')) return;
      latest.current();
    };
    // Registered on the next tick, so the click that opened the result doesn't close it.
    const id = window.setTimeout(() => document.addEventListener("pointerdown", onDown, true), 0);
    return () => { window.clearTimeout(id); document.removeEventListener("pointerdown", onDown, true); };
  }, [ref, enabled]);
}
