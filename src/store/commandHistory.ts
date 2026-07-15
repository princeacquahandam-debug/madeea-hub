/**
 * Command history store — remembers recent commands, usage counts, and pinned
 * favorites. Backs the "Recent Commands" and pinned rows in the Command Center.
 * Persisted to localStorage so history survives reloads (mirrors the favorites
 * store pattern used elsewhere in the app).
 */
import { create } from "zustand";
import type { CommandHistoryEntry, Intent } from "@/lib/command-center/types";
import { uid } from "./workspace";

const KEY = "madeea-cc-history";
const MAX = 50;

const load = (): CommandHistoryEntry[] => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
};

interface HistoryState {
  entries: CommandHistoryEntry[];
  /** Record a run; dedupes by prompt text, bumping count + recency. */
  record: (prompt: string, intent: Intent) => void;
  togglePin: (id: string) => void;
  remove: (id: string) => void;
  clear: () => void;
  recent: (n?: number) => CommandHistoryEntry[];
  pinned: () => CommandHistoryEntry[];
  mostUsed: (n?: number) => CommandHistoryEntry[];
}

export const useCommandHistory = create<HistoryState>((set, get) => {
  const persist = (entries: CommandHistoryEntry[]) => localStorage.setItem(KEY, JSON.stringify(entries));

  return {
    entries: load(),
    record: (prompt, intent) => {
      const text = prompt.trim();
      if (!text) return;
      set((s) => {
        const existing = s.entries.find((e) => e.prompt.toLowerCase() === text.toLowerCase());
        let next: CommandHistoryEntry[];
        if (existing) {
          next = s.entries.map((e) =>
            e.id === existing.id ? { ...e, count: e.count + 1, at: Date.now(), intent } : e,
          );
        } else {
          const entry: CommandHistoryEntry = { id: uid("cmd"), prompt: text, intent, at: Date.now(), count: 1, pinned: false };
          next = [entry, ...s.entries];
        }
        // Keep pinned items; cap the rest.
        const pinned = next.filter((e) => e.pinned);
        const rest = next.filter((e) => !e.pinned).slice(0, MAX);
        const merged = [...pinned, ...rest];
        persist(merged);
        return { entries: merged };
      });
    },
    togglePin: (id) =>
      set((s) => {
        const next = s.entries.map((e) => (e.id === id ? { ...e, pinned: !e.pinned } : e));
        persist(next);
        return { entries: next };
      }),
    remove: (id) =>
      set((s) => {
        const next = s.entries.filter((e) => e.id !== id);
        persist(next);
        return { entries: next };
      }),
    clear: () => {
      persist([]);
      set({ entries: [] });
    },
    recent: (n = 6) => [...get().entries].sort((a, b) => b.at - a.at).slice(0, n),
    pinned: () => get().entries.filter((e) => e.pinned),
    mostUsed: (n = 5) =>
      [...get().entries].filter((e) => e.count > 1).sort((a, b) => b.count - a.count).slice(0, n),
  };
});
