import { useEffect, useLayoutEffect, useState } from "react";
import { useTour } from "@/store/tour";
import { useAuth } from "@/hooks/useAuth";

interface Step { selector?: string; title: string; body: string }

const STEPS: Step[] = [
  { title: "Welcome to MadeEA", body: "Your one-stop command center for executive-assistant work. Here's a 30-second tour — skip any time." },
  { selector: '[data-tour="nav"]', title: "Operations", body: "Run your day from here: Dashboard, Tasks, Clients, SOPs, Communication and Automations." },
  { selector: '[data-tour="ai-suite"]', title: "AI Suite", body: "Communication Studio and Bookkeeping AI draft emails, reports and invoices — with guided inputs and PDF export." },
  { selector: '[data-tour="search"]', title: "Search anything — ⌘K", body: "Press Ctrl/⌘-K to instantly jump to any page, client, task or SOP, and pin your favorites." },
  { selector: '[data-tour="assistant"]', title: "AI Assistant", body: "Ask anything — it knows your tasks, clients and the team's SOPs." },
  { title: "You're all set", body: "Each page has a collapsible 'How this works' guide, and you can replay this tour any time from the ? button." },
];

const DONE_KEY = "madeea-tour-done";

export function GuidedTour() {
  const { open, start, stop } = useTour();
  const { user } = useAuth();
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  // first-login auto-start
  useEffect(() => {
    if (user && !localStorage.getItem(DONE_KEY)) {
      const t = setTimeout(() => { setStep(0); start(); }, 900);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const measure = () => {
    const s = STEPS[step];
    const el = s?.selector ? (document.querySelector(s.selector) as HTMLElement | null) : null;
    const r = el ? el.getBoundingClientRect() : null;
    // If the target is hidden/zero-size (e.g. the sidebar or search on mobile),
    // fall back to a centered bubble instead of a broken spotlight at 0,0.
    setRect(r && r.width > 0 && r.height > 0 ? r : null);
  };
  useLayoutEffect(() => { if (open) measure(); /* eslint-disable-next-line */ }, [open, step]);
  useEffect(() => {
    if (!open) return;
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, step]);

  if (!open) return null;
  const s = STEPS[step];
  const finish = () => { localStorage.setItem(DONE_KEY, "1"); stop(); setStep(0); };
  const next = () => (step < STEPS.length - 1 ? setStep(step + 1) : finish());
  const back = () => setStep(Math.max(0, step - 1));

  const bubble: React.CSSProperties = rect
    ? {
        position: "absolute",
        top: Math.min(rect.bottom + 12, window.innerHeight - 210),
        left: Math.min(Math.max(rect.left, 16), window.innerWidth - 340),
      }
    : { position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)" };

  return (
    <div className="fixed inset-0 z-[70]">
      {rect ? (
        <div
          className="pointer-events-none absolute rounded-lg transition-all"
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

      <div className="card w-80 max-w-[calc(100vw-2rem)] p-4 shadow-2xl" style={bubble}>
        <p className="text-xs text-faint">Step {step + 1} of {STEPS.length}</p>
        <h3 className="mt-1 font-semibold">{s.title}</h3>
        <p className="mt-1 text-sm text-muted">{s.body}</p>
        <div className="mt-4 flex items-center gap-2">
          <button className="text-xs text-faint hover:text-zinc-100" onClick={finish}>Skip tour</button>
          <div className="ml-auto flex gap-2">
            {step > 0 && <button className="btn-ghost border border-border py-1.5 text-xs" onClick={back}>Back</button>}
            <button className="btn-primary py-1.5 text-xs" onClick={next}>{step < STEPS.length - 1 ? "Next" : "Done"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
