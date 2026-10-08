import { useEffect, useLayoutEffect, useState } from "react";
import { useTour } from "@/store/tour";
import { useAuth } from "@/hooks/useAuth";
import { useUI } from "@/store/ui";
import { supabase } from "@/lib/supabase";
import { atLeast, useMyRole } from "@/data/hooks";

interface Step { selector?: string; title: string; body: string; needsNav?: boolean; minRole?: "manager" }

/* One step per nav group whose NAME does not already explain it. "Clients &
   Files" and "Setup" say what they hold, so a step telling you so would just be
   length. The tour promises 30 seconds and should cost 30 seconds. */
const ALL_STEPS: Step[] = [
  { title: "Welcome to MadeEA Hub", body: "One place for your executive-assistant work. Here's a 30-second tour. Skip any time." },
  { selector: '[data-tour="nav"]', needsNav: true, title: "My Day", body: "Top to bottom is the order you work: inbox, then the board, then the EOD that closes the day. Start here every morning." },
  { selector: '[data-tour="playbook"]', needsNav: true, title: "Playbook", body: "How the work is done, defined once and reused. Record a Video Instruction, write it up as an SOP, put it on a schedule, and learn it in the Training Center." },
  { selector: '[data-tour="clients-files"]', needsNav: true, minRole: "manager", title: "Clients & Files", body: "Each client's profile and logins, your notes and files, and the Client Scoreboard. Pages that belong together open as tabs: Calendar has Meeting Intelligence, Task Manager has Routines." },
  { selector: '[data-tour="madeline"]', title: "Ask Madeline", body: "Your AI assistant, on every page. She sees what you have open (a task, meeting, client or email), and the conversation follows you from page to page. Ctrl/⌘-K searches and jumps anywhere." },
  { title: "You're all set", body: "The ⓘ beside the date explains the page you are on, and the ⋯ menu in the top right replays this tour." },
];

const DONE_KEY = "madeea-tour-done";
const BW = 320; // bubble width
const BH = 210; // approx bubble height for placement
const PAD = 14;

// Find the first *visible* element matching a selector. On mobile there can be
// two instances (hidden desktop sidebar + visible drawer). We want the shown one.
function findVisible(selector?: string): HTMLElement | null {
  if (!selector) return null;
  const els = Array.from(document.querySelectorAll(selector)) as HTMLElement[];
  return els.find((e) => { const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2; }) ?? null;
}

export function GuidedTour() {
  const { open, start, stop } = useTour();
  const { user } = useAuth();
  const { setNavOpen } = useUI();
  const [step, setStep] = useState(0);
  // The section a step points at may be hidden for this role (constants.ts NAV).
  const { data: role } = useMyRole();
  const STEPS = ALL_STEPS.filter((s) => !s.minRole || atLeast(role, s.minRole));
  const [rect, setRect] = useState<DOMRect | null>(null);

  /* First-login auto-start. "Done" lives on the account as well as in this
     browser: signing out wipes every madeea- key (lib/localData.ts), so a
     browser-only flag brought the tour back on every single login. */
  useEffect(() => {
    if (user && !user.tourDone && !localStorage.getItem(DONE_KEY)) {
      const t = setTimeout(() => { setStep(0); start(); }, 900);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Open/close the sidebar drawer so the spotlighted nav is actually visible
  // (no-op on desktop, where the drawer is lg:hidden and the sidebar is always shown).
  useEffect(() => {
    if (!open) return;
    setNavOpen(!!STEPS[step]?.needsNav);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, step]);

  const measure = () => {
    const el = findVisible(STEPS[step]?.selector);
    const r = el ? el.getBoundingClientRect() : null;
    setRect(r && r.width > 0 && r.height > 0 ? r : null);
  };

  useLayoutEffect(() => { if (open) measure(); /* eslint-disable-next-line */ }, [open, step]);
  useEffect(() => {
    if (!open) return;
    // re-measure after the drawer has mounted/animated, plus on resize/scroll
    const t = setTimeout(measure, 140);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => { clearTimeout(t); window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, step]);

  if (!open) return null;
  const s = STEPS[step];
  const finish = () => {
    localStorage.setItem(DONE_KEY, "1");
    // Best effort: if it fails, the browser flag still holds until sign-out.
    if (supabase && !user?.tourDone) void supabase.auth.updateUser({ data: { tour_done_at: new Date().toISOString() } });
    setNavOpen(false); stop(); setStep(0);
  };
  const next = () => (step < STEPS.length - 1 ? setStep(step + 1) : finish());
  const back = () => setStep(Math.max(0, step - 1));

  // Place the bubble on a side of the target that has room. Never covering it.
  const bubble: React.CSSProperties = (() => {
    if (!rect) return { position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
    const vw = window.innerWidth, vh = window.innerHeight;
    const clampX = (x: number) => Math.min(Math.max(x, PAD), vw - BW - PAD);
    const clampY = (y: number) => Math.min(Math.max(y, PAD), vh - BH - PAD);
    let top: number, left: number;
    if (vh - rect.bottom >= BH + PAD) { top = rect.bottom + PAD; left = clampX(rect.left); }        // below
    else if (rect.top >= BH + PAD) { top = rect.top - PAD - BH; left = clampX(rect.left); }          // above
    else if (vw - rect.right >= BW + PAD) { left = rect.right + PAD; top = clampY(rect.top); }        // right
    else if (rect.left >= BW + PAD) { left = rect.left - PAD - BW; top = clampY(rect.top); }          // left
    else { top = clampY(vh - BH - PAD); left = clampX(vw - BW - PAD); }                                // corner fallback
    return { position: "absolute", top, left };
  })();

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

      <div className="card w-80 max-w-[calc(100vw-2rem)] bg-[rgb(var(--c-surface))] p-4 shadow-2xl" style={bubble}>
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
