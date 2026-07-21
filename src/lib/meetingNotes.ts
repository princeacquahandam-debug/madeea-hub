/**
 * Meeting Helper — turning notes into follow-through.
 *
 * The prep half of meetings already exists (lib/meetingPrep.ts). The half that was
 * missing is what happens afterwards: a meeting generates commitments, and right
 * now nothing in the app catches them. They live in someone's notebook until they
 * don't.
 *
 * Extraction here is DELIBERATELY deterministic — no model call. Two reasons:
 *
 *  1. Dates. Same argument as lib/voiceTask.ts: models routinely get "what date is
 *     next Friday" wrong, and this file reuses that module's parser rather than
 *     re-deriving it. A task silently due on the wrong day is worse than one with
 *     no date.
 *  2. Fabrication. An action item the meeting never agreed to is far more damaging
 *     than a missed one — the EA chases the client about something imaginary. Every
 *     item produced here is traceable to a line the user actually typed, and that
 *     source line is shown in the UI next to it.
 *
 * The model still gets a job on this page: writing the recap prose. It just doesn't
 * get to decide what was agreed.
 */
import type { Client, Priority } from "@/types/db";
import { cleanTitle, matchClient, parseDate, parsePriority } from "@/lib/voiceTask";

export interface ActionItem {
  id: string;
  title: string;
  /** "YYYY-MM-DD", or "" for no due date. */
  due: string;
  priority: Priority;
  client_id: string | null;
  /** Who took it on, if the note named someone. Free text — not a user record. */
  owner: string;
  /** The exact line this came from, shown so the EA can check it against reality. */
  source: string;
  /** Ticked items become tasks. Everything starts ticked; the EA unticks noise. */
  selected: boolean;
}

const MIN_LINE_CHARS = 8;
const MAX_ITEMS = 30;

/**
 * Verbs and markers that signal a commitment rather than a note. Kept broad — a
 * false positive costs one untick, a false negative loses a commitment entirely,
 * and the EA reviews the list before anything is created either way.
 */
const ACTION_CUES =
  /\b(action|todo|to-do|follow[ -]?up|next step|will|to send|send|chase|book|draft|confirm|share|prepare|circulate|schedule|resched|review|check|call|email|invite|update|arrange|set up|sign|approve|submit|file|collate|pull together|get back|revert|introduce|intro)\b/i;

/** Lines that are structure, not content. */
const HEADING = /^(agenda|attendees|present|apologies|notes|minutes|discussion|decisions?|actions?|next steps?|summary|aob|any other business)\s*:?\s*$/i;

const BULLET = /^\s*(?:[-*•·–—]|\d+[.)]|\[\s?\]|\[x\]i?)\s*/i;

/**
 * "James to send the deck" / "Priya will confirm" — capture the owner and strip it
 * from the title, so the task reads as an instruction rather than a transcript.
 */
const OWNER_PREFIX = /^@?([A-Z][a-zA-Z'’-]+(?:\s+[A-Z][a-zA-Z'’-]+)?)\s+(?:to|will|is going to|agreed to|has to|should)\s+/;

function looksLikeAction(line: string): boolean {
  const t = line.trim();
  if (t.length < MIN_LINE_CHARS) return false;
  if (HEADING.test(t.replace(BULLET, ""))) return false;
  // A question is something raised, not something agreed.
  if (t.endsWith("?")) return false;
  return ACTION_CUES.test(t);
}

export interface ExtractSources {
  notes: string;
  clients: Client[];
  /** The meeting's client — the default owner of any item that doesn't name one. */
  defaultClientId: string | null;
}

/**
 * Split notes into candidate lines and keep the ones that read like commitments.
 * Every returned item points back at its source line.
 */
export function extractActions(
  { notes, clients, defaultClientId }: ExtractSources,
  now = new Date(),
): ActionItem[] {
  const lines = notes
    .split(/\r?\n/)
    // A single long paragraph is common in typed notes, so also break on sentence
    // ends. Splitting only on newlines would collapse five commitments into one.
    .flatMap((l) => (l.includes("\n") ? [l] : l.split(/(?<=[.;])\s+(?=[A-Z@])/)))
    .map((l) => l.trim())
    .filter(Boolean);

  const items: ActionItem[] = [];
  const seen = new Set<string>();

  for (const raw of lines) {
    if (items.length >= MAX_ITEMS) break;
    if (!looksLikeAction(raw)) continue;

    const stripped = raw.replace(BULLET, "").trim();
    const ownerMatch = OWNER_PREFIX.exec(stripped);
    const owner = ownerMatch?.[1] ?? "";
    const withoutOwner = ownerMatch ? stripped.slice(ownerMatch[0].length) : stripped;

    // cleanTitle strips the date/priority chatter that's already captured as fields.
    const title = cleanTitle(withoutOwner) || withoutOwner;
    if (title.length < MIN_LINE_CHARS) continue;

    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    // The owner's name is matched against the Vault too — "James to send the deck"
    // in a meeting about a different client still belongs to James.
    const named = matchClient(stripped, clients) ?? (owner ? matchClient(owner, clients) : null);

    items.push({
      id: `action-${items.length + 1}`,
      title: title.slice(0, 200),
      due: parseDate(stripped, now) ?? "",
      priority: parsePriority(stripped),
      client_id: named?.id ?? defaultClientId,
      owner,
      source: raw,
      selected: true,
    });
  }

  return items;
}

/** Human summary of what extraction did, so an empty result isn't a silent failure. */
export function extractionSummary(notes: string, items: ActionItem[]): string {
  if (!notes.trim()) return "Paste your notes above and the action items will appear here.";
  if (!items.length) {
    return "No commitments found. Extraction looks for lines with an action in them — try phrasing as “Bryan to send the deck by Friday”.";
  }
  const dated = items.filter((i) => i.due).length;
  return `${items.length} action${items.length === 1 ? "" : "s"} found${dated ? `, ${dated} with a date read from your wording` : ", none with a date in the wording"}. Untick anything that isn't real.`;
}

/** Facts for the recap prose. The model writes it up; it does not decide content. */
export function recapPromptInputs(
  meetingTitle: string,
  attendee: string,
  notes: string,
  items: ActionItem[],
  clients: Client[],
): Record<string, string> {
  const chosen = items.filter((i) => i.selected);
  const nameFor = (id: string | null) => clients.find((c) => c.id === id)?.name ?? "";

  return {
    meeting: meetingTitle,
    attendee: attendee || "(internal)",
    raw_notes: notes.slice(0, 6000),
    agreed_actions: chosen.length
      ? chosen
          .map(
            (i) =>
              `- ${i.title}${i.owner ? ` (owner: ${i.owner})` : ""}${i.due ? ` — due ${i.due}` : ""}${
                nameFor(i.client_id) ? ` [${nameFor(i.client_id)}]` : ""
              }`,
          )
          .join("\n")
      : "(none agreed)",
  };
}
