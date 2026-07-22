/**
 * Memory Helper — durable facts the desk shouldn't have to re-learn.
 *
 * READ THIS BEFORE EXTENDING. The name oversells what this is, so the boundary is
 * stated here rather than left to be discovered:
 *
 *   This is a CURATED memory. A human wrote every entry, or confirmed it. Recall is
 *   keyword and client matching — plain token overlap, no embeddings, no semantics.
 *   "Doesn't like early calls" will NOT match a search for "scheduling".
 *
 * The UI says so too, in those words. An automatic memory that silently misses
 * things is worse than a manual one that's honest about its edges: the EA stops
 * checking, and the gap only shows up when a client is told something wrong.
 *
 * What makes this more than a notes page is the wiring: entries flow into the other
 * helpers' context (see lib/emailContext.ts), so a preference recorded once shapes
 * every draft afterwards. That's the whole point — capture in one place, surface
 * everywhere.
 *
 * Pure and network-free. The store lives in the DB (migration 0017); this file only
 * decides what's relevant.
 */
import type { Client } from "@/types/db";

export type MemoryKind = "preference" | "fact" | "commitment" | "context" | "goal";

export interface MemoryEntry {
  id: string;
  kind: MemoryKind;
  /** Null = a general fact about the desk rather than about one client. */
  client_id: string | null;
  body: string;
  /** Where it came from, in the user's words. */
  source: string;
  pinned: boolean;
  created_at?: string | null;
}

export const MEMORY_KINDS: MemoryKind[] = ["preference", "fact", "commitment", "context", "goal"];

export const KIND_LABEL: Record<MemoryKind, string> = {
  preference: "Preference",
  fact: "Fact",
  commitment: "Commitment",
  context: "Context",
  goal: "Goal",
};

export const KIND_HELP: Record<MemoryKind, string> = {
  preference: "How they like things done — surfaces in email drafts.",
  fact: "Something true about them or their business.",
  commitment: "Something we promised — surfaces in the daily briefing.",
  context: "Background worth knowing, not directly actionable.",
  goal: "A stated priority — the Focus Helper checks the diary against these.",
};

export const KIND_TONE: Record<MemoryKind, string> = {
  preference: "reply",
  fact: "normal",
  commitment: "high",
  context: "normal",
  goal: "urgent",
};

/** Words too common to carry meaning — matching on these makes everything relevant. */
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "if", "to", "of", "in", "on", "at", "for", "with",
  "is", "are", "was", "were", "be", "been", "it", "this", "that", "these", "those", "as",
  "by", "from", "we", "you", "they", "he", "she", "i", "me", "my", "our", "their", "his",
  "her", "them", "us", "do", "does", "did", "not", "no", "yes", "can", "will", "would",
  "should", "could", "have", "has", "had", "about", "into", "over", "than", "then", "so",
  "up", "out", "just", "get", "got", "any", "all", "some", "more", "very", "re",
]);

export function tokenise(text: string): string[] {
  return (text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^['-]+|['-]+$/g, ""))
    // Two-letter words are almost always noise once stopwords are gone.
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

export interface RecallQuery {
  /** Restrict/boost to one client. */
  clientId?: string | null;
  /** Free text to match against — an email body, a meeting title. */
  text?: string;
  /** Kinds to consider. Defaults to all. */
  kinds?: MemoryKind[];
  limit?: number;
}

export interface Recalled extends MemoryEntry {
  /** Why it surfaced, so the UI never shows an unexplained result. */
  why: string;
}

/**
 * Deterministic recall.
 *
 * Ordering, highest first:
 *   1. pinned entries for this client   — always relevant, that's what pinning means
 *   2. keyword overlap with the text    — more shared words ranks higher
 *   3. other entries for this client
 *
 * Entries about a DIFFERENT client are excluded entirely when a client is given.
 * Leaking one client's preferences into another's draft is the failure mode that
 * would end trust in this feature immediately.
 */
export function recall(memories: MemoryEntry[], q: RecallQuery = {}): Recalled[] {
  const limit = q.limit ?? 6;
  const kinds = q.kinds;
  const queryTokens = new Set(tokenise(q.text ?? ""));

  const scored: { entry: MemoryEntry; score: number; why: string }[] = [];

  for (const m of memories) {
    if (kinds && !kinds.includes(m.kind)) continue;
    // Hard exclusion, not a ranking penalty.
    if (q.clientId && m.client_id && m.client_id !== q.clientId) continue;

    const mine = Boolean(q.clientId) && m.client_id === q.clientId;
    let score = 0;
    const why: string[] = [];

    if (mine && m.pinned) {
      score += 100;
      why.push("pinned for this client");
    } else if (mine) {
      score += 20;
      why.push("about this client");
    } else if (!m.client_id) {
      score += 5;
      why.push("general");
      if (m.pinned) score += 10;
    }

    if (queryTokens.size) {
      const bodyTokens = new Set(tokenise(m.body));
      const shared = [...bodyTokens].filter((t) => queryTokens.has(t));
      if (shared.length) {
        score += shared.length * 8;
        why.push(`matches “${shared.slice(0, 3).join("”, “")}”`);
      }
    }

    if (score <= 0) continue;
    scored.push({ entry: m, score, why: why.join(" · ") });
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ entry, why }) => ({ ...entry, why }));
}

/** Free-text search for the Memory page itself. Substring OR token overlap. */
export function searchMemories(memories: MemoryEntry[], query: string): MemoryEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return memories;
  const tokens = new Set(tokenise(q));
  return memories.filter((m) => {
    if (m.body.toLowerCase().includes(q) || m.source.toLowerCase().includes(q)) return true;
    const body = new Set(tokenise(`${m.body} ${m.source}`));
    return [...tokens].some((t) => body.has(t));
  });
}

/** Recalled entries as prompt lines. Kind is included — it changes how they're used. */
export function memoryPromptLines(entries: Recalled[]): string {
  if (!entries.length) return "(nothing recorded)";
  return entries
    .map((e) => `- [${KIND_LABEL[e.kind]}] ${e.body}${e.source ? ` (source: ${e.source})` : ""}`)
    .join("\n");
}

export function clientName(clients: Client[], id: string | null): string {
  if (!id) return "General";
  return clients.find((c) => c.id === id)?.name ?? "Unknown client";
}

/** Seeds the "what should I record?" empty state with something concrete. */
export const MEMORY_EXAMPLES = [
  "Never schedule calls before 10am — school run.",
  "Prefers a one-line summary at the top of every document.",
  "Hates attachments; send links instead.",
  "We promised a quarterly review deck each January.",
];
