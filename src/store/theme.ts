import { create } from "zustand";

// Command Center theme — dark (default) or light. Persisted to localStorage and
// reflected on <html data-theme> (which drives every CSS token in index.css).
export type Theme = "dark" | "light";

const KEY = "madeea:theme";

function initial(): Theme {
  if (typeof window === "undefined") return "dark";
  const saved = window.localStorage.getItem(KEY);
  return saved === "light" || saved === "dark" ? saved : "dark";
}

function apply(theme: Theme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.setAttribute("data-theme", theme);
  // Keep the legacy `dark` class in sync for any `dark:` Tailwind variants.
  root.classList.toggle("dark", theme === "dark");
}

interface ThemeState {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

export const useTheme = create<ThemeState>((set, get) => {
  const theme = initial();
  apply(theme);
  return {
    theme,
    setTheme: (t) => {
      apply(t);
      window.localStorage.setItem(KEY, t);
      set({ theme: t });
    },
    toggle: () => get().setTheme(get().theme === "dark" ? "light" : "dark"),
  };
});
