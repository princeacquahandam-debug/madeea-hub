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
import { useMadeline, titleFor, type MadelineChat, type MadelineTurn } from "@/store/madeline";

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
        // Chat history (0087) when the column exists; otherwise just the one thread.
        let res = await supabase!.from("madeline_threads").select("turns, chats").eq("user_id", userId).maybeSingle();
        if (res.error) res = await supabase!.from("madeline_threads").select("turns").eq("user_id", userId).maybeSingle() as typeof res;
        const { data, error } = res;
        if (cancelled || error) return;
        const saved = (Array.isArray(data?.turns) ? data.turns : []) as MadelineTurn[];
        const savedChats = (Array.isArray((data as { chats?: unknown } | null)?.chats) ? (data as { chats: MadelineChat[] }).chats : []);
        const st = useMadeline.getState();
        // Chats kept on another device, plus this tab's own.
        const byId = new Map<string, MadelineChat>();
        for (const c of [...savedChats, ...st.chats]) if (!byId.has(c.id) || byId.get(c.id)!.updatedAt < c.updatedAt) byId.set(c.id, c);
        // A thread saved before chat history existed becomes the first chat.
        if (!savedChats.length && saved.length && ![...byId.values()].some((c) => c.turns.some((t) => t.id === saved[0].id))) {
          const id = `legacy-${userId}`;
          byId.set(id, { id, title: titleFor(saved), turns: saved, updatedAt: new Date().toISOString() });
        }
        const chats = [...byId.values()];
        // Open where you left off: this tab's chat if it has one, else the newest.
        const newest = [...chats].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
        st.setChats(chats, st.turns.length ? undefined : newest?.id);
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
      if ((s.turns === prev.turns && s.chats === prev.chats) || loadedFor.current !== userId) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        // A turn still waiting on its answer is saved once the answer lands.
        const st = useMadeline.getState();
        const turns = st.turns.filter((t) => t.status !== "running");
        const chats = st.chats.map((c) => ({ ...c, turns: c.turns.filter((t) => t.status !== "running") }));
        const row = { user_id: userId, turns, chats, updated_at: new Date().toISOString() };
        void supabase!.from("madeline_threads").upsert(row).then(({ error }) => {
          // Before migration 0087 there's no `chats` column: keep saving the open thread.
          if (error) void supabase!.from("madeline_threads").upsert({ user_id: userId, turns, updated_at: row.updated_at }).then(() => undefined, () => undefined);
        }, () => undefined);
      }, SAVE_DELAY);
    });
    return () => { clearTimeout(timer); unsub(); };
  }, [userId]);
}
