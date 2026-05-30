import { useState } from "react";
import { Sparkles } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

// Invite-only per spec (internal tool, not a public SaaS): sign-in only.
// EA accounts are provisioned by an admin (Supabase dashboard now; a Team/Invite
// admin screen later). No public self-registration.
export default function Login() {
  const { signInWithPassword, signInWithGoogle } = useAuth();
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
    <div className="flex min-h-screen items-center justify-center bg-bg p-4">
      <div className="card w-full max-w-sm p-7">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-accent/20 text-accent-soft">
            <Sparkles size={22} />
          </div>
          <h1 className="display text-3xl">MadeEA</h1>
          <p className="eyebrow mt-1 text-accent/80">Command Center</p>
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

        <div className="my-4 flex items-center gap-3 text-xs text-faint">
          <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
        </div>

        <button className="btn-ghost w-full border border-border" onClick={() => signInWithGoogle()}>
          Continue with Google
        </button>

        <p className="mt-5 text-center text-xs text-faint">
          Access is invite-only. Need an account? Contact your MadeEA admin.
        </p>
      </div>
    </div>
  );
}
