import { useCallback, useEffect, useRef } from "react";

/**
 * Has anything in here actually been typed?
 *
 * WHY NOT "does it have content". Half the dialogs in this app open prefilled:
 * the planner arrives with a date and an agenda already in it, the composer
 * with a quoted reply. Treating a non-empty field as unsaved work would make
 * every one of those refuse to close, which trains people to dismiss the
 * warning and puts us back where we started.
 *
 * So it snapshots every control when the dialog opens and compares on the way
 * out. Prefilled is clean. Edited is dirty. That distinction is the whole
 * point: a guard that cries wolf is worse than no guard, because the one time
 * it matters it will be clicked through out of habit.
 *
 * Checkboxes and radios compare on `checked`, and a file input is always
 * treated as dirty once it holds a file, because there is nothing to compare
 * and losing an attachment silently is the worst case here.
 */

type Ctl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

function readAll(root: HTMLElement | null): Map<Ctl, string> {
  const map = new Map<Ctl, string>();
  if (!root) return map;
  for (const el of root.querySelectorAll<Ctl>("input, textarea, select")) {
    if (el.type === "file") {
      map.set(el, (el as HTMLInputElement).files?.length ? "__file__" : "");
    } else if (el.type === "checkbox" || el.type === "radio") {
      map.set(el, String((el as HTMLInputElement).checked));
    } else {
      map.set(el, el.value);
    }
  }
  return map;
}

export function useDirtyGuard(open: boolean) {
  const ref = useRef<HTMLElement | null>(null);
  const snapshot = useRef<Map<Ctl, string>>(new Map());

  useEffect(() => {
    if (!open) { snapshot.current = new Map(); return; }
    /* Two frames, not one. The panel mounts empty and is filled by the same
       render pass that opens it; snapshotting synchronously captures a form of
       empty strings and then calls the prefill itself an edit. */
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => { snapshot.current = readAll(ref.current); });
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  const isDirty = useCallback((): boolean => {
    const now = readAll(ref.current);
    if (snapshot.current.size === 0 && now.size > 0) {
      // Snapshot never ran. Anything with content counts, which errs toward
      // keeping the work rather than discarding it.
      for (const v of now.values()) if (v.trim()) return true;
      return false;
    }
    for (const [el, was] of snapshot.current) {
      const is = now.get(el);
      if (is !== undefined && is !== was) return true;
    }
    /* A control that appeared after opening (a cc row revealed, a guest field
       added) and has something in it is an edit too. */
    for (const [el, is] of now) {
      if (!snapshot.current.has(el) && is.trim()) return true;
    }
    return false;
  }, []);

  return { ref, isDirty };
}
