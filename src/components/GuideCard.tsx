import { useState } from "react";
import { useLocation } from "react-router-dom";
import { Info, ChevronDown, ChevronUp } from "lucide-react";
import { GUIDES } from "@/lib/guides";

// Collapsible per-page guide. Remembers open/closed per page in localStorage.
export function GuideCard() {
  const { pathname } = useLocation();
  const guide = GUIDES[pathname];
  const storeKey = `madeea-guide-${pathname}`;
  // Collapsed by default; only open if the user explicitly opened it before.
  const [open, setOpen] = useState(() => localStorage.getItem(storeKey) === "open");

  if (!guide) return null;

  function toggle() {
    const next = !open;
    setOpen(next);
    localStorage.setItem(storeKey, next ? "open" : "closed");
  }

  return (
    <div className="card mb-5 overflow-hidden">
      <button onClick={toggle} className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-surface-2/40">
        <Info size={15} className="shrink-0 text-accent-soft" />
        <span className="text-sm font-medium">{guide.title}</span>
        <span className="ml-auto text-faint">{open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</span>
      </button>
      {open && (
        <div className="border-t border-border px-4 py-3">
          <ul className="space-y-1.5 text-sm text-muted">
            {guide.points.map((p, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-0.5 text-accent-soft">•</span>
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
