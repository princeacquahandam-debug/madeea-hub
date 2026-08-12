import { supabase, isSupabaseConfigured } from "@/lib/supabase";

/**
 * Client side of Meeting Intelligence. The browser only ever asks the Edge
 * Function to run a sync, it never holds the Fathom key or the model key, and it
 * never writes the extracted rows itself. Everything it then displays it reads
 * back through normal RLS-scoped queries.
 */

export interface SyncResult {
  processed: number;
  skipped: number;
  tasksCreated: number;
  decisionsLogged: number;
  memoriesWritten: number;
  failures: string[];
  cursor: string | null;
  /** True when the batch filled up. There is more history behind it. */
  more: boolean;
}

export interface IntelStatus {
  configured: { fathom: boolean; model: boolean };
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase!.functions.invoke("meeting-intelligence", { body });
  if (error) {
    // supabase-js only surfaces "non-2xx status"; the useful reason is in the body.
    let msg = error.message;
    try {
      const detail = await (error as { context?: { json?: () => Promise<{ error?: string }> } }).context?.json?.();
      if (detail?.error) msg = detail.error;
    } catch { /* keep the generic message */ }
    throw new Error(msg);
  }
  return data as T;
}

/**
 * Pulls one bounded batch. Deliberately not a loop: an Edge Function has a wall
 * clock, and a 79-transcript backfill as a single request would time out and lose
 * the lot. The cursor is stored server-side, so calling this again resumes.
 */
export async function syncMeetings(limit = 3): Promise<SyncResult> {
  if (isSupabaseConfigured && supabase) return invoke<SyncResult>({ action: "sync", limit });
  await new Promise((r) => setTimeout(r, 600));
  return { processed: 0, skipped: 0, tasksCreated: 0, decisionsLogged: 0, memoriesWritten: 0,
    failures: [], cursor: null, more: false };
}

export async function intelStatus(): Promise<IntelStatus> {
  if (isSupabaseConfigured && supabase) return invoke<IntelStatus>({ action: "status" });
  return { configured: { fathom: false, model: false } };
}
