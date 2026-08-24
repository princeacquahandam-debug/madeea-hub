import type { MailProvider, Message } from "@/types/db";

/**
 * Which mailbox answers a given message.
 *
 * WHY THIS IS A FUNCTION AND NOT `m.source === "outlook" ? ... : ...` INLINE.
 * Two screens ask it (the inline reply and the full composer) and both get it
 * wrong in the same expensive way if they disagree: a reply sent through the
 * wrong provider goes out from an address the recipient has never seen, threads
 * onto nothing, and is invisible in the Sent folder of the mailbox the
 * conversation actually lives in. One definition, used by both.
 *
 * WHY GMAIL IS THE DEFAULT AND NOT AN ERROR. `source` is 'manual' on hand-made
 * rows and absent on some old ones, and neither means "unsendable". Gmail
 * shipped first and is what those rows were written against, so it is the
 * honest fallback rather than a guess.
 */
export function providerOf(m: Pick<Message, "source">): MailProvider {
  return m.source === "outlook" ? "outlook" : "gmail";
}
