import { createPortal } from "react-dom";
import { HelpCircle, Moon, MoreHorizontal, Sun } from "lucide-react";
import { useAnchoredPanel, ANCHORED_PANEL_CLASS } from "@/hooks/useAnchoredPanel";
import { useTour } from "@/store/tour";
import { useTheme } from "@/store/theme";

/**
 * The header's "more" menu: light/dark theme and the guided tour.
 *
 * Both were buttons of their own until the 28 Sep audit asked for fewer
 * actions up top. They are things you set once or need rarely, so they wait
 * one click away instead of taking two of the header's seven slots.
 */
export function HeaderMenu() {
  const { anchorRef, panelRef, open, setOpen, pos } = useAnchoredPanel<HTMLButtonElement>();
  const startTour = useTour((s) => s.start);
  const { theme, toggle } = useTheme();

  const item = "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-surface-2";

  return (
    <>
      <button
        ref={anchorRef}
        onClick={() => setOpen(!open)}
        aria-label="More options"
        aria-expanded={open}
        aria-haspopup="menu"
        title="More"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border text-muted transition-colors hover:bg-[var(--chip-bg)] hover:text-text"
      >
        <MoreHorizontal size={18} />
      </button>
      {open && pos && createPortal(
        <div
          ref={panelRef}
          role="menu"
          style={{ top: pos.top, right: pos.right }}
          className={`card ${ANCHORED_PANEL_CLASS} !w-56 p-1.5 shadow-xl`}
        >
          <button role="menuitem" className={item} onClick={() => { toggle(); setOpen(false); }}>
            {theme === "dark" ? <Sun size={16} className="text-muted" /> : <Moon size={16} className="text-muted" />}
            {theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          </button>
          <button role="menuitem" className={item} onClick={() => { setOpen(false); startTour(); }}>
            <HelpCircle size={16} className="text-muted" />
            Replay the guided tour
          </button>
        </div>,
        document.body,
      )}
    </>
  );
}
