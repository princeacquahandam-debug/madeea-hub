import { useEffect, useLayoutEffect, useState } from "react";

/**
 * A per-page guided tour, same look and feel as the app's first-login GuidedTour
 * but scoped to one screen. It auto-runs the first time someone opens the page
 * (tracked per storageKey), can be replayed, and — unlike the global tour, which
 * only spotlights always-visible chrome — it scrolls each target into view
 * first, so it works on a long page whose sections sit below the fold.
 */
export interface TourStep {
  /** CSS selector for the element to spotlight. Omit for a centered, anchorless step. */
  selector?: string;
  title: string;
  body: string;
}

const BW = 320; // bubble width
const BH = 210; // approx bubble height, for placement math
const PAD = 14;

function findVisible(selector?: string): HTMLElement | null {
  if (!selector) return null;
  const els = Array.from(document.querySelectorAll(selector)) as HTMLElement[];
  return els.find((e) => { const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2; }) ?? null;
}

export function PageTour({
  steps,
  storageKey,
  open,
  onClose,
}: {
  steps: TourStep[];
  storageKey: string;
  open: boolean;
  onClose: () => void;
}) {
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => { if (open) setStep(0); }, [open]);

  const measure = () => {
    const el = findVisible(steps[step]?.selector);
    if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
    const r = el ? el.getBoundingClientRect() : null;
    setRect(r && r.width > 0 && r.height > 0 ? r : null);
  };

  useLayoutEffect(() => { if (open) measure(); /* eslint-disable-next-line */ }, [open, step]);
  useEffect(() => {
    if (!open) return;
    // Re-measure after the smooth scroll settles, and on resize/scroll.
    const t = setTimeout(measure, 320);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") back();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, step]);

  if (!open) return null;
  const s = steps[step];
  const finish = () => { localStorage.setItem(storageKey, "1"); onClose(); setStep(0); };
  const next = () => (step < steps.length - 1 ? setStep(step + 1) : finish());
  const back = () => setStep(Math.max(0, step - 1));

  const bubble: React.CSSProperties = (() => {
    if (!rect) return { position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
    const vw = window.innerWidth, vh = window.innerHeight;
    const clampX = (x: number) => Math.min(Math.max(x, PAD), vw - BW - PAD);
    const clampY = (y: number) => Math.min(Math.max(y, PAD), vh - BH - PAD);
    let top: number, left: number;
    if (vh - rect.bottom >= BH + PAD) { top = rect.bottom + PAD; left = clampX(rect.left); }
    else if (rect.top >= BH + PAD) { top = rect.top - PAD - BH; left = clampX(rect.left); }
    else if (vw - rect.right >= BW + PAD) { left = rect.right + PAD; top = clampY(rect.top); }
    else if (rect.left >= BW + PAD) { left = rect.left - PAD - BW; top = clampY(rect.top); }
    else { top = clampY(vh - BH - PAD); left = clampX(vw - BW - PAD); }
    return { position: "fixed", top, left };
  })();

  return (
    <div className="fixed inset-0 z-[70]">
      {rect ? (
        <div
          className="pointer-events-none fixed rounded-lg transition-all"
          style={{
            top: rect.top - 6,
            left: rect.left - 6,
            width: rect.width + 12,
            height: rect.height + 12,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.7)",
            outline: "2px solid rgba(253,88,18,0.85)",
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-black/70" />
      )}

      <div className="card w-80 max-w-[calc(100vw-2rem)] bg-[rgb(var(--c-surface))] p-4 shadow-2xl" style={bubble}>
        <p className="text-xs text-faint">Step {step + 1} of {steps.length}</p>
        <h3 className="mt-1 font-semibold">{s.title}</h3>
        <p className="mt-1 text-sm text-muted">{s.body}</p>
        <div className="mt-4 flex items-center gap-2">
          <button className="text-xs text-faint hover:text-zinc-100" onClick={finish}>Skip</button>
          <div className="ml-auto flex gap-2">
            {step > 0 && <button className="btn-ghost border border-border py-1.5 text-xs" onClick={back}>Back</button>}
            <button className="btn-primary py-1.5 text-xs" onClick={next}>{step < steps.length - 1 ? "Next" : "Done"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Drives a PageTour: auto-opens the first time (per storageKey), and returns a
 * `replay` you can wire to a button.
 */
export function usePageTour(storageKey: string, autoStart = true) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (autoStart && !localStorage.getItem(storageKey)) {
      const t = setTimeout(() => setOpen(true), 700);
      return () => clearTimeout(t);
    }
  }, [storageKey, autoStart]);
  return { open, replay: () => setOpen(true), close: () => setOpen(false) };
}
