import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { AmbientBackground } from "@/components/layout/AmbientBackground";

/**
 * Set a new password after following a reset link.
 *
 * WHY THIS CANNOT BE AN ORDINARY ROUTE. A Supabase recovery link creates a real
 * session. The app's gate is `if (!user) return <Login />`, so the moment the
 * link is exchanged the person is signed in and the dashboard renders. They
 * would land on their own workspace having changed nothing, and the password
 * they could not remember would still be the password on the account.
 *
 * So this is shown on the `recovering` flag, above the router, in the same
 * position Login occupies. The one screen, until the password is actually set.
 */
export default function ResetPassword() {
  const { completePasswordReset, signOut, user } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  /* Supabase enforces a minimum server side and returns an error. Checking here
     as well means the person is told before submitting rather than after. */
  const tooShort = password.length > 0 && password.length < 8;
  const mismatch = confirm.length > 0 && password !== confirm;
  const ready = password.length >= 8 && password === confirm && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError("");
    try {
      await completePasswordReset(password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not set your password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative z-10 flex min-h-screen items-center justify-center p-4">
      <AmbientBackground />
      <div className="card w-full max-w-sm p-7 shadow-2xl">
        <div className="mb-5 text-center">
          <img src="/logo-light.png" alt="MadeEA" className="mx-auto mb-3 h-9 w-auto [[data-theme=light]_&]:hidden" />
          <img src="/logo-dark.png" alt="MadeEA" className="mx-auto mb-3 hidden h-9 w-auto [[data-theme=light]_&]:block" />
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-accent">Set a new password</p>
        </div>

        {/* Whose account this is about to change. A reset link opened in the
            wrong browser profile would otherwise silently change somebody
            else's password. */}
        {user?.email && (
          <p className="mb-4 rounded-lg bg-surface-2 p-2.5 text-center text-[12.5px] text-muted">
            for <span className="font-medium text-text">{user.email}</span>
          </p>
        )}

        <form className="space-y-3" onSubmit={submit}>
          <div>
            <label className="field-label" htmlFor="new-password">New password</label>
            <input
              id="new-password" className="input" type="password" autoComplete="new-password"
              value={password} onChange={(e) => setPassword(e.target.value)} required
            />
            <p className="mt-1 text-[11.5px] text-faint">At least 8 characters.</p>
          </div>

          <div>
            <label className="field-label" htmlFor="confirm-password">Confirm password</label>
            <input
              id="confirm-password" className="input" type="password" autoComplete="new-password"
              value={confirm} onChange={(e) => setConfirm(e.target.value)} required
            />
          </div>

          {tooShort && <p className="text-[12.5px] text-amber-300">That is under 8 characters.</p>}
          {mismatch && <p className="text-[12.5px] text-amber-300">The two passwords do not match.</p>}
          {error && <p className="text-[12.5px] text-red-300">{error}</p>}

          <button className="btn-primary w-full justify-center py-2.5" disabled={!ready}>
            {busy ? "Saving…" : "Save password"}
          </button>
        </form>

        {/* A way out that does not leave them stuck on this screen holding a
            recovery session they cannot use. */}
        <button
          onClick={() => void signOut()}
          className="mt-4 w-full text-center text-[12px] text-faint underline underline-offset-2 hover:text-text"
        >
          Cancel and sign out
        </button>
      </div>
    </div>
  );
}
