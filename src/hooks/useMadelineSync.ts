/**
 * Madeline's conversation follows the person, not the browser.
 *
 * The thread lived only in sessionStorage, so signing in on another device
 * opened Madeline with no memory of anything (reported in review). Now the
 * account holds it too: madeline_threads (migration 0080), one private row per
 * person.
 *
 *  - Signing in loads the saved thread. Anything already in this tab that the
 *    saved copy doesn't have is kept after it.
 *  - Every change saves, debounced, once the load has finished, so an empty
 *    tab can't overwrite a full thread before it has been read.
 *  - Signing out clears the thread from this tab; the saved copy stays.
 *
 * If the table isn't there yet (migration not applied), every call fails
 * quietly and Madeline works exactly as before, per tab.
 */
import { useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { useMadeline, type MadelineTurn } from "@/store/madeline";

const SAVE_DELAY = 800;

export function useMadelineSync() {
  const { user, demo } = useAuth();
  const userId = !demo && supabase ? user?.id ?? null : null;
  const loadedFor = useRef<string | null>(null);
  const lastUser = useRef<string | null>(null);

  // Load on sign-in; clear on sign-out.
  useEffect(() => {
    if (lastUser.current && !userId) useMadeline.getState().clearTurns();
    lastUser.current = userId;
    loadedFor.current = null;
    if (!userId || !supabase) return;

    let cancelled = false;
    void (async () => {
      try {
        const { data, error } = await supabase!
          .from("madeline_threads").select("turns").eq("user_id", userId).maybeSingle();
        if (cancelled || error) return;
        const saved = (Array.isArray(data?.turns) ? data.turns : []) as MadelineTurn[];
        const local = useMadeline.getState().turns;
        const known = new Set(saved.map((t) => t.id));
        const merged = [...saved, ...local.filter((t) => !known.has(t.id))];
        if (merged.length !== local.length || saved.length) useMadeline.getState().setTurns(merged);
      } catch {
        /* Offline or not migrated: keep the tab's own thread. */
      } finally {
        if (!cancelled) loadedFor.current = userId;
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  // Save after changes, once loaded.
  useEffect(() => {
    if (!userId || !supabase) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsub = useMadeline.subscribe((s, prev) => {
      if (s.turns === prev.turns || loadedFor.current !== userId) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        // A turn still waiting on its answer is saved once the answer lands.
        const turns = useMadeline.getState().turns.filter((t) => t.status !== "running");
        void supabase!
          .from("madeline_threads")
          .upsert({ user_id: userId, turns, updated_at: new Date().toISOString() })
          .then(() => undefined, () => undefined);
      }, SAVE_DELAY);
    });
    return () => { clearTimeout(timer); unsub(); };
  }, [userId]);
}
