import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { Info, X } from "lucide-react";
import { GUIDES } from "@/lib/guides";

/**
 * "How this page works", as an ⓘ in the header.
 *
 * It was a full-width bar at the top of every page, above the page's own
 * title, so the first thing on every screen was the same strip (28 Sep audit:
 * "it's something you see at the beginning, which is not appropriate"). Now
 * it's one icon beside the date that opens the same points in a panel, and
 * pages without a guide show nothing.
 */
export function GuideButton() {
  const { pathname } = useLocation();
  const guide = GUIDES[pathname];
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  // A different page is a different guide: close it on navigation.
  useEffect(() => { setOpen(false); }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const r = btn.current?.getBoundingClientRect();
    if (r) setPos({ top: Math.round(r.bottom + 8), left: Math.max(8, Math.round(r.left)) });
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btn.current?.contains(t) || panel.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  if (!guide) return null;

  return (
    <>
      <button
        ref={btn}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={guide.title}
        title={guide.title}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-faint transition-colors hover:bg-[var(--chip-bg)] hover:text-text"
      >
        <Info size={17} />
      </button>
      {open && pos && createPortal(
        <div
          ref={panel}
          role="dialog"
          aria-label={guide.title}
          style={{ top: pos.top, left: pos.left }}
          className="card fixed z-[60] w-[22rem] max-w-[calc(100vw-1rem)] p-4 shadow-xl"
        >
          <div className="mb-2 flex items-center gap-2">
            <Info size={15} className="shrink-0 text-accent-soft" />
            <p className="flex-1 text-sm font-bold">{guide.title}</p>
            <button onClick={() => setOpen(false)} aria-label="Close" className="text-faint hover:text-text"><X size={15} /></button>
          </div>
          <ul className="space-y-1.5 text-sm text-muted">
            {guide.points.map((p, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-0.5 text-accent-soft">•</span>
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>,
        document.body,
      )}
    </>
  );
}
