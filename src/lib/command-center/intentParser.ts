/**
 * Intent parser — natural-language → { intent, params, confidence }.
 *
 * This is a fast, fully-offline heuristic classifier (runs in well under a
 * millisecond, so search/parse feel instant and work in the static demo with no
 * backend). It is intentionally the *only* place that maps language → intent, so
 * an AI-backed classifier can later be slotted in behind the same signature
 * (`parseIntent`) without touching the router or tools.
 *
 * Design: an ordered list of matchers, most-specific first. The first matcher
 * that fires wins. Each returns extracted params and a confidence score; a low
 * score (or no match) falls back to the conversational `ask` intent.
 */
import type { Intent, ParsedCommand } from "./types";

interface Matcher {
  intent: Intent;
  test: RegExp;
  /** Pull tool params out of the raw prompt. */
  extract?: (m: RegExpMatchArray, raw: string) => Record<string, string>;
  confidence: number;
}

/** Strip a trailing time phrase and surrounding quotes from a captured value. */
function clean(s: string | undefined): string {
  if (!s) return "";
  return s
    .trim()
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .replace(/[.!?]+$/, "")
    .trim();
}

/** Grab a "called/named/titled/for/about X" object, or the trailing phrase. */
function objectAfter(raw: string, verbs: string): string {
  const re = new RegExp(`(?:${verbs})\\s+(?:called|named|titled|for|about|to|:)?\\s*["'“]?(.+?)["'”]?$`, "i");
  const m = raw.match(re);
  return clean(m?.[1]);
}

/**
 * Pull the search *term* out of a search command. Prefers an explicit
 * "…for <term>" clause (so "search my workspace for Marketing" → "Marketing"),
 * otherwise strips the leading verb + filler ("my", "workspace", entity nouns).
 */
