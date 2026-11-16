import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  // Same reason as the Hub: the CSP allows no inline scripts.
  build: { modulePreload: { polyfill: false } },
  server: { port: 5180 },
});
