/**
 * Credential encryption.
 *
 * ── Read this before changing anything here ───────────────────────────────
 *
 * PROJECT_PLAN §5.8 says: do this correctly or do not ship it. It specifies
 * envelope encryption with a per-org data key wrapped by a KMS master key.
 * Supabase does not give us a KMS, and a "master key" sitting in an env var
 * next to the database is not envelope encryption, it is a second copy of the
 * password with extra steps.
 *
 * So the key is derived in the BROWSER from a workspace passphrase that is
 * never sent anywhere. The server stores ciphertext, a nonce, and a salt. If
 * the database leaks, the attacker has none of the secrets. That is the
 * property worth having, and it is the one an env-var key would not give.
 *
 * ── What this does and does not protect against ───────────────────────────
 *
 *  Protects: database dump, backup theft, a Supabase-side compromise, an admin
 *            reading rows directly, anyone with the anon key.
 *
 *  Does NOT: a compromised browser, a malicious extension, or somebody who has
 *            the passphrase. Nothing client-side can.
 *
 *  Grants and the access log are enforced by RLS, which decides who may FETCH
 *  the ciphertext. The passphrase decides who may READ it. Those are two
 *  different controls and the vault needs both: revoking a grant stops someone
 *  fetching new rows, but it cannot un-know a passphrase they already had.
 *  Rotation after an assignment ends is therefore mandatory, not advisory, and
 *  the UI says so.
 *
 * ── Parameters ────────────────────────────────────────────────────────────
 * PBKDF2-SHA256, 600k iterations (OWASP 2023 floor for SHA-256), AES-GCM-256.
 * WebCrypto only, no dependencies. `key_version` is stored per row so these can
 * be raised later and old rows still open.
 */

const ITERATIONS = 600_000;
export const KEY_VERSION = 1;

const enc = new TextEncoder();
const dec = new TextDecoder();

const b64 = (buf: ArrayBuffer): string => btoa(String.fromCharCode(...new Uint8Array(buf)));

/* Backed by a real ArrayBuffer rather than Uint8Array.from, whose ArrayBufferLike
   is not assignable to BufferSource under TS 5.7's stricter typed-array types. */
const unb64 = (s: string): Uint8Array<ArrayBuffer> => {
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

/** A random salt, stored alongside the workspace. Not secret, must be unique. */
export function newSalt(): string {
  return b64(crypto.getRandomValues(new Uint8Array(16)).buffer);
}

/**
 * Turn a passphrase into a key. Deliberately slow: 600k iterations measured at
 * ~100ms here, which is unnoticeable when unlocking once a session and costly
 * to anyone running a dictionary against a stolen dump.
 */
export async function deriveKey(passphrase: string, saltB64: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: unb64(saltB64), iterations: ITERATIONS, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export interface Sealed {
  ciphertext: string;
  nonce: string;
}

export async function seal(key: CryptoKey, plaintext: string): Promise<Sealed> {
  // 96-bit nonce, fresh per encryption. Reusing one with the same key breaks
  // GCM completely, so it is generated here and never passed in.
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, enc.encode(plaintext));
  return { ciphertext: b64(ct), nonce: b64(nonce.buffer) };
}

/** Null when the key is wrong. GCM authenticates, so a bad key cannot silently
 *  return garbage. That is what makes the unlock check below trustworthy. */
export async function open(key: CryptoKey, sealed: Sealed): Promise<string | null> {
  try {
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: unb64(sealed.nonce) },
      key,
      unb64(sealed.ciphertext),
    );
    return dec.decode(pt);
  } catch {
    return null;
  }
}

/**
 * A known value sealed with the key, so a wrong passphrase is caught at unlock
 * rather than showing mojibake in place of a password. Stored on the workspace,
 * reveals nothing about the passphrase.
 */
const CHECK = "madeea-vault-ok";

export const makeVerifier = (key: CryptoKey) => seal(key, CHECK);
export const checkVerifier = async (key: CryptoKey, v: Sealed) => (await open(key, v)) === CHECK;
