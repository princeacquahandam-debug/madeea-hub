import { useState, type FormEvent } from "react";
import { GraduationCap } from "lucide-react";
import { supabase, HUB_URL } from "@/lib/supabase";

/**
 * Two ways in (Abder's phase one): the same email and password as the Hub,
 * or "Continue with MadeEA Hub", which signs in through the Hub without
 * typing anything if the Hub is already open.
 */
export default function Login({ notice }: { notice?: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setErr(error.message === "Invalid login credentials" ? "That email and password don't match. Use your MadeEA Hub sign-in." : error.message);
  };

  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="mb-3 grid h-12 w-12 place-items-center rounded-xl bg-accent-strong text-white"><GraduationCap size={24} /></span>
          <h1 className="text-2xl font-extrabold">MadeEA Academy</h1>
          <p className="mt-1 text-sm text-muted">Courses, learning paths and certificates for the MadeEA team.</p>
        </div>
        <div className="card p-5">
          {notice && <p className="mb-4 rounded-lg bg-warn/15 px-3 py-2 text-sm text-warn">{notice}</p>}
          <a className="btn-primary w-full" href={`${HUB_URL}/academy-sso`}>Continue with MadeEA Hub</a>
          <div className="my-4 flex items-center gap-3 text-xs text-faint"><span className="h-px flex-1 bg-border" />or<span className="h-px flex-1 bg-border" /></div>
          <form onSubmit={submit} className="space-y-3">
            <div>
              <label className="label" htmlFor="email">Email</label>
              <input id="email" className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="pw">Password</label>
              <input id="pw" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            {err && <p className="text-sm text-accent-soft">{err}</p>}
            <button className="btn w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
          </form>
          <p className="mt-4 text-center text-xs text-faint">Same account as MadeEA Hub. Forgot your password? Reset it on the Hub.</p>
        </div>
      </div>
    </div>
  );
}
