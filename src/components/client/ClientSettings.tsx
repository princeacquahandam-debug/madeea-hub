import { useState } from "react";
import { AlertTriangle, Check, LogOut, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

/**
 * The client's own account settings: their password, and the way out.
 *
 * WHY SIGN OUT MOVED HERE. It sat in the top bar, which is the most prominent
 * position on the screen, for the action a person takes least often and never
 * by accident on purpose. The agency app puts both behind the avatar in the
 * sidebar footer, and a client portal that parks "leave" where the agency app
 * parks "search" is a different product again.
 *
 * THE CURRENT PASSWORD IS REQUIRED, and not as a formality. Supabase's
 * updateUser does NOT verify the old one, so without this an unlocked laptop is
 * enough to take the account over. useAuth re-authenticates before it changes
 * anything -- the same function the staff settings page uses, so a fix there is
 * a fix here.
 */

const MIN_LEN = 8;

export function ClientSettings({ email }: { email?: string }) {
  const { updatePassword, signOut, demo } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);

  const tooShort = next.length > 0 && next.length < MIN_LEN;
  const mismatch = confirm.length > 0 && next !== confirm;
  const reused = next.length > 0 && next === current;
  const canSubmit =
    !demo && current.length > 0 && next.length >= MIN_LEN && next === confirm && next !== current && !saving;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError("");
    setDone(false);
    try {
      await updatePassword(current, next);
      setDone(true);
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update your password.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="card p-5">
        <h2 className="mb-3 text-[17px] font-bold">Your account</h2>
        <div className="rounded-lg bg-surface-2 p-3">
          <p className="field-label mb-0.5">Signed in as</p>
          <p className="truncate text-sm">{email ?? "-"}</p>
        </div>
        <p className="mt-3 text-sm text-muted">
          Your email address is how your assistant reaches you. Ask them if it needs
          to change.
        </p>
      </section>

      <section className="card p-5">
        <h2 className="mb-1 text-[17px] font-bold">Password</h2>
        <p className="mb-4 text-sm text-muted">
          Change the password you use to sign in. You will need your current one.
        </p>

        {demo ? (
          <p className="rounded-lg border border-border bg-surface-2 p-3 text-xs text-faint">
            Not available in the demo.
          </p>
        ) : (
          <form className="max-w-sm space-y-3" onSubmit={submit}>
            {/* Present but hidden: gives password managers the account context so
                "update saved password" works after a change. */}
            <input
              type="text"
              autoComplete="username"
              value={email ?? ""}
              readOnly
              className="hidden"
              tabIndex={-1}
              aria-hidden="true"
            />
            <div>
              <label className="field-label" htmlFor="client-pw-current">Current password</label>
              <input
                id="client-pw-current"
                className="input"
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="client-pw-next">New password</label>
              <input
                id="client-pw-next"
                className="input"
                type="password"
                autoComplete="new-password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
              />
              {tooShort && <p className="mt-1 text-xs text-faint">At least {MIN_LEN} characters.</p>}
              {reused && <p className="mt-1 text-xs text-faint">That is the password you already have.</p>}
            </div>
            <div>
              <label className="field-label" htmlFor="client-pw-confirm">Confirm new password</label>
              <input
                id="client-pw-confirm"
                className="input"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
              {mismatch && <p className="mt-1 text-xs text-faint">These two do not match.</p>}
            </div>

            {error && (
              <p className="flex items-start gap-2 text-sm text-red-400">
                <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {error}
              </p>
            )}
            {done && (
              <p className="flex items-start gap-2 text-sm" style={{ color: "var(--c-accent)" }}>
                <Check size={15} className="mt-0.5 shrink-0" /> Password updated.
              </p>
            )}

            <button type="submit" className="btn-primary" disabled={!canSubmit}>
              {saving ? <Loader2 size={15} className="animate-spin" /> : null}
              Update password
            </button>
          </form>
        )}
      </section>

      <section className="card p-5">
        <h2 className="mb-1 text-[17px] font-bold">Sign out</h2>
        <p className="mb-4 text-sm text-muted">
          Ends this session on this device. Your account and everything on it stay
          exactly as they are.
        </p>
        <button
          onClick={() => void signOut()}
          className="btn-ghost border border-border"
        >
          <LogOut size={15} /> Sign out
        </button>
      </section>
    </div>
  );
}
