import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { AmbientBackground } from "@/components/layout/AmbientBackground";

// Invite-only per spec (internal tool, not a public SaaS): sign-in only.
// EA accounts are provisioned by an admin (Supabase dashboard now; a Team/Invite
// admin screen later). No public self-registration.
export default function Login() {
  const { signInWithPassword } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await signInWithPassword(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative z-10 flex min-h-screen items-center justify-center p-4">
      <AmbientBackground />
      <div className="card w-full max-w-sm p-7 shadow-2xl">
        <div className="mb-6 text-center">
          <img src="/logo-light.png" alt="MadeEA" className="mx-auto mb-3 h-9 w-auto [[data-theme=light]_&]:hidden" />
          <img src="/logo-dark.png" alt="MadeEA" className="mx-auto mb-3 hidden h-9 w-auto [[data-theme=light]_&]:block" />
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-accent">Executive OS</p>
        </div>

        <form className="space-y-3" onSubmit={submit}>
          <div>
            <label className="field-label">Email</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div>
            <label className="field-label">Password</label>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <button className="btn-primary w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        </form>

        <p className="mt-5 text-center text-xs text-faint">
          Access is invite-only. Need an account? Contact your MadeEA admin.
        </p>
      </div>
    </div>
  );
}
