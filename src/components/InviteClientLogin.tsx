import { useState } from "react";
import { AlertTriangle, Check, KeyRound, Loader2 } from "lucide-react";
import { Modal } from "@/components/ui";
import { CredentialsHandover, StartingPassword } from "@/components/StartingPassword";
import { MIN_PASSWORD, suggestPassword } from "@/lib/password";
import { atLeast, useInviteClientLogin, useMyRole } from "@/data/hooks";

/**
 * Giving one client a login to their own portal.
 *
 * WHY THIS EXISTS AT ALL. The invite-client Edge Function was written, correct
 * and complete, and nothing called it. So every client login had to be made by
 * hand: invite the address in the Supabase dashboard, then run SQL to write the
 * client_users row, in that order and only that order. It took five attempts to
 * do once, and the people who will actually onboard clients do not have the SQL
 * editor. This is the button that was missing.
 *
 * THE ORDER IS THE WHOLE POINT. 0070's fallback reads a confirmed account with
 * no client_users row as staff somebody forgot to invite, and grants it an
 * employee seat in the agency workspace. The function writes the account and
 * the row in one request, so the window where that can happen does not exist.
 * Doing it in two steps from here would reintroduce exactly the bug the
 * function was written to prevent.
 *
 * NOW IT SETS THEIR PASSWORD TOO. This used to send an invite email, and the
 * client who clicked it was signed in without ever choosing a password -- which
 * their own settings page then asked them for, because changing a password
 * requires the current one. Their account could not be changed by them at all,
 * and the only way round it, a recovery email, is capped by a project-wide rate
 * limit that onboarding hits in an afternoon. So the admin sets the first
 * password here and hands it over with the address.
 *
 * TWO MODES, AND THE SECOND ONE IS NOT DECORATION. Every client invited before
 * this change is holding one of those unchangeable accounts. "Set a password"
 * is how they get out of it, and it is a mode you have to choose rather than a
 * side effect of retyping an address, so nobody overwrites a working password
 * by re-inviting somebody.
 */
