import { create } from "zustand";

interface TourState {
  open: boolean;
  start: () => void;
  stop: () => void;
}

export const useTour = create<TourState>((set) => ({
  open: false,
  start: () => set({ open: true }),
  stop: () => set({ open: false }),
}));
