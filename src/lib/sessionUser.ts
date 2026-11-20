import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

/**
 * Who is signed in, read from the session this browser already holds.
 *
 * WHY NOT supabase.auth.getUser(). getUser() is a NETWORK call to the auth
 * server, and supabase-js runs it inside the single auth lock it shares with
 * every database request (each request takes that lock to read its token).
 * The Hub asked it in 24 places, and a page opens a dozen of them at once, so
 * they queued one round-trip at a time behind each other. Any that waited more
 * than five seconds gave up and came back with no user, which the page then
 * read as "signed out" or "lowest role". That is the QA report of 20 Nov 2026:
 * EOD saying "Sign in to draft…" to a signed-in assistant, the owner briefly
 * shown as a team member, the dashboard dropping to zeros, the inbox stuck on
 * "Loading messages…" for 15 seconds, and the client portal flipping roles.
 *
 * What these callers need is the person's id or email to filter or tag rows.
 * The session already has both. The database never trusts this value anyway:
 * row-level security checks the token on every request, so reading it locally
 * grants nothing a forged value could abuse.
 *
 * Same return shape as getUser(), so call sites read `data.user` unchanged.
 */
let known: User | null | undefined;

if (supabase) {
  // Kept current from the auth events, so most calls never touch the lock.
  supabase.auth.onAuthStateChange((_event, session) => {
    known = session?.user ?? null;
  });
}

export async function getSessionUser(): Promise<{ data: { user: User | null } }> {
  if (!supabase) return { data: { user: null } };
  if (known !== undefined) return { data: { user: known } };
  const { data } = await supabase.auth.getSession();
  known = data.session?.user ?? null;
  return { data: { user: known } };
}