export function InviteClientLogin({
  clientId,
  clientName,
  hasLogin,
}: {
  clientId: string;
  clientName: string;
  /** Already has one. Shown as state rather than hidden, so the absence of a
      login is legible instead of looking like a missing feature. */
  hasLogin: boolean;
}) {
  const { data: role } = useMyRole();
  const invite = useInviteClientLogin();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"invite" | "reset">("invite");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState(suggestPassword());
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  /* The pair that actually worked, kept apart from the form so that clearing
     the form cannot take the only copy of the password with it. */
  const [sent, setSent] = useState<{ email: string; password: string } | null>(null);

  // Admins and owners. The function checks the same thing against the database;
  // this is so the control is not offered to somebody it would refuse.
  if (!atLeast(role, "admin")) return null;

  function start() {
    setOpen(true);
    setMode("invite");
    setError("");
    setDone("");
    setSent(null);
    /* A fresh suggestion per opening. The same password on two clients is one
       leak away from being two. */
    setPassword(suggestPassword());
  }

  async function send() {
    const addr = email.trim();
    if (!addr || password.length < MIN_PASSWORD || invite.isPending) return;
    setError("");
    setDone("");
    setSent(null);
    try {
      const r = await invite.mutateAsync({ email: addr, password, client_id: clientId, mode });
      setDone(
        r.reset
          ? `New password set for ${addr}. Tell them what it is.`
          : r.linked
            ? `${addr} already had an account. It is connected to ${clientName} now, with this password.`
            : `${addr} can sign in to ${clientName} now.`,
      );
      setSent({ email: addr, password });
      setEmail("");
    } catch (e) {
      const err = e as Error & { missing?: boolean };
      setError(
        err.missing
          ? "The invite-client function is not deployed yet. Run: npm run deploy:functions invite-client"
          : err.message,
      );
    }
  }

  return (
    <>
      {/* Two states, and the one that matters is "no login yet". A bare icon
          read as decoration and sat unnoticed; a client with no way in is the
          thing this page should be shouting about, so that state gets words. */}
      <button
        className={
          hasLogin
            ? "pill bg-accent/15 text-accent-soft whitespace-nowrap"
            : "pill border border-accent/40 text-accent whitespace-nowrap hover:bg-accent/10"
        }
        onClick={start}
        title={hasLogin ? `${clientName} has a portal login` : `Give ${clientName} a portal login`}
        aria-label={hasLogin ? `Manage portal access for ${clientName}` : `Invite ${clientName} to the portal`}
      >
        {hasLogin ? <Check size={11} /> : <KeyRound size={11} />}
        {hasLogin ? "Portal" : "Give access"}
      </button>

      <Modal open={open} onClose={() => setOpen(false)}>
        {/* No padding wrapper: Modal already applies p-6, and the second one
            narrowed the content until the buttons wrapped mid-word. pr-10 keeps
            the heading clear of the close button Modal draws at top-right. */}
        <div>
          <h2 className="pr-10 text-lg font-semibold">Portal access for {clientName}</h2>
          <p className="mt-1 text-sm text-muted">
            They get their own sign-in, showing what their assistant has done, the
            calendar on their account, shared notes, and the two message channels.
            They never see the agency app.
          </p>

          <div className="mt-4 flex gap-2">
            {([
              ["invite", "Give access"],
              ["reset", "Set a password"],
            ] as const).map(([k, label]) => (
              <button
                key={k}
                onClick={() => { setMode(k); setError(""); setDone(""); setSent(null); }}
                className={
                  mode === k
                    ? "flex-1 rounded-lg border border-accent bg-accent/15 p-2 text-sm"
                    : "flex-1 rounded-lg border border-border bg-surface-2 p-2 text-sm hover:border-accent/50"
                }
              >
                {label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-faint">
            {mode === "invite"
              ? "Creates their login. Nothing is emailed, so give them the address and password yourself."
              : "For a client who already has a login and cannot get in. Changes their password and nothing else."}
          </p>

          {hasLogin && mode === "invite" ? (
            <p className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-sm text-muted">
              Someone already holds a login for this client. Adding another address here
              gives a second person full access to the account.
            </p>
          ) : null}

          <label className="mt-4 block text-xs uppercase tracking-wider text-faint">Their email</label>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void send(); } }}
            placeholder="name@theircompany.com"
            className="input mt-1 w-full"
            autoFocus
          />

          <div className="mt-3">
            <StartingPassword
              id="client-login-password"
              value={password}
              onChange={setPassword}
              label={mode === "reset" ? "New password" : "Starting password"}
              hint={
                mode === "reset"
                  ? "Their old password stops working the moment you save this."
                  : "You pass this on yourself. They can change it in their own settings."
              }
            />
          </div>

          {error ? (
            <p className="mt-3 flex items-start gap-2 text-sm text-red-400">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {error}
            </p>
          ) : null}
          {done ? (
            <div className="mt-3 space-y-2">
              <p className="flex items-start gap-2 text-sm" style={{ color: "var(--c-accent)" }}>
                <Check size={15} className="mt-0.5 shrink-0" /> {done}
              </p>
              {sent ? <CredentialsHandover email={sent.email} password={sent.password} /> : null}
            </div>
          ) : null}

          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button className="btn-ghost whitespace-nowrap border border-border" onClick={() => setOpen(false)}>
              Close
            </button>
            <button
              className="btn-primary whitespace-nowrap"
              onClick={() => void send()}
              disabled={!email.trim() || password.length < MIN_PASSWORD || invite.isPending}
            >
              {invite.isPending ? <Loader2 size={15} className="animate-spin" /> : <KeyRound size={15} />}
              {mode === "reset" ? "Set password" : "Create login"}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
