import { Sparkles, X } from "lucide-react";
import { useMadeline } from "@/store/madeline";

/**
 * Ask Madeline: a 56px orange circle, 28px from the bottom-right corner, on
 * every page (12 Oct 2026, UI review deck slide 10). "Ask Madeline" shows on
 * hover; open, it turns into ✕. It replaced the header button, so Madeline is
 * always one click away without competing with a page's own actions.
 */
export function MadelineFab() {
  const open = useMadeline((s) => s.open);
  const toggle = useMadeline((s) => s.toggle);
  return (
    <div className="group fixed bottom-7 right-7 z-[86] hidden items-center gap-2 sm:flex" data-tour="madeline">
      {!open && (
        <span className="pointer-events-none rounded-md bg-text px-2 py-1 text-xs font-semibold text-bg opacity-0 transition-opacity group-hover:opacity-100">
          Ask Madeline
        </span>
      )}
      <button
        onClick={toggle}
        aria-label={open ? "Close Madeline" : "Ask Madeline"}
        aria-expanded={open}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-[rgb(var(--c-accent-strong))] text-white shadow-lg shadow-black/20 transition-transform hover:scale-105 focus-visible:outline-offset-4"
      >
        {open ? <X size={24} /> : <Sparkles size={24} />}
      </button>
    </div>
  );
}

/** Phone: the same button, smaller and above the mobile browser bar; hidden while the full-screen panel is open. */
export function MadelineFabMobile() {
  const open = useMadeline((s) => s.open);
  const toggle = useMadeline((s) => s.toggle);
  if (open) return null;
  return (
    <button
      onClick={toggle}
      aria-label="Ask Madeline"
      className="fixed bottom-5 right-5 z-[86] flex h-12 w-12 items-center justify-center rounded-full bg-[rgb(var(--c-accent-strong))] text-white shadow-lg shadow-black/20 sm:hidden"
    >
      <Sparkles size={22} />
    </button>
  );
}
