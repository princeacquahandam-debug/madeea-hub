import type { Message } from "@/types/db";

/**
 * Collapse a message list into conversations.
 *
 * WHY. The inbox showed 15 identical "Run failed: pages build and deployment"
 * rows and three identical password resets, because every message was its own
 * row. `thread_id` had a column from the beginning and was never populated;
 * it is now, and reading it turns a wall into a list.
 *
 * WHAT A GROUP SHOWS. The newest message, because that is the state of the
 * conversation, plus a count so nothing is hidden. The alternative, showing the
 * first, means a thread you have already answered still displays the question.
 *
 * MESSAGES WITH NO THREAD ID STAY THEIR OWN ROW. Grouping them together by
 * subject would merge unrelated mail that happens to share a subject line
 * ("Invitation", "Re: hello"), and hiding them would be worse still. Absent
 * data is its own answer, not a licence to guess.
 */

export interface Thread {
  /** The newest message: what the row shows and what the reader opens. */
  head: Message;
  /** Newest first, including the head. */
  messages: Message[];
  /** How many messages in the conversation. 1 means it is not really a thread. */
  count: number;
  /** True when any message in it is unanswered inbound. */
  unread: boolean;
}

const isUnread = (m: Message) => m.direction !== "outbound" && !m.first_reply_at;
const receivedAt = (m: Message) => (m.received_at ? new Date(m.received_at).getTime() : 0);

export function groupThreads(messages: Message[]): Thread[] {
  const byThread = new Map<string, Message[]>();
  const loose: Message[] = [];

  for (const m of messages) {
    const id = (m as { thread_id?: string | null }).thread_id;
    if (!id) { loose.push(m); continue; }
    const list = byThread.get(id) ?? [];
    list.push(m);
    byThread.set(id, list);
  }

  const threads: Thread[] = [];

  for (const list of byThread.values()) {
    const sorted = [...list].sort((a, b) => receivedAt(b) - receivedAt(a));
    threads.push({
      head: sorted[0],
      messages: sorted,
      count: sorted.length,
      unread: sorted.some(isUnread),
    });
  }
  for (const m of loose) {
    threads.push({ head: m, messages: [m], count: 1, unread: isUnread(m) });
  }

  // The list is already newest-first; grouping must not quietly reorder it.
  return threads.sort((a, b) => receivedAt(b.head) - receivedAt(a.head));
}

/**
 * Turn stored HTML entities back into the characters they stand for.
 *
 * Gmail hands us a snippet with entities already encoded, and the sync stores
 * it verbatim, so 22 of 96 rows displayed `&#39;` and `&amp;` as literal text:
 * "Define MadeeA&#39;s strategy". React escapes on render, which is right and
 * is exactly why the entity survives to the screen.
 *
 * Decoded with the browser's own parser rather than a table of replacements,
 * because the set of named entities is large and a partial table is how
 * `&eacute;` ends up on screen instead of an e-acute.
 *
 * A <textarea> specifically, and that is the safety argument, not an
 * incidental choice. Its content model is RCDATA: the parser resolves character
 * references but never builds elements, so `<img onerror=...>` in a subject
 * line comes back as those literal characters instead of becoming a node. The
 * same two lines against a <div> would be an injection from every sender who
 * wanted one. `.value` then reads it back as plain text.
 */
export function decodeEntities(input: string): string {
  if (!input || !input.includes("&")) return input;
  if (typeof document === "undefined") return input;
  const el = document.createElement("textarea");
  el.innerHTML = input;
  return el.value;
}
