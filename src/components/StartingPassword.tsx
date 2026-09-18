import { useState } from "react";
import { Check, Copy, RefreshCw } from "lucide-react";
import { MIN_PASSWORD, suggestPassword } from "@/lib/password";

/**
 * The field where one person sets another person's first password.
 *
 * Used in all three places a login is created -- an admin adding a teammate, an
 * admin giving a client their portal, a client adding somebody to their own
 * account -- because all three now hand the password over by hand instead of
 * mailing an invite link. See src/lib/password.ts for why that changed.
 *
 * DELIBERATELY NOT A PASSWORD INPUT. Everything about a `type="password"` field
 * is built for a secret only the typist may see, and this is the opposite: a
 * value whose entire job is to be read off the screen and repeated to somebody
 * else. Masking it means the person relaying it cannot check what they are
 * relaying, and the first thing they would do is retype it somewhere visible.
 * autoComplete is off for the same reason -- a password manager offering to
 * fill the inviter's OWN password here would be a quiet disaster.
 *
 * THE COPY BUTTON IS NOT A CONVENIENCE. A password that gets mistyped into the
 * chat message is a password the new person cannot use, and the failure lands
 * on them, out of sight, as "it says my password is wrong".
 */
export function StartingPassword({
  value,
  onChange,
  id,
  label = "Starting password",
  hint,
}: {
  value: string;
  onChange: (next: string) => void;
  id: string;
  label?: string;
  hint?: string;
}) {
  const [copied, setCopied] = useState(false);
  const short = value.length > 0 && value.length < MIN_PASSWORD;

  async function copy() {
    try {
      await navigator.clipboard?.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* Clipboard blocked (http, or permission refused). The value is on screen
         in plain text either way, which is why this field is not masked. */
    }
  }

  return (
    <div>
      <label className="field-label" htmlFor={id}>{label}</label>
      <div className="flex gap-2">
        <input
          id={id}
          className="input flex-1 font-mono"
          type="text"
          autoComplete="off"
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          className="btn-ghost border border-border"
          onClick={() => onChange(suggestPassword())}
          title="Suggest another password"
          aria-label="Suggest another password"
        >
          <RefreshCw size={15} />
        </button>
        <button
          type="button"
          className="btn-ghost border border-border"
          onClick={() => void copy()}
          disabled={!value}
          title="Copy the password"
          aria-label="Copy the password"
        >
          {copied ? <Check size={15} /> : <Copy size={15} />}
        </button>
      </div>
      <p className="mt-1 text-xs text-faint">
        {short
          ? `At least ${MIN_PASSWORD} characters.`
          : hint ?? "You pass this on yourself. They can change it once they are in."}
      </p>
    </div>
  );
}

/**
 * What to send them, after it worked.
 *
 * THE SUCCESS MESSAGE IS THE DELIVERY MECHANISM NOW. No email goes out, so if
 * this line does not put both halves in front of the person who just created
 * the account, the account is one nobody can get into and nobody knows it yet.
 * The password is repeated here rather than left in the form above because the
 * form is cleared on success and this is what stays on screen.
 */
export function CredentialsHandover({ email, password }: { email: string; password: string }) {
  const [copied, setCopied] = useState(false);
  const block = `Email: ${email}\nPassword: ${password}`;

  async function copy() {
    try {
      await navigator.clipboard?.writeText(block);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch { /* see the note in StartingPassword */ }
  }

  return (
    <div className="rounded-lg border border-border bg-surface-2 p-3">
      <p className="field-label mb-1">Send them these</p>
      <p className="break-all font-mono text-xs">{email}</p>
      <p className="break-all font-mono text-xs">{password}</p>
      <button type="button" className="btn-ghost mt-2 border border-border text-xs" onClick={() => void copy()}>
        {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy both"}
      </button>
    </div>
  );
}
