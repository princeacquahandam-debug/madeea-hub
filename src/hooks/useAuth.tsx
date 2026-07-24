import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
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
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

const DEMO_USER: SessionUser = { email: "sarah@madeea.com", name: USER.name, initials: USER.initials };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  // AuthProvider sits inside QueryClientProvider (see App.tsx), so the cache is
  // reachable here — it has to be dropped when the identity changes.
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      // Demo mode: auto sign-in as the seeded persona.
      setUser(DEMO_USER);
      setLoading(false);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setUser(toUser(data.session?.user));
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      // Drop every cached query when the identity changes. Without this, one
      // person's data (and their cached role — useMyRole has a 15s staleTime)
      // is served to the next user in the same tab: sign out as an admin, sign
      // in as an EA, and the Admin panel briefly renders for them.
      if (event === "SIGNED_IN" || event === "SIGNED_OUT") queryClient.clear();
      setUser(toUser(session?.user));
    });
    return () => sub.subscription.unsubscribe();
    // queryClient is stable for the app's lifetime; this must run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value: AuthState = {
    user,
    loading,
    demo: !isSupabaseConfigured,
    async signInWithPassword(email, password) {
      if (!supabase) return;
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    },
    async signOut() {
      if (supabase) await supabase.auth.signOut();
      // Revoking server access is only half of it — the browser still holds
      // transcripts, prep packets and cached rows. Clear both, and do it even if
      // signOut() above threw, so a failed network call can't leave data behind.
      clearLocalWorkspaceData();
      queryClient.clear();
      setUser(null);
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function toUser(u: { email?: string } | undefined | null): SessionUser | null {
  if (!u?.email) return null;
  const name = u.email.split("@")[0];
  return { email: u.email, name, initials: name.slice(0, 2).toUpperCase() };
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
