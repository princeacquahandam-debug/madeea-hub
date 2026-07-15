/**
 * Workspace search — a tiny, allocation-light ranker shared by the search tools
 * and the live search-as-you-type in the UI. Operates on an in-memory index
 * (built once per open from react-query data + local stores), so results return
 * in well under the 50ms local-data target with no network.
 */
import type { SearchEntity, SearchResult } from "./types";

type Candidate = Omit<SearchResult, "score">;

/** Score a candidate against a lowercased query. Lower = better; -1 = no match. */
function score(label: string, sub: string | undefined, q: string): number {
  const hay = `${label} ${sub ?? ""}`.toLowerCase();
  if (!q) return 100; // empty query: keep, unranked
  const idx = hay.indexOf(q);
  if (idx === -1) {
    // token-subset fallback: every query word appears somewhere
    const words = q.split(/\s+/).filter(Boolean);
    if (words.length > 1 && words.every((w) => hay.includes(w))) return 40;
    return -1;
  }
  // Prefix match on the label ranks best, then earlier positions.
  const labelHit = label.toLowerCase().startsWith(q) ? 0 : 10;
  return labelHit + Math.min(idx, 30);
}

export function searchWorkspace(
  query: string,
  index: Candidate[],
  opts: { scope?: SearchEntity; limit?: number } = {},
): SearchResult[] {
  const q = query.trim().toLowerCase();
  const scoped = opts.scope ? index.filter((c) => c.type === opts.scope) : index;
  const ranked: SearchResult[] = [];
  for (const c of scoped) {
    const s = score(c.label, c.sub, q);
    if (s >= 0) ranked.push({ ...c, score: s });
  }
  ranked.sort((a, b) => a.score - b.score || a.label.localeCompare(b.label));
  return ranked.slice(0, opts.limit ?? 20);
}
