import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * A dropdown that opens next to something in the header, and is not eaten by it.
 *
 * WHY THIS EXISTS. Two controls in the top bar opened panels that nobody could
 * see: the notification bell and global search. Neither was broken in the way it
 * was reported ("the bell isn't clickable") — both opened, set state and
 * rendered exactly as written. The panels were then clipped to nothing.
 *
 * The header's action row is `overflow-x-auto`, added so the row could scroll
 * instead of running off the edge of a narrow screen. An absolutely positioned
 * child of a scroll container is cropped to that container, and that container
 * is the height of a button. So each panel was drawn and then trimmed to a
 * sliver hidden inside the bar, which from the outside is indistinguishable
 * from a dead control.
 *
 * THE FIX IS A PORTAL, AND IT HAS TO BE. `position: fixed` alone would not
 * survive here either: the header has a backdrop-filter, which makes it the
 * containing block for fixed children, so a fixed panel left in place resolves
 * against the 66px bar rather than the viewport. (ComposeWindow documents the
 * same trap.) Rendered into <body> it escapes both, and the position is
 * measured from the anchor rather than assumed, because the bell genuinely
 * moves when that row scrolls.
 *
 * WHAT THE CALLER STILL OWNS. The trigger, the panel's contents, and rendering
 * it through createPortal. This owns only the part that was subtly wrong twice:
 * measuring, closing, and knowing that a click inside a portalled panel is not
 * a click outside it.
 */
export function useAnchoredPanel<T extends HTMLElement = HTMLDivElement>() {
  const anchorRef = useRef<T | null>(null);
  /* The panel is not a DOM descendant of the anchor once it is portalled, so
     the outside-click check has to know about both. Without this, the first
     click INSIDE the panel closes it, which is worse than the bug being fixed:
     it looks like the panel rejects you. */
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  const place = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    /* Right-aligned to the anchor, hung just below it. Right rather than left
       so a 320px panel opens inwards from the edge of the screen instead of
       off it, which matters because everything using this sits in the top
       right corner. */
    setPos({ top: Math.round(r.bottom + 8), right: Math.round(window.innerWidth - r.right) });
  }, []);

  // Before paint, so the panel is never visible at 0,0 for a frame first.
  useLayoutEffect(() => { if (open) place(); }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    /* A portalled panel does not travel with its anchor, so it either follows
       or it closes. Following is right here: the anchor is in a scrollable row
       and scrolling that row must not orphan the panel beside it. `true`
       captures scrolls on any ancestor, not just the window. */
    const follow = () => place();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", follow, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", follow, true);
    };
  }, [open, place]);

  return { anchorRef, panelRef, open, setOpen, pos };
}

/** The classes every panel using this shares. max-w keeps it on screen on a
 *  phone, where the anchor is close enough to the edge that a fixed 320px
 *  would hang off it. */
export const ANCHORED_PANEL_CLASS =
  "fixed z-[60] max-h-[28rem] w-80 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-2xl";
