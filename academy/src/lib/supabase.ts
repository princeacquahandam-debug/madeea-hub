import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !anon) {
  throw new Error("VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required (same values as the Hub).");
}

// Same Supabase project as the Hub, so the same accounts work. The session is
// the Academy's own (its own storage key); see supabase/functions/academy-sso
// for why the Hub's tokens are never reused here.
export const supabase = createClient(url, anon, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: "madeea-academy-auth", detectSessionInUrl: false },
});

export const HUB_URL = ((import.meta.env.VITE_HUB_URL as string | undefined) ?? "https://hub.madeea.io").replace(/\/$/, "");

/** Public URL of a file in the academy-media bucket. */
export function mediaUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return supabase.storage.from("academy-media").getPublicUrl(path).data.publicUrl;
}

/** Upload a file into this workspace's folder; returns the storage path. */
export async function uploadMedia(workspaceId: string, file: File | Blob, kind: string, ext?: string): Promise<string> {
  const name = file instanceof File ? file.name : "";
  const e = (ext ?? name.split(".").pop() ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 6) || "bin";
  const path = `${workspaceId}/${kind}/${crypto.randomUUID()}.${e}`;
  const { error } = await supabase.storage.from("academy-media").upload(path, file, {
    upsert: false,
    contentType: file.type || undefined,
  });
  if (error) throw new Error(error.message.includes("exceeded") ? "That file is too big (50 MB at most). For long videos, paste a YouTube, Vimeo or Loom link instead." : error.message);
  return path;
}

/** Friendlier text for database errors raised by the Academy functions. */
export function errText(e: unknown): string {
  const m = e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : String(e);
  if (/row-level security|not allowed|permission/i.test(m)) return "You don't have access to do that.";
  return m;
}
