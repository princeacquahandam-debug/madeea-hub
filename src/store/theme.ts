import { create } from "zustand";

/* Light, dark, or follow the device (the default, per the 12 Oct 2026 UI
   review, slide 12). Persisted to localStorage; the resolved theme is put on
   <html data-theme>, which drives every CSS token in index.css. */
export type ThemeChoice = "light" | "dark" | "system";
export type Theme = "light" | "dark";

const KEY = "madeea-theme";
const media = () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null);
const resolve = (c: ThemeChoice): Theme => (c === "system" ? (media()?.matches ? "dark" : "light") : c);

function initial(): ThemeChoice {
  if (typeof window === "undefined") return "system";
  const saved = window.localStorage.getItem(KEY);
  return saved === "light" || saved === "dark" || saved === "system" ? saved : "system";
}

function apply(theme: Theme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.setAttribute("data-theme", theme);
  // Keep the legacy `dark` class in sync for any `dark:` Tailwind variants.
  root.classList.toggle("dark", theme === "dark");
}

interface ThemeState {
  /** What the person chose. */
  choice: ThemeChoice;
  /** What is showing now. */
  theme: Theme;
  setChoice: (c: ThemeChoice) => void;
  /** Kept for existing callers: picks the opposite of what is showing. */
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

export const useTheme = create<ThemeState>((set, get) => {
  const choice = initial();
  const theme = resolve(choice);
  apply(theme);
  // While following the device, follow it live.
  media()?.addEventListener?.("change", () => {
    if (get().choice !== "system") return;
    const t = resolve("system");
    apply(t);
    set({ theme: t });
  });
  return {
    choice,
    theme,
    setChoice: (c) => {
      const t = resolve(c);
      apply(t);
      window.localStorage.setItem(KEY, c);
      set({ choice: c, theme: t });
    },
    setTheme: (t) => get().setChoice(t),
    toggle: () => get().setChoice(get().theme === "dark" ? "light" : "dark"),
  };
});
