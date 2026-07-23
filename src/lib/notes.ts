/**
 * Notes — a free-text scratchpad for the desk.
 *
 * READ THIS BEFORE EXTENDING, because it sits one door down from the Memory Helper
 * and the two must not blur together:
 *
 *   Memory  — curated, kind-tagged facts that flow INTO the other helpers' prompts
 *             (see lib/memory.ts). Recorded once, surfaced everywhere.
 *   Notes   — this. A shared pad. Nothing but a human ever reads a note. No recall,
 *             no wiring, no AI. That restraint is the feature: it's the place to put
 *             something before you know what it is, without it leaking into a draft.
 *
 * Pure and network-free. The store lives in the DB (migration 0019); this file only
 * decides what matches a search.
 */
import type { Client } from "@/types/db";
import { tokenise } from "@/lib/memory";

export interface Note {
  id: string;
  /** Optional link to a client. Null = a general note. */
  client_id: string | null;
  title: string;
  body: string;
  pinned: boolean;
  created_at?: string | null;
  updated_at?: string | null;
}

/** Free-text search over a note's title and body. Substring OR token overlap. */
export function searchNotes(notes: Note[], query: string): Note[] {
  const q = query.trim().toLowerCase();
  if (!q) return notes;
  const tokens = new Set(tokenise(q));
  return notes.filter((n) => {
    if (n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q)) return true;
    const hay = new Set(tokenise(`${n.title} ${n.body}`));
    return [...tokens].some((t) => hay.has(t));
  });
}

/** Pinned first, then most recently touched. A stable order the UI can rely on. */
export function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const at = a.updated_at ?? a.created_at ?? "";
    const bt = b.updated_at ?? b.created_at ?? "";
    return bt.localeCompare(at);
  });
}

export function noteClientName(clients: Client[], id: string | null): string {
  if (!id) return "General";
  return clients.find((c) => c.id === id)?.name ?? "Unknown client";
}

/** A short, human title for a note that was saved without one. */
export function noteHeading(n: Note): string {
  if (n.title.trim()) return n.title.trim();
  const firstLine = n.body.trim().split("\n")[0] ?? "";
  return firstLine.length > 60 ? `${firstLine.slice(0, 57)}…` : firstLine || "Untitled note";
}

/** Seeds the empty state, and the demo, with something concrete. */
export const NOTE_EXAMPLES = [
  "Parking code for the Harrington office is 4471 — expires end of quarter.",
  "Priya mentioned she's switching PAs in Q1 — keep handover notes tidy.",
  "Ask David about the offsite dates before booking anything.",
];
