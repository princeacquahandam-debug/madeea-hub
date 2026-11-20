import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

/* The build id sent with every analytics event (PostHog plan: app_version).
   Vercel gives the commit; a local build says "dev". */
process.env.VITE_APP_VERSION ??= (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7) || "dev";

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
    /* The libraries in their own files (QA BUG-012, 20 Nov 2026). Everything
       shared sat in one ~1 MB file, so the browser downloaded it in one piece
       and every Hub update threw the whole thing out of its cache, React and
       Supabase included. Split, they download side by side, and an update
       that only changes Hub code leaves these cached. */
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return "react";
          if (id.includes("node_modules/@supabase/")) return "supabase";
          if (/node_modules\/(react-router|react-router-dom|@tanstack)\//.test(id)) return "router-query";
          if (/node_modules\/(marked|dompurify)\//.test(id)) return "markdown";
          if (id.includes("node_modules/lucide-react/")) return "icons";
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
  },
});
