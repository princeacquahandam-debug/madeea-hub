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
  /** When it was asked (ISO). Shown under the answer. Older turns have none. */
  at?: string;
}

/** One saved conversation (12 Oct 2026, UI review deck slide 11: chat history). */
export interface MadelineChat {
  id: string;
  /** Auto-named from the first question; renamable. */
  title: string;
  turns: MadelineTurn[];
  updatedAt: string;
}

/** Which view the panel shows: the conversation, or the list of chats. */
export type MadelineView = "chat" | "history";

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
  /** Start a new chat. The current one stays in history. */
  clearTurns: () => void;

  /** Every saved chat, newest first. The open one is `currentChatId`. */
  chats: MadelineChat[];
  currentChatId: string;
  setChats: (chats: MadelineChat[], openId?: string) => void;
  openChat: (id: string) => void;
  renameChat: (id: string, title: string) => void;
  deleteChat: (id: string) => void;
  view: MadelineView;
  setView: (v: MadelineView) => void;
}

const THREAD_KEY = "madeea-madeline-thread";
const CHATS_KEY = "madeea-madeline-chats";
const MAX_TURNS = 30;
/** Kept per person; the oldest fall off. */
export const MAX_CHATS = 50;

const newId = () => (globalThis.crypto?.randomUUID?.() ?? `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);

/** "What's overdue this week?" → a chat title. */
export function titleFor(turns: MadelineTurn[]): string {
  const first = turns.find((t) => t.prompt.trim())?.prompt.trim().replace(/\s+/g, " ") ?? "New chat";
  return first.length > 60 ? `${first.slice(0, 59)}…` : first;
}

/* Madeline is a floating panel now (deck slide 10), over the page rather than
   docked beside it, so it always starts closed. */
function initialOpen(): boolean {
  return false;
}

function initialChats(): MadelineChat[] {
  try {
    const raw = window.sessionStorage.getItem(CHATS_KEY);
    return raw ? (JSON.parse(raw) as MadelineChat[]) : [];
  } catch {
    return [];
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

export const useMadeline = create<MadelineState>((set, get) => ({
  routePath: "/",
  open: initialOpen(),
  setOpen: (v) => set({ open: v, ...(v ? {} : { view: "chat" as MadelineView }) }),
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
  addTurn: (t) => set({ turns: [...get().turns, { at: new Date().toISOString(), ...t }].slice(-MAX_TURNS) }),
  patchTurn: (id, patch) => set({ turns: get().turns.map((t) => (t.id === id ? { ...t, ...patch } : t)) }),
  clearTurns: () => set({ turns: [], currentChatId: newId(), view: "chat" }),
  setTurns: (turns) => set({ turns: turns.slice(-MAX_TURNS) }),

  chats: initialChats(),
  currentChatId: newId(),
  setChats: (chats, openId) => {
    const sorted = [...chats].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, MAX_CHATS);
    const open = openId ? sorted.find((c) => c.id === openId) : undefined;
    set(open ? { chats: sorted, currentChatId: open.id, turns: open.turns.slice(-MAX_TURNS) } : { chats: sorted });
  },
  openChat: (id) => {
    const c = get().chats.find((x) => x.id === id);
    if (c) set({ currentChatId: c.id, turns: c.turns.slice(-MAX_TURNS), view: "chat" });
  },
  renameChat: (id, title) => set({ chats: get().chats.map((c) => (c.id === id ? { ...c, title: title.trim() || c.title } : c)) }),
  deleteChat: (id) => {
    const chats = get().chats.filter((c) => c.id !== id);
    if (id === get().currentChatId) set({ chats, turns: [], currentChatId: newId() });
    else set({ chats });
  },
  view: "chat",
  setView: (v) => set({ view: v }),
}));

/* The open chat is mirrored into `chats` whenever it changes, titled from its
   first question. An empty chat isn't saved. */
useMadeline.subscribe((s, prev) => {
  if (s.turns === prev.turns) return;
  try { window.sessionStorage.setItem(THREAD_KEY, JSON.stringify(s.turns)); } catch { /* storage blocked */ }
  if (!s.turns.length) return;
  const existing = s.chats.find((c) => c.id === s.currentChatId);
  const chat: MadelineChat = {
    id: s.currentChatId,
    title: existing && existing.title !== titleFor(prev.turns) ? existing.title : titleFor(s.turns),
    turns: s.turns,
    updatedAt: new Date().toISOString(),
  };
  const chats = [chat, ...s.chats.filter((c) => c.id !== chat.id)].slice(0, MAX_CHATS);
  useMadeline.setState({ chats });
});
useMadeline.subscribe((s, prev) => {
  if (s.chats === prev.chats) return;
  try { window.sessionStorage.setItem(CHATS_KEY, JSON.stringify(s.chats)); } catch { /* storage blocked */ }
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
