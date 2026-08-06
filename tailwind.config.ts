import type { Config } from "tailwindcss";

export default {
  // Themes are driven by the `data-theme` attribute on <html> (see index.css).
  // `class` dark mode is kept for any legacy `dark:` variants.
  darkMode: ["selector", '[data-theme="dark"]'],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // MadeEA "Command Center" tokens — CSS-variable driven so the whole app
        // re-themes (dark/light) from index.css. Channel triplets keep Tailwind
        // alpha modifiers working, e.g. bg-accent/15, bg-surface-2/50.
        bg: "rgb(var(--c-bg) / <alpha-value>)",
        surface: "rgb(var(--c-surface) / <alpha-value>)",
        "surface-2": "rgb(var(--c-surface-2) / <alpha-value>)",
        border: "var(--c-border)",
        muted: "rgb(var(--c-muted) / <alpha-value>)",
        faint: "rgb(var(--c-faint) / <alpha-value>)",
        text: "rgb(var(--c-text) / <alpha-value>)",
        accent: "rgb(var(--c-accent) / <alpha-value>)",
        "accent-soft": "rgb(var(--c-accent-soft) / <alpha-value>)",
      },
      fontFamily: {
        // The redesign is all Plus Jakarta Sans; headings just go heavier.
        sans: ['"Plus Jakarta Sans"', "system-ui", "sans-serif"],
        display: ['"Plus Jakarta Sans"', "system-ui", "sans-serif"],
      },
      borderRadius: {
        xl: "0.875rem",
        "2xl": "1rem",
      },
    },
  },
  plugins: [],
} satisfies Config;
