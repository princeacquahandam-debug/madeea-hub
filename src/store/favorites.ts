import { create } from "zustand";

export interface FavItem {
  id: string;
  label: string;
  path: string;
}

const KEY = "madeea-favorites";
const load = (): FavItem[] => {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; }
};

interface FavState {
  favorites: FavItem[];
  toggle: (item: FavItem) => void;
  isFav: (id: string) => boolean;
}

export const useFavorites = create<FavState>((set, get) => ({
  favorites: load(),
  toggle: (item) =>
    set((s) => {
      const exists = s.favorites.some((f) => f.id === item.id);
      const next = exists ? s.favorites.filter((f) => f.id !== item.id) : [...s.favorites, item];
      localStorage.setItem(KEY, JSON.stringify(next));
      return { favorites: next };
    }),
  isFav: (id) => get().favorites.some((f) => f.id === id),
}));
