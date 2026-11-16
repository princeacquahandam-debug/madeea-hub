import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { Me } from "./api";

interface AuthState {
  session: Session | null;
  me: Me | null;
  loading: boolean;
  isStaff: boolean;
  isAdmin: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const loadMe = async (s: Session | null) => {
    if (!s) { setMe(null); return; }
    const { data, error } = await supabase.rpc("acad_me");
    setMe(error ? null : (data as Me));
  };

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return;
      setSession(data.session);
      await loadMe(data.session);
      if (alive) setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      // Defer: calling Supabase inside this callback can deadlock the client.
      setTimeout(() => { void loadMe(s); }, 0);
    });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, []);

  const value: AuthState = {
    session,
    me,
    loading,
    isStaff: me?.role === "trainer" || me?.role === "admin",
    isAdmin: me?.role === "admin",
    refresh: () => loadMe(session),
    signOut: async () => { await supabase.auth.signOut(); setMe(null); },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}
