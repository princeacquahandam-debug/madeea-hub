import type { Client, Message } from "@/types/db";

/**
 * Which client a message belongs to.
 *
 * WHY THIS IS NOT JUST `m.client_id`. Nothing sets it. gmail-sync writes a
 * message with a hardcoded category and no client, so all 87 messages in the
 * inbox have client_id null. Any feature that filters by client therefore
 * returns an empty list, which reads as "this client has never emailed you"
 * rather than "we never linked the two".
 *
 * So the link is derived when it has not been stored: the sender's email domain
 * against the client's own. `clients.domains` exists for exactly this and has
 * simply never been read.
 *
 * ORDER MATTERS. A stored client_id wins over anything inferred, because
 * somebody chose it deliberately and a guess must never overrule a decision.
 * Only then the explicit address, then the domain.
 *
 * DERIVED, NOT WRITTEN BACK. This resolves at read time on purpose. Writing an
 * inferred link into the row would make a guess indistinguishable from a
 * decision the next time anything reads it, and the guess is wrong for any
 * client who emails from a shared host: half a dozen clients on gmail.com would
 * all collapse onto whichever one was matched first. Free-mail domains are
 * refused below for that reason.
 */

/** Domains that identify a person, never an organisation. */
const PUBLIC_MAIL = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com",
  "yahoo.com", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com",
  "gmx.com", "mail.com", "zoho.com", "yandex.com", "msn.com",
]);

export function domainOf(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  const d = email.slice(at + 1).trim().toLowerCase();
  return d || null;
}

/** A client's domains, normalised, with free-mail hosts removed. */
function clientDomains(c: Client): string[] {
  const listed = ((c as { domains?: string[] | null }).domains ?? [])
    .map((d) => String(d).trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
  const fromEmail = domainOf((c as { email?: string | null }).email);
  const all = fromEmail ? [...listed, fromEmail] : listed;
  return all.filter((d) => !PUBLIC_MAIL.has(d));
}

export function clientForMessage(m: Message, clients: Client[]): Client | null {
  // 1. A stored decision always wins.
  if (m.client_id) {
    const byId = clients.find((c) => c.id === m.client_id);
    if (byId) return byId;
  }

  const sender = (m.sender_email ?? "").trim().toLowerCase();

  // 2. The exact address the client is known by.
  if (sender) {
    const byEmail = clients.find(
      (c) => ((c as { email?: string | null }).email ?? "").trim().toLowerCase() === sender,
    );
    if (byEmail) return byEmail;
  }

  // 3. The organisation's domain. Skipped entirely for free-mail hosts, where
  //    the domain says nothing about who the sender works for.
  const d = domainOf(sender);
  if (d && !PUBLIC_MAIL.has(d)) {
    const byDomain = clients.find((c) => clientDomains(c).includes(d));
    if (byDomain) return byDomain;
  }

  // 4. Legacy rows carried a client name rather than an id.
  if (m.client_name) {
    const byName = clients.find((c) => c.name === m.client_name);
    if (byName) return byName;
  }

  return null;
}

/** True when the message belongs to this client. Null client id means "all". */
export function messageInClient(m: Message, clientId: string | null, clients: Client[]): boolean {
  if (!clientId) return true;
  return clientForMessage(m, clients)?.id === clientId;
}
