import { supabase } from "@/lib/supabase";

/**
 * MadeEA Academy, the separate learning platform (Abder's roadmap, 16 Nov
 * 2026). Same accounts as the Hub; opening it from here signs the person in
 * without a password through the academy-sso function.
 */
export const ACADEMY_URL = ((import.meta.env.VITE_ACADEMY_URL as string | undefined) ?? "https://academy.madeea.io").replace(/\/$/, "");

/** A one-time sign-in link into the Academy for whoever is signed in here. */
export async function academySignInUrl(next?: string): Promise<string> {
  if (!supabase) return ACADEMY_URL;
  const { data, error } = await supabase.functions.invoke("academy-sso", { body: {} });
  const hash = (data as { token_hash?: string } | null)?.token_hash;
  if (error || !hash) {
    let msg = (data as { error?: string } | null)?.error ?? "Couldn't open the Academy. Try again.";
    try {
      const ctx = (error as { context?: Response } | null)?.context;
      if (ctx) msg = ((await ctx.json()) as { error?: string }).error ?? msg;
    } catch { /* keep msg */ }
    throw new Error(msg);
  }
  const p = new URLSearchParams({ t: hash });
  if (next) p.set("next", next);
  return `${ACADEMY_URL}/sso#${p.toString()}`;
}

/**
 * Open the Academy in a new tab, signed in. The tab is opened straight away
 * (inside the click) so pop-up blockers allow it, then pointed at the link.
 */
export async function openAcademy(next?: string): Promise<void> {
  const tab = window.open("about:blank", "_blank");
  try {
    const url = await academySignInUrl(next);
    if (tab) { tab.opener = null; tab.location.href = url; }
    else window.location.href = url;
  } catch (e) {
    tab?.close();
    alert(e instanceof Error ? e.message : String(e));
  }
}
