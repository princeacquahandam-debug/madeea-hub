/**
 * Uploads and saved items while running WITHOUT Supabase (demo mode).
 *
 * Saved items go to localStorage — they are a few short rows and surviving a
 * reload is the whole point of a bookmark.
 *
 * File BLOBS stay in memory, for the same reason recordings do: localStorage
 * holds about 5MB and one PDF would blow the quota and take every other demo
 * store down with it. The file's metadata row persists so the list still looks
 * right; only the content is gone after a reload, and the UI says so rather
 * than offering a download that fails.
 */
import type { SavedItem, WorkspaceFile } from "@/types/db";

const F_KEY = "madeea-demo-files";
const S_KEY = "madeea-demo-saved";

const read = <T,>(key: string): T[] => {
  try { return JSON.parse(localStorage.getItem(key) || "[]"); } catch { return []; }
};
const write = <T,>(key: string, rows: T[]) => localStorage.setItem(key, JSON.stringify(rows));

/** Object URLs for this session, keyed by file id. Never serialised. */
const blobs = new Map<string, string>();

export const loadDemoFiles = (): WorkspaceFile[] =>
  read<WorkspaceFile>(F_KEY).map((f) => ({ ...f, local_url: blobs.get(f.id) ?? null }));

export const addDemoFile = (f: WorkspaceFile, url: string): void => {
  blobs.set(f.id, url);
  write(F_KEY, [{ ...f, local_url: null }, ...read<WorkspaceFile>(F_KEY)]);
};

export const removeDemoFile = (id: string): void => {
  const url = blobs.get(id);
  if (url) { URL.revokeObjectURL(url); blobs.delete(id); }
  write(F_KEY, read<WorkspaceFile>(F_KEY).filter((f) => f.id !== id));
};

export const loadDemoSaved = (): SavedItem[] => read<SavedItem>(S_KEY);

export const addDemoSaved = (s: SavedItem): void => {
  const rows = read<SavedItem>(S_KEY);
  // Mirrors the unique(user, kind, target) constraint: saving twice is a no-op.
  if (rows.some((r) => r.kind === s.kind && r.target_id === s.target_id)) return;
  write(S_KEY, [s, ...rows]);
};

export const removeDemoSaved = (kind: string, targetId: string): void =>
  write(S_KEY, loadDemoSaved().filter((r) => !(r.kind === kind && r.target_id === targetId)));
