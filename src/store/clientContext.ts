import { create } from "zustand";

/**
 * Which client you are currently working on, borrowed from GoHighLevel's
 * sub-account switcher.
 *
 * WHAT IS AND IS NOT BEING COPIED. In GHL a sub-account is a separate CRM: its
 * own contacts, calendars and pipelines, isolated from every other. MadeEA OS is
 * not built that way and should not be. There is one workspace, and the client
 * is a dimension of the data inside it, because an EA's day genuinely spans
 * clients: one EOD report covers all of them, and internal work (recruiting,
 * training) belongs to none.
 *
 * So what is copied is the INTERFACE, not the architecture: a persistent "who
 * am I working on" context at the top of the sidebar, with an All view to step
 * back out. Building real tenant isolation to match GHL would mean an EA could
 * no longer see their own week, which is the opposite of useful.
 *
 * WHY THIS IS A FILTER AND NEVER A PERMISSION. The list an EA can choose from is
 * already restricted, by lead_ea_id, in useMyClients. This store only narrows
 * what is displayed. Nothing here is allowed to be the thing that keeps one EA
 * out of another's data: that is RLS's job, and a filter that looks like a
 * permission is how leaks get shipped.
 *
 * Persisted, because GHL persists it and the expectation it creates is that you
 * come back tomorrow still working on the same client. The id is validated
 * against the clients you can actually see before it is trusted, so a stale id
 * (client removed, reassigned to another EA) falls back to All rather than
 * silently filtering everything to nothing.
 */

const KEY = "madeea-client-context";

function initial(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(KEY) || null;
}

interface ClientContextState {
  /** Client id, or null for "All clients". */
  clientId: string | null;
  setClient: (id: string | null) => void;
}

export const useClientContext = create<ClientContextState>((set) => ({
  clientId: initial(),
  setClient: (id) => {
    if (typeof window !== "undefined") {
      if (id) window.localStorage.setItem(KEY, id);
      else window.localStorage.removeItem(KEY);
    }
    set({ clientId: id });
  },
}));
