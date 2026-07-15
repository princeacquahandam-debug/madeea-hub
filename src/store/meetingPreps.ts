/**
 * Cache for generated meeting prep packets, keyed by meeting id.
 *
 * Persisted to localStorage so opening a packet a second time is instant and
 * doesn't re-hit the model. "Regenerate" is the manual invalidation — there is no
 * TTL, because the user is the one who knows whether the underlying data moved.
 */
import { create } from "zustand";
import type { MeetingBrief } from "@/lib/ai";
import type { PrepContext } from "@/lib/meetingPrep";

export interface CachedPrep {
  context: PrepContext;
  brief: MeetingBrief;
  generated_at: string;
}

const KEY = "madeea-meeting-preps";
const load = (): Record<string, CachedPrep> => {
  try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; }
};

interface PrepState {
  preps: Record<string, CachedPrep>;
  save: (meetingId: string, prep: CachedPrep) => void;
  clear: (meetingId: string) => void;
}

export const useMeetingPreps = create<PrepState>((set) => ({
  preps: load(),
  save: (meetingId, prep) =>
    set((s) => {
      const next = { ...s.preps, [meetingId]: prep };
      localStorage.setItem(KEY, JSON.stringify(next));
      return { preps: next };
    }),
  clear: (meetingId) =>
    set((s) => {
      const { [meetingId]: _removed, ...next } = s.preps;
      localStorage.setItem(KEY, JSON.stringify(next));
      return { preps: next };
    }),
}));
