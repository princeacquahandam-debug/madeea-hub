/**
 * SLA thresholds and the working-hours window used to measure response time.
 *
 * Lives in the `sla_settings` table (0036), one row per workspace. It used to
 * live in localStorage, which meant every person carried a private definition
 * of "late", clearing your browser silently reset it, and two admins could
 * disagree about whether a client was breached while looking at the same
 * screen. It is a promise made to a client, so it belongs in the database.
 *
 * The store's public shape is unchanged on purpose: `config`, `update`,
 * `reset`. Nine pages read it and none of them had to be touched.
 *
 * Reads stay synchronous because the maths in lib/sla.ts runs during render.
 * So this is a cache: DEFAULT_SLA immediately, hydrate() fills it in from the
 * server, and writes go through to the server. The window between first paint
 * and hydration shows the defaults rather than a spinner, which is right for a
 * threshold nobody is staring at.
 */
import { create } from "zustand";
import { supabase } from "@/lib/supabase";

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
 * "answered the same working day", 16h means "by the end of the next one",
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

/** The old localStorage key. Still read once, to migrate. Never written now. */
const LEGACY_KEY = "madeea-sla-settings";
/** Demo mode has no server, so it keeps using a browser key of its own. */
const DEMO_KEY = "madeea-demo-sla";

type Row = {
  workspace_id: string;
  ok_hours: number;
  risk_hours: number;
  business_hours_only: boolean;
  start_hour: number;
  end_hour: number;
  days: number[];
};

const fromRow = (r: Row): SlaConfig => ({
  okHours: r.ok_hours,
  riskHours: r.risk_hours,
  businessHoursOnly: r.business_hours_only,
  startHour: r.start_hour,
  endHour: r.end_hour,
  days: r.days,
});

const toRow = (c: SlaConfig) => ({
  ok_hours: c.okHours,
  risk_hours: c.riskHours,
  business_hours_only: c.businessHoursOnly,
  start_hour: c.startHour,
  end_hour: c.endHour,
  days: c.days,
});

const readLocal = (key: string): Partial<SlaConfig> | null => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

interface SlaState {
  config: SlaConfig;
  /** The row's own key, captured on hydrate so writes target it explicitly. */
  workspaceId: string | null;
  /** False until hydrate() has heard back. Settings uses it to avoid a flash of defaults. */
  loaded: boolean;
  /** True when the config is this browser's, not the workspace's. Demo mode, or a failed read. */
  local: boolean;
  hydrate: () => Promise<void>;
  update: (patch: Partial<SlaConfig>) => void;
  reset: () => void;
}

export const useSlaSettings = create<SlaState>((set, get) => ({
  config: { ...DEFAULT_SLA, ...(readLocal(DEMO_KEY) ?? readLocal(LEGACY_KEY) ?? {}) },
  workspaceId: null,
  loaded: false,
  local: !supabase,

  hydrate: async () => {
    if (!supabase) { set({ loaded: true, local: true }); return; }
    const { data, error } = await supabase
      .from("sla_settings")
      .select("workspace_id,ok_hours,risk_hours,business_hours_only,start_hour,end_hour,days")
      .maybeSingle();

    // Migration not applied yet, or no row. Keep showing defaults and say the
    // config is local, so Settings can be honest about it rather than letting
    // an admin edit a value that goes nowhere.
    if (error || !data) { set({ loaded: true, local: true }); return; }

    /* One-time import of whatever this browser had before 0036. Only when the
       server row is still factory-fresh, so the first person to open the app
       does not overwrite thresholds an admin has since set deliberately. */
    const legacy = readLocal(LEGACY_KEY);
    const serverIsDefault =
      data.ok_hours === DEFAULT_SLA.okHours && data.risk_hours === DEFAULT_SLA.riskHours;
    if (legacy && serverIsDefault) {
      const merged = { ...fromRow(data as Row), ...legacy };
      set({ config: merged, workspaceId: data.workspace_id, loaded: true, local: false });
      void supabase.from("sla_settings").update(toRow(merged)).eq("workspace_id", data.workspace_id);
      try { localStorage.removeItem(LEGACY_KEY); } catch { /* private mode */ }
      return;
    }

    set({ config: fromRow(data as Row), workspaceId: data.workspace_id, loaded: true, local: false });
  },

  update: (patch) => {
    const next = { ...get().config, ...patch };
    set({ config: next });
    if (!supabase) {
      try { localStorage.setItem(DEMO_KEY, JSON.stringify(next)); } catch { /* private mode */ }
      return;
    }
    // Targeted by primary key rather than left unfiltered. RLS would confine an
    // unfiltered update to this workspace anyway, but a settings write with no
    // WHERE is one policy change away from being a very bad day.
    const id = get().workspaceId;
    if (!id) return;
    void supabase.from("sla_settings").update(toRow(next)).eq("workspace_id", id);
  },

  reset: () => get().update(DEFAULT_SLA),
}));
