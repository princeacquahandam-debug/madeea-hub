/**
 * SLA thresholds + the working-hours window used to measure response time.
 *
 * Persisted to localStorage (same idiom as store/favorites.ts). When the SLA
 * backend lands this should move to an `sla_settings` table so the thresholds are
 * shared across the workspace rather than living per-browser.
 */
import { create } from "zustand";

export interface SlaConfig {
  /** Replied within this many hours = On Track. */
  okHours: number;
  /** Replied within okHours..riskHours = At Risk. Beyond riskHours = Breached. */
  riskHours: number;
  /** Count only working hours, so a Friday-evening email isn't a weekend breach. */
  businessHoursOnly: boolean;
  /** Local working window, 24h clock. */
  startHour: number;
  endHour: number;
  /** Working days, 0 = Sunday. */
  days: number[];
}

/**
 * Thresholds are measured in WORKING hours, so they don't read like calendar
 * hours: with a 9-hour day, "24h" would be nearly three working days. 8h means
 * "answered the same working day", 16h means "by the end of the next one" —
 * which is what a 24h/48h calendar SLA actually intends. Switch
 * `businessHoursOnly` off and these become plain calendar hours again.
 */
export const DEFAULT_SLA: SlaConfig = {
  okHours: 8,
  riskHours: 16,
  businessHoursOnly: true,
  startHour: 9,
  endHour: 18,
  days: [1, 2, 3, 4, 5],
};

const KEY = "madeea-sla-settings";
const load = (): SlaConfig => {
  try {
    return { ...DEFAULT_SLA, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    return DEFAULT_SLA;
  }
};

interface SlaState {
  config: SlaConfig;
  update: (patch: Partial<SlaConfig>) => void;
  reset: () => void;
}

export const useSlaSettings = create<SlaState>((set) => ({
  config: load(),
  update: (patch) =>
    set((s) => {
      const next = { ...s.config, ...patch };
      localStorage.setItem(KEY, JSON.stringify(next));
      return { config: next };
    }),
  reset: () => {
    localStorage.setItem(KEY, JSON.stringify(DEFAULT_SLA));
    return set({ config: DEFAULT_SLA });
  },
}));
