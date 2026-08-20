import { useState } from "react";
import { KeyRound, Lock, Unlock, Plus, Trash2, Copy, Eye, EyeOff, ShieldAlert, ExternalLink } from "lucide-react";
import { PageHeader, Modal, Badge } from "@/components/ui";
import { atLeast, useClients, useCredentialMutations, useCredentials, useMyRole, useVaultMeta } from "@/data/hooks";
import { checkVerifier, deriveKey, KEY_VERSION, makeVerifier, newSalt, open as unseal, seal } from "@/lib/vault";
import type { Credential } from "@/types/db";
import { cn } from "@/lib/utils";

/**
 * The credential vault.
 *
 * §5.4 of the audit, built to PROJECT_PLAN §5.8. The key is derived here, in
 * the browser, and never sent anywhere. The server holds ciphertext.
 *
 * The unlock key lives in component state, not localStorage or sessionStorage:
 * a vault that stays open after you close the tab is a vault with a longer
 * attack window than the person using it expects.
 */
export default function Credentials() {
  const { data: meta, isLoading: metaLoading } = useVaultMeta();
  const { data: rows = [] } = useCredentials();
  const { data: clients = [] } = useClients();
  const { data: role } = useMyRole();
  const { initVault, save, remove, logAccess } = useCredentialMutations();
  const isAdmin = atLeast(role, "admin");

  const [key, setKey] = useState<CryptoKey | null>(null);
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ label: "", url: "", username: "", secret: "", notes: "", clientId: "" });
  const [shown, setShown] = useState<Record<string, string>>({});

  const isSetUp = Boolean(meta?.salt && meta?.verifier);

  async function unlock() {
    if (!meta?.salt || !meta.verifier) return;
    setBusy(true); setErr(null);
    try {
      const k = await deriveKey(pass, meta.salt);
      // GCM authenticates, so a wrong passphrase fails here rather than showing
      // nonsense where a password should be.
      if (!(await checkVerifier(k, meta.verifier))) { setErr("That passphrase does not open this vault."); return; }
      setKey(k); setPass("");
    } finally { setBusy(false); }
  }

  async function createVault() {
    if (pass.length < 12) { setErr("Use at least 12 characters. This is the only thing protecting the logins."); return; }
    if (pass !== pass2) { setErr("The two passphrases do not match."); return; }
    setBusy(true); setErr(null);
    try {
      const salt = newSalt();
      const k = await deriveKey(pass, salt);
      await initVault.mutateAsync({ salt, verifier: await makeVerifier(k) });
      setKey(k); setPass(""); setPass2("");
    } finally { setBusy(false); }
  }

  async function addCredential() {
    if (!key || !form.label.trim() || !form.secret) return;
    const sealed = await seal(key, form.secret);
    await save.mutateAsync({
      label: form.label.trim(),
      url: form.url.trim() || null,
      username: form.username.trim() || null,
      category: null,
      notes: form.notes.trim() || null,
      secret_ciphertext: sealed.ciphertext,
      secret_nonce: sealed.nonce,
      key_version: KEY_VERSION,
      client_id: form.clientId || null,
    });
    setForm({ label: "", url: "", username: "", secret: "", notes: "", clientId: "" });
    setModal(false);
  }

  async function reveal(c: Credential) {
    if (!key) return;
    if (shown[c.id]) { setShown((s) => { const n = { ...s }; delete n[c.id]; return n; }); return; }
    const pt = await unseal(key, { ciphertext: c.secret_ciphertext, nonce: c.secret_nonce });
    if (pt === null) { setErr(`"${c.label}" was saved with a different passphrase.`); return; }
    setShown((s) => ({ ...s, [c.id]: pt }));
    logAccess.mutate({ id: c.id, action: "reveal" });
  }

  async function copy(c: Credential) {
    if (!key) return;
    const pt = shown[c.id] ?? (await unseal(key, { ciphertext: c.secret_ciphertext, nonce: c.secret_nonce }));
    if (pt === null) return;
    // Copying without rendering it, which is the safer of the two paths.
    await navigator.clipboard.writeText(pt);
    logAccess.mutate({ id: c.id, action: "copy" });
  }

  if (metaLoading) return <div><PageHeader title="Password Manager" subtitle="Loading…" /></div>;

  // ---------------------------------------------------------------- locked
  if (!key) {
    return (
      <div>
        <PageHeader title="Password Manager" subtitle="Client logins, encrypted in your browser before they are stored." />

        <div className="card mx-auto max-w-lg p-6">
          <div className="mb-4 flex items-center gap-2">
            <Lock size={16} className="text-accent" />
            <h2 className="font-semibold">{isSetUp ? "Locked" : "Set up the vault"}</h2>
          </div>

          {!isSetUp && (
            <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-[12.5px] leading-relaxed text-amber-200">
              <ShieldAlert size={14} className="mb-1 inline" />{" "}
              One passphrase protects every login here, and it is never sent to the server.
              <strong className="text-amber-100"> If it is lost, the stored logins cannot be recovered by anyone, including us.</strong>{" "}
              Put it in whatever the team already uses to share secrets, not in a chat message.
            </div>
          )}

          {err && <div className="mb-3 rounded-lg border border-red-500/40 bg-red-500/5 p-3 text-sm text-red-300">{err}</div>}

          <label className="field-label" htmlFor="vault-pass">Passphrase</label>
          <input
            id="vault-pass"
            type="password"
            className="input mb-3"
            value={pass}
            autoComplete={isSetUp ? "current-password" : "new-password"}
            onChange={(e) => setPass(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && isSetUp) void unlock(); }}
          />

          {!isSetUp && (
            <>
              <label className="field-label" htmlFor="vault-pass2">Confirm</label>
              <input id="vault-pass2" type="password" className="input mb-3" value={pass2} autoComplete="new-password" onChange={(e) => setPass2(e.target.value)} />
            </>
          )}

          <button className="btn-primary w-full" onClick={() => void (isSetUp ? unlock() : createVault())} disabled={busy || !pass}>
            {busy ? "Working…" : isSetUp ? <><Unlock size={15} /> Unlock</> : <><KeyRound size={15} /> Create the vault</>}
          </button>

          <p className="mt-3 text-[11px] leading-relaxed text-faint">
            Encryption happens on this device. The server stores only ciphertext, so a database
            leak does not expose these logins. It cannot protect against a compromised browser,
            and it cannot stop somebody who knows the passphrase.
          </p>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------- unlocked
  return (
    <div>
      <PageHeader
        title="Password Manager"
        subtitle="Unlocked for this tab only. Closing it locks the vault again."
        action={
          <div className="flex gap-2">
            <button className="btn-ghost border border-border" onClick={() => { setKey(null); setShown({}); }}>
              <Lock size={15} /> Lock
            </button>
            {isAdmin && <button className="btn-primary" onClick={() => setModal(true)}><Plus size={15} /> Add login</button>}
          </div>
        }
      />

      {err && <div className="card mb-4 border-red-500/40 bg-red-500/5 p-3 text-sm text-red-300">{err}</div>}

      {rows.length === 0 && (
        <div className="card p-8 text-center">
          <KeyRound size={24} className="mx-auto mb-3 text-faint" />
          <p className="font-medium">No logins stored</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-faint">
            Prefer delegated access where the tool supports it: Google Workspace delegation, or
            adding the EA as a user. Share a password only when there is no such option.
          </p>
        </div>
      )}

      <div className="card divide-y divide-border">
        {rows.map((c) => (
          <div key={c.id} className="group flex items-center gap-3 px-3 py-2.5">
            <KeyRound size={15} className="shrink-0 text-faint" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {c.label}
                {c.url && (
                  <a href={c.url} target="_blank" rel="noopener noreferrer" className="ml-1.5 inline-block text-faint hover:text-accent" aria-label={`Open ${c.label}`}>
                    <ExternalLink size={11} />
                  </a>
                )}
              </p>
              <p className="truncate text-xs text-faint">
                {c.username || "no username"}
                {c.client_id && <> · {clients.find((x) => x.id === c.client_id)?.name}</>}
                {shown[c.id] && <> · <span className="font-mono text-zinc-200">{shown[c.id]}</span></>}
              </p>
            </div>

            {c.rotated_at === null && c.created_at < new Date(Date.now() - 90 * 864e5).toISOString() && (
              <Badge tone="high">Rotate</Badge>
            )}

            <button className="icon-btn reveal-on-hover shrink-0 text-faint hover:text-accent" onClick={() => void copy(c)} aria-label={`Copy the password for ${c.label}`}>
              <Copy size={14} />
            </button>
            <button className="icon-btn reveal-on-hover shrink-0 text-faint hover:text-accent" onClick={() => void reveal(c)} aria-label={shown[c.id] ? `Hide the password for ${c.label}` : `Reveal the password for ${c.label}`}>
              {shown[c.id] ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
            {isAdmin && (
              <button className="icon-btn reveal-on-hover shrink-0 text-faint hover:text-red-400" onClick={() => remove.mutate(c.id)} aria-label={`Delete ${c.label}`}>
                <Trash2 size={14} />
              </button>
            )}
          </div>
        ))}
      </div>

      <p className="mt-3 text-[11px] text-faint">
        Every reveal and copy is written to an append-only log the client can be shown.
        When an assignment ends, revoke access and rotate anything that person opened:
        revoking cannot un-know a password they already read.
      </p>

      <Modal open={modal} onClose={() => setModal(false)}>
        <h2 className="mb-4 text-lg font-semibold">Add a login</h2>
        <div className="space-y-3">
          <div>
            <label className="field-label" htmlFor="c-label">What is it</label>
            <input id="c-label" className="input" placeholder="e.g. Vantage Shopify admin" value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="field-label" htmlFor="c-user">Username</label>
              <input id="c-user" className="input" value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} />
            </div>
            <div>
              <label className="field-label" htmlFor="c-url">URL</label>
              <input id="c-url" className="input" placeholder="https://…" value={form.url} onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="field-label" htmlFor="c-secret">Password</label>
            <input id="c-secret" type="password" className="input" autoComplete="new-password" value={form.secret} onChange={(e) => setForm((f) => ({ ...f, secret: e.target.value }))} />
            <p className="mt-1 text-[11px] text-faint">Encrypted on this device before it leaves the page.</p>
          </div>
          <div>
            <label className="field-label">Client</label>
            <select className="input" value={form.clientId} onChange={(e) => setForm((f) => ({ ...f, clientId: e.target.value }))}>
              <option value="">No client</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="c-notes">Notes (not encrypted)</label>
            <input id="c-notes" className="input" placeholder="e.g. 2FA goes to Priya's phone" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </div>
          <button className={cn("btn-primary w-full")} onClick={() => void addCredential()} disabled={!form.label.trim() || !form.secret || save.isPending}>
            {save.isPending ? "Saving…" : "Save login"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
