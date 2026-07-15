/**
 * Snoozes when running WITHOUT Supabase (demo mode), or before migration 0013 has
 * been applied. Live mode uses the `snoozes` table; this is the local stand-in so
 * "Snooze" is a real, working button in the preview rather than a dead control.
 */
import type { Snooze } from "@/types/db";

const KEY = "madeea-snoozes";

export const loadSnoozes = (): Snooze[] => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
};

export const saveSnooze = (item_type: Snooze["item_type"], item_id: string, snooze_until: string): void => {
  // One live snooze per item — re-snoozing pushes the date out rather than stacking.
  const next = loadSnoozes().filter((s) => !(s.item_type === item_type && s.item_id === item_id));
  next.push({ id: `local-${Date.now()}`, item_type, item_id, snooze_until });
  localStorage.setItem(KEY, JSON.stringify(next));
};
