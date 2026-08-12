import { create } from "zustand";

const COLLAPSE_KEY = "madeea-sidebar-collapsed";
const MADELINE_KEY = "madeea-madeline-open";
const ACADEMY_PROMO_KEY = "madeea-academy-promo-dismissed";

function initialCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(COLLAPSE_KEY) === "1";
}
function initialMadeline(): boolean {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(MADELINE_KEY) !== "0";
}
// Defaults to shown: only an explicit dismissal hides it, so a cleared or
// corrupted localStorage brings the promo back rather than silently losing it.
function initialAcademyPromo(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(ACADEMY_PROMO_KEY) === "1";
}

// Shared UI state — the mobile sidebar drawer (so the guided tour can open it),
// the desktop sidebar collapsed/expanded state, the Madeline rail open/closed
// state, and whether the Academy promo has been dismissed (all persisted).
interface UIState {
  navOpen: boolean;
  setNavOpen: (v: boolean) => void;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  madelineOpen: boolean;
  toggleMadeline: () => void;
  academyPromoDismissed: boolean;
  dismissAcademyPromo: () => void;
  /** Restores the promo — wired to a "Show tips again" control in Settings. */
  restoreAcademyPromo: () => void;
}

export const useUI = create<UIState>((set, get) => ({
  navOpen: false,
  setNavOpen: (v) => set({ navOpen: v }),
  sidebarCollapsed: initialCollapsed(),
  toggleSidebar: () => {
    const next = !get().sidebarCollapsed;
    if (typeof window !== "undefined") window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
    set({ sidebarCollapsed: next });
  },
  madelineOpen: initialMadeline(),
  toggleMadeline: () => {
    const next = !get().madelineOpen;
    if (typeof window !== "undefined") window.localStorage.setItem(MADELINE_KEY, next ? "1" : "0");
    set({ madelineOpen: next });
  },
  academyPromoDismissed: initialAcademyPromo(),
  dismissAcademyPromo: () => {
    if (typeof window !== "undefined") window.localStorage.setItem(ACADEMY_PROMO_KEY, "1");
    set({ academyPromoDismissed: true });
  },
  restoreAcademyPromo: () => {
    if (typeof window !== "undefined") window.localStorage.removeItem(ACADEMY_PROMO_KEY);
    set({ academyPromoDismissed: false });
  },
}));
