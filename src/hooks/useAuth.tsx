import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { clearLocalWorkspaceData } from "@/lib/localData";
import { USER } from "@/data/seed";

interface SessionUser {
  email: string;
  name: string;
  initials: string;
}

interface AuthState {
  user: SessionUser | null;
  loading: boolean;
  demo: boolean;
  signInWithPassword: (email: string, password: string) => Promise<void>;
  /** Change the signed-in user's password. Verifies the current one first. */
  updatePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  /** Email a reset link to someone who cannot get in. */
  requestPasswordReset: (email: string) => Promise<void>;
  /**
   * True while the session came from a reset link rather than a sign-in.
   * The app must show "set a new password" instead of the dashboard: a recovery
   * link DOES create a real session, so without this the person clicks the link,
   * lands on the dashboard, and the password they could not remember is still
   * the password on the account.
   */
  recovering: boolean;
  /** Set the password during recovery, then leave recovery mode. */
  completePasswordReset: (newPassword: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

const DEMO_USER: SessionUser = { email: "rio@madeea.com", name: USER.name, initials: USER.initials };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [recovering, setRecovering] = useState(false);
  // AuthProvider sits inside QueryClientProvider (see App.tsx), so the cache is
  // reachable here, it has to be dropped when the identity changes.
  const queryClient = useQueryClient();
  /**
   * Who the cached queries belong to. Compared by value on every auth event,
   * because the event NAME does not answer "has the person changed?".
   */
  const identityRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      // Demo mode: auto sign-in as the seeded persona.
      setUser(DEMO_USER);
      setLoading(false);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      const next = toUser(data.session?.user);
      identityRef.current = next?.email ?? null;
      setUser(next);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      const next = toUser(session?.user);
      /* Drop every cached query when the identity changes. Without this, one
         person's data (and their cached role. UseMyRole has a 15s staleTime)
         is served to the next user in the same tab: sign out as an admin, sign
         in as an EA, and the Admin panel briefly renders for them.

         ── KEYED ON WHO, NOT ON THE EVENT ────────────────────────────────────
         This used to fire on the SIGNED_IN event itself, and SIGNED_IN does not
         mean "somebody new signed in". Supabase re-emits it for a session it
         already holds: every time the tab is refocused, when a second tab is
         opened, and after another tab refreshes the token. So a person who
         never left had the whole query cache emptied underneath them. Every
         page dropped to its loading skeleton at once and every half-filled form
         re-rendered from scratch, which is what "it restarts by itself when I
         open a new tab" describes, and how an EOD being typed could vanish.

         The identity is what the cache is scoped to, so the identity is what
         gets compared. Signing out (email -> null) and switching accounts still
         clear it; coming back to your own tab no longer does. */
      const identity = next?.email ?? null;
      if (identity !== identityRef.current) {
        identityRef.current = identity;
        queryClient.clear();
      }
      /* Supabase fires this once, when the recovery link is exchanged. It is the
         only signal that separates "signed in" from "signed in solely to change
         the password", and the two must not look the same. */
      if (event === "PASSWORD_RECOVERY") setRecovering(true);
      if (event === "SIGNED_OUT") setRecovering(false);
      /* Keep the existing object when the person is unchanged. toUser() builds a
         fresh one every time, and a new identity here re-renders every
         useAuth() consumer in the tree on each refocus, for nothing. */
      setUser((prev) => (sameUser(prev, next) ? prev : next));
    });
    return () => sub.subscription.unsubscribe();
    // queryClient is stable for the app's lifetime; this must run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Memoised so the context value survives a re-render. An unmemoised object is
     a new value every render, which re-renders every consumer of useAuth() and
     undoes the identity check above. */
  const value = useMemo<AuthState>(() => ({
    user,
    loading,
    demo: !isSupabaseConfigured,
    async signInWithPassword(email, password) {
      if (!supabase) return;
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    },
    async updatePassword(currentPassword, newPassword) {
      if (!supabase || !user) throw new Error("Password changes aren't available in demo mode.");
      // Supabase's updateUser does NOT check the old password, so anyone at an
      // unlocked screen could silently reset it. Re-authenticate first to prove
      // the current password. This also refreshes the session token.
      const { error: reauth } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPassword,
      });
      if (reauth) throw new Error("Your current password is incorrect.");

      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw new Error(error.message || "Could not update your password.");
    },
    recovering,
    async requestPasswordReset(email) {
      if (!supabase) throw new Error("Password reset isn't available in demo mode.");
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        /* Must be inside the project's redirect allow list or Supabase refuses
           the link. The list was empty, so any redirect would have been
           rejected and the reset would have failed after the email arrived. */
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
    },
    async completePasswordReset(newPassword) {
      if (!supabase) throw new Error("Password reset isn't available in demo mode.");
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw new Error(error.message || "Could not set your password.");
      setRecovering(false);
    },
    async signOut() {
      if (supabase) await supabase.auth.signOut();
      // Revoking server access is only half of it, the browser still holds
      // transcripts, prep packets and cached rows. Clear both, and do it even if
      // signOut() above threw, so a failed network call can't leave data behind.
      clearLocalWorkspaceData();
      queryClient.clear();
      setUser(null);
    },
    /* Every piece of state the object above reads. `loading` in particular:
       leaving it out froze the context on its first value and the app sat on
       "Loading…" forever, because setLoading(false) then had nothing to update. */
  }), [user, loading, recovering, queryClient]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Two renderings of the same signed-in person, by value rather than identity. */
function sameUser(a: SessionUser | null, b: SessionUser | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.email === b.email && a.name === b.name && a.initials === b.initials;
}

/** Title-case an email local part: "rio.castillo" becomes "Rio Castillo". */
function nameFromEmail(email: string): string {
  return email
    .split("@")[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

function toUser(
  u: { email?: string; user_metadata?: { full_name?: string; name?: string } } | undefined | null,
): SessionUser | null {
  if (!u?.email) return null;
  /* The greeting used the raw email local part, so the first thing on screen
     read "rio.castillo" rather than "Rio Castillo". Prefer the name Supabase
     holds; fall back to a title-cased local part, which is right for the
     firstname.lastname addresses this workspace uses. */
  const name = u.user_metadata?.full_name?.trim() || u.user_metadata?.name?.trim() || nameFromEmail(u.email);
  const initials = name.split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
  return { email: u.email, name, initials };
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
