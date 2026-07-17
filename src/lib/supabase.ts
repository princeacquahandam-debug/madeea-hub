import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * Supabase is OPTIONAL at dev time. When env vars are absent the app runs in
 * "demo mode" against local seed data (see src/data/seed.ts) so the UI is fully
 * browsable before a project is provisioned. Once VITE_SUPABASE_* are set, the
 * data layer switches to live queries automatically.
 *
 * Demo mode auto-signs-in as an admin persona with no authentication, so it must
 * never be reachable in a production build: a typo'd or missing env var would
 * otherwise fail OPEN and ship an unauthenticated app rather than break loudly.
 */
export const isSupabaseConfigured = Boolean(url && anonKey);

// Fail closed: a missing/typo'd env var in a real deployment must break loudly
// rather than quietly serve the seed data to anyone who finds the URL. Set
// VITE_ALLOW_DEMO=true only for a deliberately public, data-free demo build.
if (import.meta.env.PROD && !isSupabaseConfigured && import.meta.env.VITE_ALLOW_DEMO !== "true") {
  throw new Error(
    "VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required in production. " +
      "Refusing to start in demo mode, which signs everyone in as an admin with no password. " +
      "For an intentional public demo, set VITE_ALLOW_DEMO=true.",
  );
}

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url!, anonKey!, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  : null;
