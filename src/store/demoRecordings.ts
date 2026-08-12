/**
 * Recordings made while running WITHOUT Supabase (demo mode).
 *
 * Deliberately in memory, not localStorage. A recording is megabytes of video;
 * localStorage has roughly five, and writing one there would throw a quota
 * error that takes every other demo store down with it. The blob lives as an
 * object URL for the session so the flow can be exercised, and is gone on
 * reload, which is the honest behaviour for a store that has no backend.
 */
import type { Recording } from "@/types/db";

let rows: Recording[] = [];

export const loadDemoRecordings = (): Recording[] => rows;

export const addDemoRecording = (r: Recording): void => { rows = [r, ...rows]; };

export const removeDemoRecording = (id: string): void => {
  const gone = rows.find((r) => r.id === id);
  // Release the blob, or the video stays in memory for the life of the tab.
  if (gone?.local_url) URL.revokeObjectURL(gone.local_url);
  rows = rows.filter((r) => r.id !== id);
};
