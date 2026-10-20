import { createPortal } from "react-dom";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { BookOpen, ClipboardCheck, GraduationCap, HelpCircle, Info, PlayCircle, X } from "lucide-react";
import { useAnchoredPanel, ANCHORED_PANEL_CLASS } from "@/hooks/useAnchoredPanel";
import { GUIDES } from "@/lib/guides";
import { useTour } from "@/store/tour";

/**
 * "Learn" in the header (13 Oct 2026 call with Abder): how to use the Hub, in
 * plain sight rather than inside the avatar menu. How this page works, the
 * guided tour, the Training Center and the SOPs. Training videos go in the
 * Training Center as they're made.
 */
export function LearnMenu() {
  const { anchorRef, panelRef, open, setOpen, pos } = useAnchoredPanel<HTMLButtonElement>();
  const nav = useNavigate();
  const { pathname } = useLocation();
  const startTour = useTour((s) => s.start);
  const [guideOpen, setGuideOpen] = useState(false);
  const guide = GUIDES[pathname];
  const item = "flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-surface-2";

  return (
    <>
      <button
        ref={anchorRef}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium transition-colors hover:bg-[var(--chip-bg)]"
        title="Learn how the Hub works"
      >
        <BookOpen size={15} />
        <span className="hidden md:inline">Learn</span>
      </button>
      {open && pos && createPortal(
        <div ref={panelRef} role="menu" aria-label="Learn" style={{ top: pos.top, right: pos.right }} className={`card ${ANCHORED_PANEL_CLASS} !w-72 p-1.5 shadow-xl`}>
          <p className="px-2.5 pb-1 pt-1.5 text-xs font-semibold text-faint">Learn</p>
          {guide && (
            <button role="menuitem" className={item} onClick={() => { setOpen(false); setGuideOpen(true); }}>
              <Info size={16} className="mt-0.5 shrink-0 text-accent" />
              <span><span className="block font-medium">How this page works</span><span className="block text-xs text-faint">{guide.title}</span></span>
            </button>
          )}
          <button role="menuitem" className={item} onClick={() => { setOpen(false); startTour(); }}>
            <HelpCircle size={16} className="mt-0.5 shrink-0 text-accent" />
            <span><span className="block font-medium">Replay the guided tour</span><span className="block text-xs text-faint">A two-minute walk through the Hub</span></span>
          </button>
          <button role="menuitem" className={item} onClick={() => { setOpen(false); nav("/academy"); }}>
            <GraduationCap size={16} className="mt-0.5 shrink-0 text-accent" />
            <span><span className="block font-medium">Training Center</span><span className="block text-xs text-faint">Lessons and the Made Ready course</span></span>
          </button>
          <button role="menuitem" className={item} onClick={() => { setOpen(false); nav("/academy#videos"); }}>
            <PlayCircle size={16} className="mt-0.5 shrink-0 text-accent" />
            <span><span className="block font-medium">Training videos</span><span className="block text-xs text-faint">Loom walkthroughs of how the work is done</span></span>
          </button>
          <button role="menuitem" className={item} onClick={() => { setOpen(false); nav("/sops"); }}>
            <ClipboardCheck size={16} className="mt-0.5 shrink-0 text-accent" />
            <span><span className="block font-medium">SOPs</span><span className="block text-xs text-faint">How the work is done</span></span>
          </button>
        </div>,
        document.body,
      )}
      {guideOpen && guide && createPortal(
        <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/30 p-4 pt-20" onClick={() => setGuideOpen(false)}>
          <div role="dialog" aria-label={guide.title} onClick={(e) => e.stopPropagation()} className="card w-[26rem] max-w-full p-5 shadow-xl">
            <div className="mb-3 flex items-center gap-2">
              <Info size={16} className="shrink-0 text-accent" />
              <p className="flex-1 font-bold">{guide.title}</p>
              <button onClick={() => setGuideOpen(false)} aria-label="Close" className="text-faint hover:text-text"><X size={16} /></button>
            </div>
            <ul className="space-y-2 text-sm text-muted">
              {guide.points.map((p, i) => <li key={i} className="flex gap-2"><span className="text-accent">•</span><span>{p}</span></li>)}
            </ul>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
