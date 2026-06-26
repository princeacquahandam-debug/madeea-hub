import { create } from "zustand";

export interface SavedPrompt {
  id: string;
  key: string; // tool/format this belongs to
  name: string;
  inputs: Record<string, string>;
}

const KEY = "madeea-saved-prompts";
const load = (): SavedPrompt[] => {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; }
};

interface State {
  prompts: SavedPrompt[];
  save: (p: Omit<SavedPrompt, "id">) => void;
  remove: (id: string) => void;
}

export const useSavedPrompts = create<State>((set) => ({
  prompts: load(),
  save: (p) =>
    set((s) => {
      const next = [...s.prompts, { ...p, id: `${Date.now()}-${Math.random().toString(36).slice(2)}` }];
      localStorage.setItem(KEY, JSON.stringify(next));
      return { prompts: next };
    }),
  remove: (id) =>
    set((s) => {
      const next = s.prompts.filter((x) => x.id !== id);
      localStorage.setItem(KEY, JSON.stringify(next));
      return { prompts: next };
    }),
}));
