/**
 * Starting passwords: the ones somebody sets FOR somebody else.
 *
 * WHY THIS EXISTS AT ALL. Nobody in this product sets their own first password.
 * An admin creates a teammate's login, an admin creates a client's login, and a
 * client creates their colleague's -- because the alternative, mailing an invite
 * link, produced accounts that could sign in but could never change their
 * password, and ran into the project-wide SMTP rate limit besides. Somebody
 * therefore has to invent a password on the spot, three times over, in three
 * different forms.
 *
 * WHICH IS EXACTLY THE MOMENT PEOPLE TYPE "Welcome123". A suggestion offered
 * before they start typing costs nothing and is taken most of the time, so the
 * generator is the default value of the field rather than a button beside it.
 *
 * READABLE OVER A CHAT MESSAGE IS THE WHOLE DESIGN. This password gets relayed
 * by hand -- read out on a call, pasted into WhatsApp, typed off a screen. So:
 * no ambiguous glyphs (l/1/I, O/0), no punctuation that a keyboard layout might
 * move, and hyphens every four characters so the eye can keep its place. What
 * it buys in entropy over a shorter dense string, it keeps, because the person
 * is far more likely to actually use it than to fight it.
 */

/** Supabase's own floor, and what every password form in this app asks for. */
export const MIN_PASSWORD = 8;

/** bcrypt ignores everything past 72 bytes. A longer password would appear to
 *  be accepted and then not match, so the forms refuse it instead. */
export const MAX_PASSWORD = 72;

/* No l, 1, I, O, 0. Every remaining character survives being read aloud. */
const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

/** Three groups of four, hyphenated: `k7mq-p2xr-4rtv`. */
export function suggestPassword(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]);
  return [chars.slice(0, 4), chars.slice(4, 8), chars.slice(8, 12)].map((g) => g.join("")).join("-");
}
