import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // MadeEA brand — sampled from the reference app (navy + orange)
        bg: "#09141f",
        surface: "#0e1f2f",
        "surface-2": "#15293b",
        border: "#1c3247",
        muted: "#a3b3c2",
        faint: "#6b7d8f",
        accent: "#fd5812",
        "accent-soft": "#ff7a42",
      },
      fontFamily: {
        sans: ['"DM Sans"', "system-ui", "sans-serif"],
        display: ['"Cormorant Garamond"', "Georgia", "serif"],
      },
      borderRadius: {
        xl: "0.875rem",
      },
    },
  },
  plugins: [],
} satisfies Config;
