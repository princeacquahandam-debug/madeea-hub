import { create } from "zustand";
import type { ToolResult } from "@/lib/command-center/types";

/**
 * Madeline, the one assistant. Everything that used to be its own AI surface
 * (the Command Center modal, the docked rail, the floating bubble, the Quick
 * Actions page and the unlabelled ✨ icons) now opens this: one panel, one
 * conversation, one backend.
 *
 * This store holds only state. Sending lives in MadelineProvider
 * (hooks/useMadeline.tsx), which needs router and data hooks a store can't use.
 */

export type MadelineItemKind = "task" | "meeting" | "client" | "email";

/** What the user has open, so "this", "it" and "this meeting" mean something. */
export interface MadelineItem {
  kind: MadelineItemKind;
  id: string;
  label: string;
  /** Plain-text facts about the item, sent to the model as page context. */
  details: string;
  /** The page it was set on. It only counts there: leaving the page drops it. */
  path: string;
}

export interface MadelineTurn {
  id: string;
  prompt: string;
  /** "Task · Send board pack". What Madeline was looking at when asked. */
  about?: string;
  status: "running" | "done" | "error";
  result?: ToolResult;
  /** Set once the user confirmed a task Madeline proposed ("Turn into task"). */
  createdTaskId?: string;
  /** What the answer was built from, as counts ("4 meetings · 2 tasks"). */
  sources?: { kind: string; count: number }[];
  /** 👍 = 1, 👎 = -1. */
  rating?: 1 | -1;
}

/** Where an answer shows: the sidebar chat, or a pop-up over the page. */
export type MadelineDisplay = "panel" | "modal";

interface AskOptions {
  /** Attach this item as context (a page button knows what it's about). */
  item?: Omit<MadelineItem, "path">;
  /** Send straight away instead of leaving it in the box to edit. */
  send?: boolean;
  /** "modal" runs it now and shows the answer in a pop-up over the page,
      without opening the sidebar. Implies send. */
  display?: MadelineDisplay;
  /** The pop-up's heading ("Prep me for this meeting"). */
  title?: string;
}

/** A request a page button queued for MadelineProvider to send. */
export interface QueuedAsk { prompt: string; display: MadelineDisplay; title?: string }

/** The answer showing in the pop-up: which turn, under what heading. */
export interface MadelineInsight { turnId: string; title: string }

interface MadelineState {
  /** Replace the whole thread (loading it from another device). */
  setTurns: (turns: MadelineTurn[]) => void;
  /** The router's path (no basename), kept current by MadelineProvider.
      window.location.pathname would carry the /madeea-hub/ prefix on Pages. */
  routePath: string;
  open: boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;

  item: MadelineItem | null;
  setItem: (item: MadelineItem | null) => void;

  draft: string;
  setDraft: (v: string) => void;
  /** Bumped to ask the panel to focus its input (after a prefill). */
  focusToken: number;

  /** A request queued by a page button, for MadelineProvider to send. */
  queued: QueuedAsk | null;
  takeQueued: () => QueuedAsk | null;

  /** The one-click answer showing in the pop-up, if any. */
  insight: MadelineInsight | null;
  setInsight: (v: MadelineInsight | null) => void;
  /** Open Madeline with a request: filled into the box, or sent. */
  ask: (prompt: string, opts?: AskOptions) => void;

  turns: MadelineTurn[];
  addTurn: (t: MadelineTurn) => void;
  patchTurn: (id: string, patch: Partial<MadelineTurn>) => void;
  clearTurns: () => void;
}

const OPEN_KEY = "madeea-madeline-open";
const THREAD_KEY = "madeea-madeline-thread";
const MAX_TURNS = 30;
const XL = 1280;

/* Docked beside the page on wide screens it costs nothing, so it remembers
   being open. Below xl it slides over the page, so it always starts closed:
   reopening on every load would hide the page you came to. */
function initialOpen(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.innerWidth >= XL && window.localStorage.getItem(OPEN_KEY) !== "0";
  } catch {
    return false;
  }
}

/* sessionStorage, not localStorage: the thread survives a reload and moving
   between pages, but not closing the tab. It holds replies about clients and
   inboxes, which shouldn't sit on a shared machine indefinitely. */
function initialTurns(): MadelineTurn[] {
  try {
    const raw = window.sessionStorage.getItem(THREAD_KEY);
    const turns = raw ? (JSON.parse(raw) as MadelineTurn[]) : [];
    // A turn still "running" was cut off by the reload; its answer never came.
    return turns.map((t) =>
      t.status === "running"
        ? { ...t, status: "error", result: { kind: "error", message: "Interrupted before Madeline answered. Ask again." } }
        : t,
    );
  } catch {
    return [];
  }
}

function saveOpen(v: boolean) {
  try { window.localStorage.setItem(OPEN_KEY, v ? "1" : "0"); } catch { /* storage blocked */ }
}

export const useMadeline = create<MadelineState>((set, get) => ({
  routePath: "/",
  open: initialOpen(),
  setOpen: (v) => { saveOpen(v); set({ open: v }); },
  toggle: () => get().setOpen(!get().open),

  item: null,
  setItem: (item) => set({ item }),

  draft: "",
  setDraft: (v) => set({ draft: v }),
  focusToken: 0,

  queued: null,
  takeQueued: () => {
    const q = get().queued;
    if (q !== null) set({ queued: null });
    return q;
  },
  insight: null,
  setInsight: (v) => set({ insight: v }),
  ask: (prompt, opts = {}) => {
    if (opts.item) set({ item: { ...opts.item, path: get().routePath } });
    /* One-click actions (client review, 6 Oct): run now, answer in a pop-up
       on the page you're on. Nothing is left in the box to send by hand, and
       the sidebar stays as it was. */
    if (opts.display === "modal") {
      set({ queued: { prompt, display: "modal", title: opts.title } });
      return;
    }
    get().setOpen(true);
    if (opts.send) set({ queued: { prompt, display: "panel" } });
    else set({ draft: prompt, focusToken: get().focusToken + 1 });
  },

  turns: initialTurns(),
  addTurn: (t) => set({ turns: [...get().turns, t].slice(-MAX_TURNS) }),
  patchTurn: (id, patch) => set({ turns: get().turns.map((t) => (t.id === id ? { ...t, ...patch } : t)) }),
  clearTurns: () => set({ turns: [] }),
  setTurns: (turns) => set({ turns: turns.slice(-MAX_TURNS) }),
}));

useMadeline.subscribe((s, prev) => {
  if (s.turns === prev.turns) return;
  try { window.sessionStorage.setItem(THREAD_KEY, JSON.stringify(s.turns)); } catch { /* storage blocked */ }
});

/** The item, if it was set on the page the user is on now. */
export function currentItem(item: MadelineItem | null, pathname: string): MadelineItem | null {
  return item && item.path === pathname ? item : null;
}

export const ITEM_LABEL: Record<MadelineItemKind, string> = {
  task: "Task",
  meeting: "Meeting",
  client: "Client",
  email: "Email",
};
