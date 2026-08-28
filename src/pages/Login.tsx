import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { AmbientBackground } from "@/components/layout/AmbientBackground";

// Invite-only per spec (internal tool, not a public SaaS): sign-in only.
// EA accounts are provisioned by an admin (Supabase dashboard now; a Team/Invite
// admin screen later). No public self-registration.
export default function Login() {
  const { signInWithPassword, requestPasswordReset } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  /* Reset lives on this screen rather than behind a route, because the person
     who needs it cannot sign in to reach a route. There was no reset at all,
     which meant a forgotten password could only be fixed by an admin editing
     the account by hand. */
  const [resetting, setResetting] = useState(false);
  const [resetNote, setResetNote] = useState("");

  async function sendReset() {
    if (!email.trim()) {
      setError("Enter your email address first, then choose Forgot password.");
      return;
    }
    setBusy(true);
    setError("");
    setResetNote("");
    try {
      await requestPasswordReset(email);
      /* Deliberately the same message whether or not the address is registered.
         Saying "no such account" would let anyone check who works here. */
      setResetNote(`If ${email.trim()} has an account, a reset link is on its way. It can take a few minutes.`);
      setResetting(false);
    } catch (err) {
      const m = err instanceof Error ? err.message : "Could not send a reset link.";
      /* The project sends through Supabase's built-in mailer, which allows only
         a couple of emails an hour across the whole workspace. That limit is
         the likeliest reason this fails, and "try again later" would leave
         someone retrying into the same wall. */
      setError(/rate|limit|too many/i.test(m)
        ? "Too many reset emails have been sent from this workspace in the last hour. Ask an admin to set your password directly, or try again later."
        : m);
    } finally {
      setBusy(false);
    }
  }

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
          {resetNote && <p className="text-xs text-emerald-300">{resetNote}</p>}
          <button className="btn-primary w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        </form>

        {resetting ? (
          <div className="mt-4 rounded-lg border border-border bg-surface-2 p-3">
            <p className="text-[12.5px] leading-relaxed text-muted">
              We will email a reset link to <span className="font-medium text-text">{email.trim() || "the address above"}</span>.
            </p>
            <div className="mt-2.5 flex gap-2">
              <button type="button" className="btn-primary px-3 py-1.5 text-xs" onClick={sendReset} disabled={busy}>
                {busy ? "Sending…" : "Send reset link"}
              </button>
              <button type="button" className="btn-ghost border border-border px-3 py-1.5 text-xs" onClick={() => setResetting(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => { setResetting(true); setError(""); setResetNote(""); }}
            className="mt-3 w-full text-center text-xs text-faint underline underline-offset-2 hover:text-text"
          >
            Forgot password?
          </button>
        )}

        <p className="mt-5 text-center text-xs text-faint">
          Access is invite-only. Need an account? Contact your MadeEA admin.
        </p>

        {/* Before the password field, not buried in Settings. This is a
            monitoring product, and the page where somebody signs into one is
            the page where they should be able to read what it records. */}
        <p className="mt-3 text-center text-xs text-faint">
          <Link to="/privacy" className="hover:text-muted hover:underline">Privacy</Link>
          <span className="mx-1.5">·</span>
          <Link to="/terms" className="hover:text-muted hover:underline">Terms</Link>
        </p>
      </div>
    </div>
  );
}
