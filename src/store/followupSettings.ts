/**
 * Thresholds for follow-up nudges, per category — a client who's gone quiet
 * warrants a faster poke than an internal thread or a back-burner task.
 *
 * localStorage for now (same idiom as the SLA settings). Belongs in a workspace
 * table once these need to be shared across devices.
 */
import { create } from "zustand";

export interface FollowUpConfig {
  /** Days of silence on an email we sent to a CLIENT before we nudge. */
  clientEmailDays: number;
  /** Same, for a thread with nobody from the Vault on it. */
  internalEmailDays: number;
  /** Days a task can sit untouched (and not done) before it's flagged stale. */
  taskDays: number;
  /** How long "Snooze" buys you. */
  snoozeDays: number;
}

export const DEFAULT_FOLLOWUP: FollowUpConfig = {
  clientEmailDays: 2,
  internalEmailDays: 4,
  taskDays: 5,
  snoozeDays: 3,
};

const KEY = "madeea-followup-settings";
const load = (): FollowUpConfig => {
  try {
    return { ...DEFAULT_FOLLOWUP, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    return DEFAULT_FOLLOWUP;
  }
};

interface State {
  config: FollowUpConfig;
  update: (patch: Partial<FollowUpConfig>) => void;
  reset: () => void;
}

export const useFollowUpSettings = create<State>((set) => ({
  config: load(),
  update: (patch) =>
    set((s) => {
      const next = { ...s.config, ...patch };
      localStorage.setItem(KEY, JSON.stringify(next));
      return { config: next };
    }),
  reset: () => {
    localStorage.setItem(KEY, JSON.stringify(DEFAULT_FOLLOWUP));
    return set({ config: DEFAULT_FOLLOWUP });
  },
}));
