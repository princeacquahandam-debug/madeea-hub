import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
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
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

const DEMO_USER: SessionUser = { email: "sarah@madeea.com", name: USER.name, initials: USER.initials };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

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
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(toUser(session?.user));
    });
    return () => sub.subscription.unsubscribe();
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
    async signInWithGoogle() {
      if (!supabase) return;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          scopes:
            "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.readonly",
          queryParams: { access_type: "offline", prompt: "consent" },
          redirectTo: window.location.origin,
        },
      });
      if (error) throw error;
    },
    async signOut() {
      if (supabase) await supabase.auth.signOut();
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
