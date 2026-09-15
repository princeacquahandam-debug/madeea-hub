import { useState } from "react";
import { AlertTriangle, Check, KeyRound, Loader2 } from "lucide-react";
import { Modal } from "@/components/ui";
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
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  // Admins and owners. The function checks the same thing against the database;
  // this is so the control is not offered to somebody it would refuse.
  if (!atLeast(role, "admin")) return null;

  async function send() {
    const addr = email.trim();
    if (!addr || invite.isPending) return;
    setError("");
    setDone("");
    try {
      const r = await invite.mutateAsync({ email: addr, client_id: clientId });
      setDone(
        r.linked
          ? `${addr} already had an account and now has access. No email was sent.`
          : `Invitation sent to ${addr}.`,
      );
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
      <button
        className="text-faint hover:text-accent"
        onClick={() => { setOpen(true); setError(""); setDone(""); }}
        title={hasLogin ? `${clientName} has a portal login` : `Give ${clientName} a portal login`}
        aria-label={hasLogin ? `Manage portal access for ${clientName}` : `Invite ${clientName} to the portal`}
      >
        {hasLogin ? <Check size={14} /> : <KeyRound size={14} />}
      </button>

      <Modal open={open} onClose={() => setOpen(false)}>
        <div className="p-5">
          <h2 className="text-lg font-semibold">Portal access for {clientName}</h2>
          <p className="mt-1 text-sm text-muted">
            They get their own sign-in, showing what their assistant has done, the
            calendar on their account, shared notes, and the two message channels.
            They never see the agency app.
          </p>

          {hasLogin ? (
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

          {error ? (
            <p className="mt-3 flex items-start gap-2 text-sm text-red-400">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {error}
            </p>
          ) : null}
          {done ? (
            <p className="mt-3 flex items-start gap-2 text-sm" style={{ color: "var(--c-accent)" }}>
              <Check size={15} className="mt-0.5 shrink-0" /> {done}
            </p>
          ) : null}

          <div className="mt-5 flex justify-end gap-2">
            <button className="btn-ghost border border-border" onClick={() => setOpen(false)}>Close</button>
            <button className="btn-primary" onClick={() => void send()} disabled={!email.trim() || invite.isPending}>
              {invite.isPending ? <Loader2 size={15} className="animate-spin" /> : <KeyRound size={15} />}
              Send invitation
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
