import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    // Vite otherwise injects an inline module-preload polyfill, which the strict
    // script-src in vercel.json ('self', no 'unsafe-inline') would block. Every
    // browser in our support range handles modulepreload natively.
    modulePreload: { polyfill: false },
  },
  server: {
    port: 5173,
  },
});
