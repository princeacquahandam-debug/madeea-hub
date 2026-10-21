/**
 * The time zone the Hub shows YOUR times in (Reich's testing, 20 Oct 2026).
 *
 * "The selected time zone should synchronize across emails, replies, task
 * deadlines, and calendar appointments." So there is one answer to "which
 * zone?", held here, and every screen that formats a time asks it instead of
 * letting the browser decide.
 *
 * WHAT IT IS NOT. Date is not patched. An instant is an instant; only the
 * FORMATTING takes a zone. Code that wants your zone passes `{ timeZone }` from
 * here (or uses fmtTime / fmtDate / fmtDateTime). Code that does day maths in a
 * zone uses lib/calendarTime with this zone. Anything that still calls
 * toLocaleTimeString() with no zone keeps showing the computer's time.
 *
 * Effective zone = profiles.timezone (migration 0092) ?? the computer's zone.
 * Cached in localStorage so the first paint after a reload is already right,
 * and so demo mode (supabase === null) works with no server at all.
 */
import { useEffect } from "react";
import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import { myTimeZone } from "@/lib/timezones";

const CACHE_KEY = "madeea-timezone";

/** True for a zone this browser can format in. Anything else falls back. */
export function isValidZone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}

function readCache(): string | null {
  try {
    const v = localStorage.getItem(CACHE_KEY);
    return isValidZone(v) ? v : null;
  } catch { return null; }
}
function writeCache(tz: string | null) {
  try {
    if (tz) localStorage.setItem(CACHE_KEY, tz);
    else localStorage.removeItem(CACHE_KEY);
  } catch { /* private window: the server copy still holds */ }
}

interface TzState {
  /** What you chose. Null = "use my computer's". */
  chosen: string | null;
  /** The computer's own zone, re-read on focus (laptops travel). */
  device: string;
  /** chosen ?? device. What every formatter uses. */
  zone: string;
  /** Loaded from the profile at least once this session. */
  hydrated: boolean;
  hydrate: (userId: string | null) => Promise<void>;
  /** Save the choice. Resolves to an error message, or null on success. */
  setChosen: (tz: string | null) => Promise<string | null>;
  refreshDevice: () => void;
}

const initialChosen = readCache();
const initialDevice = myTimeZone();

export const useUserTimeZone = create<TzState>((set, get) => ({
  chosen: initialChosen,
  device: initialDevice,
  zone: initialChosen ?? initialDevice,
  hydrated: false,

  hydrate: async (userId) => {
    if (!supabase || !userId) {
      const c = readCache();
      set({ chosen: c, zone: c ?? get().device, hydrated: true });
      return;
    }
    try {
      const { data, error } = await supabase
        .from("profiles").select("timezone").eq("id", userId).maybeSingle();
      /* Before 0092 is applied the column does not exist. Keep whatever this
         browser remembered rather than wiping it. */
      if (error) { set({ hydrated: true }); return; }
      const raw = (data as { timezone?: string | null } | null)?.timezone ?? null;
      const c = isValidZone(raw) ? raw : null;
      writeCache(c);
      set({ chosen: c, zone: c ?? get().device, hydrated: true });
    } catch {
      set({ hydrated: true });
    }
  },

  setChosen: async (tz) => {
    const next = tz && isValidZone(tz) ? tz : null;
    if (tz && !next) return `"${tz}" is not a time zone this browser recognises.`;
    const prev = get().chosen;
    set({ chosen: next, zone: next ?? get().device });
    writeCache(next);
    if (!supabase) return null;
    try {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) return "Saved on this device only: you are not signed in.";
      const { error } = await supabase.from("profiles").update({ timezone: next }).eq("id", uid);
      if (error) {
        /* Column missing (0092 not applied) still works on this device. A
           rejected zone is put back so the screen never claims a save that
           did not happen. */
        if (/timezone/i.test(error.message) && /column|schema/i.test(error.message)) {
          return "Saved on this device only. Your account will remember it once the database is updated.";
        }
        set({ chosen: prev, zone: prev ?? get().device });
        writeCache(prev);
        return error.message;
      }
      return null;
    } catch (e) {
      set({ chosen: prev, zone: prev ?? get().device });
      writeCache(prev);
      return (e as Error).message || "Could not save your time zone.";
    }
  },

  refreshDevice: () => {
    const d = myTimeZone();
    if (d !== get().device) set({ device: d, zone: get().chosen ?? d });
  },
}));

/** The effective zone, reactive. */
export const useTimeZone = () => useUserTimeZone((s) => s.zone);

/** The effective zone, outside React. */
export const currentZone = () => useUserTimeZone.getState().zone;

/**
 * Mount once behind the login gate (AppShell). Loads your saved zone, and
 * notices when the computer's own zone changes after a flight.
 */
export function useUserTimeZoneSync(userId: string | null | undefined) {
  const hydrate = useUserTimeZone((s) => s.hydrate);
  const refreshDevice = useUserTimeZone((s) => s.refreshDevice);
  useEffect(() => { void hydrate(userId ?? null); }, [hydrate, userId]);
  useEffect(() => {
    window.addEventListener("focus", refreshDevice);
    return () => window.removeEventListener("focus", refreshDevice);
  }, [refreshDevice]);
}

/** "Manila", "New York". For sentences, not pickers. */
export const zoneCity = (tz: string) => tz.split("/").pop()?.replace(/_/g, " ") ?? tz;

/* Formatters. Always 12-hour, always in the effective zone unless told
   otherwise, so the same meeting never reads 15:00 here and 3:00 PM there. */
type When = string | number | Date;
const asDate = (w: When) => (w instanceof Date ? w : new Date(w));

/** "9:30 AM" */
export function fmtTime(iso: When, tz = currentZone()): string {
  const d = asDate(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }).format(d);
}

/** "Wed, 22 Oct" by default; any Intl options, always in the effective zone. */
export function fmtDate(
  iso: When,
  opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" },
  tz = currentZone(),
): string {
  const d = asDate(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { ...opts, timeZone: tz }).format(d);
}

/** "Wed, 22 Oct, 9:30 AM" */
export function fmtDateTime(iso: When, tz = currentZone()): string {
  const d = asDate(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${fmtDate(d, undefined, tz)}, ${fmtTime(d, tz)}`;
}