function searchTerm(raw: string, extra: string[] = []): string {
  const forClause = raw.match(/\bfor\s+["'“]?(.+?)["'”]?$/i);
  if (forClause) return clean(forClause[1]);
  let s = raw.replace(/^\s*(search|find|look\s?up|lookup|show|list|view)\b/i, "");
  s = s.replace(/\b(my|the|all|in|workspace)\b/gi, " ");
  for (const w of extra) s = s.replace(new RegExp(`\\b${w}s?\\b`, "gi"), " ");
  return clean(s.replace(/\s+/g, " "));
}

// Time expressions we recognize for reminders/scheduling.
const TIME_RE = /\b(tomorrow|today|tonight|next week|next month|monday|tuesday|wednesday|thursday|friday|saturday|sunday|in \d+ (?:minutes?|hours?|days?|weeks?)|at \d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i;

const MATCHERS: Matcher[] = [
  // ---- Reminders (before create_task, since "remind me" is distinctive) ----
  {
    intent: "create_reminder",
    test: /\b(remind me|set (?:a )?reminder|schedule (?:a )?reminder)\b/i,
    confidence: 0.9,
    extract: (_m, raw) => {
      const when = clean(raw.match(TIME_RE)?.[0]) || "tomorrow";
      const label =
        clean(raw.match(/remind me (?:to|about)\s+(.+?)(?:\s+(?:tomorrow|today|tonight|next|on|at|in)\b.*)?$/i)?.[1]) ||
        clean(raw.replace(/.*reminder\s*(?:to|about|for|:)?\s*/i, "").replace(TIME_RE, "")) ||
        "Reminder";
      return { label, when };
    },
  },

  // ---- Projects ----
  {
    intent: "create_project",
    test: /\b(create|add|new|start|make)\b.*\bproject\b/i,
    confidence: 0.92,
    extract: (_m, raw) => ({ title: objectAfter(raw, "project") || "Untitled Project" }),
  },

  // ---- Meeting notes (before generic notes/tasks) ----
  {
    intent: "create_meeting_notes",
    test: /\b(meeting notes|create meeting notes|take (?:meeting )?notes|minutes)\b/i,
    confidence: 0.88,
    extract: (_m, raw) => ({ topic: objectAfter(raw, "notes|minutes|meeting") }),
  },

  // ---- Notes ----
  {
    intent: "create_note",
    test: /\b(create|add|new|take|write)\b.*\bnote\b|^note(?:\s|:)/i,
    confidence: 0.85,
    extract: (_m, raw) => {
      const body = objectAfter(raw, "note");
      return { title: body.split(/[.,\n]/)[0].slice(0, 60) || "New note", body };
    },
  },

  // ---- Tasks ----
  {
    intent: "create_task",
    test: /\b(create|add|new)\b.*\btask\b|^(?:todo|to-do)\b|\badd (?:a )?to-?do\b/i,
    confidence: 0.9,
    extract: (_m, raw) => ({ title: objectAfter(raw, "task|todo|to-do") || "New task" }),
  },
  {
    // "unfinished/open tasks" is a search, not a create.
    intent: "search_workspace",
    test: /\b(show|list|find|view)\b.*\b(unfinished|open|pending|incomplete|my)?\s*tasks?\b/i,
    confidence: 0.8,
    extract: () => ({ scope: "task", query: "" }),
  },

  // ---- Email ----
  {
    intent: "write_email",
    test: /\b(write|draft|compose|send)\b.*\bemail\b|\bemail (?:to|my)\b/i,
    confidence: 0.9,
    extract: (_m, raw) => {
      const recipient = clean(raw.match(/\b(?:to|for)\s+(?:my\s+)?([a-z][\w .'-]{1,40}?)(?:\s+(?:about|regarding|re|saying|that)\b.*)?$/i)?.[1]);
      const points = clean(raw.match(/\b(?:about|regarding|re|saying|that)\s+(.+)$/i)?.[1]);
      return { recipient: recipient || "", points: points || raw, subject: points || "" };
    },
  },

  // ---- Translate ----
  {
    intent: "translate",
    test: /\btranslate\b/i,
    confidence: 0.9,
    extract: (_m, raw) => ({
      language: clean(raw.match(/\b(?:in)?to\s+([a-z]+)\s*$/i)?.[1]) || "Spanish",
      text: clean(raw.match(/translate\s+(.+?)\s+(?:in)?to\s+[a-z]+\s*$/i)?.[1]) || "",
    }),
  },

  // ---- Summaries / analysis ----
  {
    intent: "summarize_pdf",
    test: /\bsummar(?:ize|ise)\b.*\bpdf\b|\bpdf\b.*\bsummar/i,
    confidence: 0.88,
    extract: (_m, raw) => ({ target: objectAfter(raw, "of|in") || raw }),
  },
  {
    intent: "analyze_document",
    test: /\banaly[sz]e\b.*\b(document|doc|file|contract|report)\b/i,
    confidence: 0.85,
    extract: (_m, raw) => ({ target: objectAfter(raw, "document|doc|file|contract|report") }),
  },
  {
    intent: "summarize_documents",
    test: /\bsummar(?:ize|ise)\b|\btl;?dr\b/i,
    confidence: 0.82,
    extract: (_m, raw) => ({ target: objectAfter(raw, "summarize|summarise|of|in|documents|docs") || raw }),
  },

  // ---- Rewrite ----
  {
    intent: "rewrite_text",
    test: /\b(rewrite|reword|rephrase|paraphrase|polish|improve (?:this|the)|make (?:this|it) (?:more|less)\b)/i,
    confidence: 0.82,
    extract: (_m, raw) => ({ text: raw }),
  },

  // ---- Code ----
  {
    intent: "generate_code",
    test: /\b(generate|write|create)\b.*\b(code|function|component|script|query|regex|snippet)\b/i,
    confidence: 0.86,
    extract: (_m, raw) => ({ spec: objectAfter(raw, "code|function|component|script|query|regex|snippet|for|to") || raw }),
  },

  // ---- Explain ----
  {
    intent: "explain",
    test: /^\s*(explain|what is|what are|how does|how do|why (?:is|does)|define)\b/i,
    confidence: 0.8,
    extract: (_m, raw) => ({ topic: raw }),
  },

  // ---- Settings (before generic open) ----
  {
    intent: "open_settings",
    test: /\b(open |go to |show )?settings\b/i,
    confidence: 0.85,
  },

  // ---- Search ----
  {
    intent: "search_projects",
    test: /\b(find|search|show|list)\b.*\bprojects?\b/i,
    confidence: 0.82,
    extract: (_m, raw) => ({ query: searchTerm(raw, ["project"]), scope: "project" }),
  },
  {
    intent: "search_notes",
    test: /\b(find|search|show|list)\b.*\bnotes?\b/i,
    confidence: 0.82,
    extract: (_m, raw) => ({ query: searchTerm(raw, ["note"]), scope: "note" }),
  },
  {
    intent: "search_files",
    test: /\b(find|search)\b.*\b(files?|documents?|invoices?|pdfs?)\b/i,
    confidence: 0.8,
    extract: (_m, raw) => ({ query: searchTerm(raw, ["file", "document", "invoice", "pdf"]) }),
  },
  {
    intent: "search_workspace",
    test: /\b(search|find|look up|lookup)\b/i,
    confidence: 0.75,
    extract: (_m, raw) => ({ query: searchTerm(raw) }),
  },

  // ---- Navigation (open X) ----
  {
    intent: "open_page",
    test: /\b(open|go to|navigate to|show me|take me to)\b/i,
    confidence: 0.7,
    extract: (_m, raw) => ({ target: clean(raw.replace(/^.*\b(?:open|go to|navigate to|show me|take me to)\s+(?:the\s+)?/i, "")) }),
  },
];

/**
 * Classify a raw prompt. Public entrypoint — keep this signature stable so an
 * AI classifier can replace the body without ripples.
 */
export function parseIntent(raw: string): ParsedCommand {
  const text = raw.trim();
  if (!text) return { intent: "unknown", params: {}, confidence: 0, raw };

  for (const m of MATCHERS) {
    const match = text.match(m.test);
    if (match) {
      const params = m.extract ? m.extract(match, text) : {};
      return { intent: m.intent, params, confidence: m.confidence, raw: text };
    }
  }

  // No structured match → treat as a conversational question for the AI.
  return { intent: "ask", params: { prompt: text }, confidence: 0.4, raw: text };
}
