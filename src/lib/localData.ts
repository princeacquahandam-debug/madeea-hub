/**
 * Local (browser) workspace data — and getting rid of it.
 *
 * Signing out used to clear the Supabase session and nothing else. Everything the
 * app caches in localStorage stayed behind, readable by whoever used the machine
 * next: voice-note transcripts about executives, meeting prep packets, note and
 * memory bodies written through the offline overlay, command history.
 *
 * That matters most in exactly the situation the Admin panel is built for —
 * removing an EA revokes their server access correctly, but every dossier already
 * cached in their browser stayed. On a shared office machine the next person to
 * sign in could read the previous user's transcripts.
 *
 * Every key this app writes is prefixed `madeea-`, so sweeping the prefix clears
 * present and future keys alike without touching the Supabase session key
 * (`sb-<ref>-auth-token`), which signOut() owns.
 */

const APP_PREFIX = "madeea-";

/**
 * Remove every piece of app-owned data cached in this browser.
 * Deliberately includes preferences (tour progress, saved prompts): on a shared
 * machine, over-clearing is the safe direction to be wrong in.
 */
export function clearLocalWorkspaceData(): void {
  try {
    // Collect first — removing while iterating localStorage shifts the indices.
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(APP_PREFIX)) doomed.push(key);
    }
    for (const key of doomed) localStorage.removeItem(key);
  } catch {
    // A blocked/full localStorage must never prevent sign-out from completing.
  }
}
