import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * Supabase is OPTIONAL at dev time. When env vars are absent the app runs in
 * "demo mode" against local seed data (see src/data/seed.ts) so the UI is fully
 * browsable before a project is provisioned. Once VITE_SUPABASE_* are set, the
 * data layer switches to live queries automatically.
 */
export const isSupabaseConfigured = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url!, anonKey!, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  : null;
