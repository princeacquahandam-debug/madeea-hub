import { create } from "zustand";

const COLLAPSE_KEY = "madeea:sidebar-collapsed";
const MADELINE_KEY = "madeea:madeline-open";

function initialCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(COLLAPSE_KEY) === "1";
}
function initialMadeline(): boolean {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(MADELINE_KEY) !== "0";
}

// Shared UI state — the mobile sidebar drawer (so the guided tour can open it),
// the desktop sidebar collapsed/expanded state, and the Madeline rail open/closed
// state (all persisted).
interface UIState {
  navOpen: boolean;
  setNavOpen: (v: boolean) => void;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  madelineOpen: boolean;
  toggleMadeline: () => void;
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
}));
