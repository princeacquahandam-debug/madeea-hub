/**
 * Meeting prep packets — context assembly.
 *
 * `assemblePrepContext` is deliberately pure and synchronous: it takes data the
 * app has already fetched and reduces it to the *minimum* that's useful walking
 * into a meeting. Only its output is ever sent to the model, so nothing leaves
 * the browser that isn't already on screen somewhere.
 *
 * Everything degrades: a meeting with no matching client still produces a valid
 * packet — the client-derived sections just come back empty, and the UI shows
 * what it has rather than erroring.
 */
import type { Client, Meeting, Message, Task } from "@/types/db";

/** A doc surfaced for a client — an AI Suite generation logged against them. */
export interface ClientDoc {
  id: string;
  tool: string;
  format: string;
  output: string;
  created_at: string;
}

export interface PrepInteraction {
  kind: "email" | "meeting" | "task";
  label: string;
  detail: string;
  when: string;
}

export interface PrepContext {
  meeting: {
    id: string;
    title: string;
    time: string;
    date: string;
    attendees: string[];
    /** External = at least one attendee resolves to a Client Vault record. */
    scope: "internal" | "external";
    status: Meeting["status"];
  };
  client: {
    name: string;
    title: string;
    company: string;
    tone: string;
    preferred_channel: string;
    tags: string[];
    bio: string;
    preferences_notes: string;
  } | null;
  recent: PrepInteraction[];
  openItems: { title: string; priority: string; due: string; status: string }[];
  docs: { format: string; when: string; excerpt: string }[];
}

const MAX_RECENT = 3;
const MAX_OPEN_ITEMS = 6;
const MAX_DOCS = 3;
const EXCERPT_CHARS = 240;

function fmtDate(iso: string | null): string {
  if (!iso) return "Date TBC";
  return new Date(iso).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function relative(iso: string | null): string {
  if (!iso) return "recently";
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}

const byNewest = (a: string | null, b: string | null) =>
  new Date(b ?? 0).getTime() - new Date(a ?? 0).getTime();

/** Trim a long generated document down to something worth reading at a glance. */
function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > EXCERPT_CHARS ? `${flat.slice(0, EXCERPT_CHARS)}…` : flat;
}

export interface PrepSources {
  meeting: Meeting;
  clients: Client[];
  tasks: Task[];
  messages: Message[];
  meetings: Meeting[];
  docs: ClientDoc[];
}

export function assemblePrepContext({
  meeting,
  clients,
  tasks,
  messages,
  meetings,
  docs,
}: PrepSources): PrepContext {
  // Attendee → client resolution. `client_id` is the reliable link; the `with`
  // string is the fallback, since calendar-synced meetings often only carry a name.
  const client =
    clients.find((c) => c.id === meeting.client_id) ??
    clients.find((c) => c.name.toLowerCase() === meeting.with.trim().toLowerCase()) ??
    null;

  const attendees = meeting.with && meeting.with !== "Internal" ? [meeting.with] : [];

  const recent: PrepInteraction[] = [];
  if (client) {
    const lastEmail = messages
      .filter((m) => m.client_id === client.id || m.client_name === client.name)
      .sort((a, b) => byNewest(a.received_at, b.received_at))[0];
    if (lastEmail) {
      recent.push({
        kind: "email",
        label: "Last email",
        detail: lastEmail.subject || lastEmail.preview,
        when: relative(lastEmail.received_at),
      });
    }

    const lastMeeting = meetings
      .filter(
        (m) =>
          m.id !== meeting.id &&
          (m.client_id === client.id || m.with === client.name) &&
          m.starts_at &&
          new Date(m.starts_at).getTime() < Date.now(),
      )
      .sort((a, b) => byNewest(a.starts_at, b.starts_at))[0];
    if (lastMeeting) {
      recent.push({
        kind: "meeting",
        label: "Last meeting",
        detail: lastMeeting.title,
        when: relative(lastMeeting.starts_at),
      });
    }

    const lastDone = tasks
      .filter((t) => t.client_name === client.name && t.status === "done")
      .sort((a, b) => byNewest(a.due_at, b.due_at))[0];
    if (lastDone) {
      recent.push({
        kind: "task",
        label: "Last completed task",
        detail: lastDone.title,
        when: relative(lastDone.due_at),
      });
    }
  }

  const openItems = (client ? tasks.filter((t) => t.client_name === client.name) : [])
    .filter((t) => t.status !== "done")
    .slice(0, MAX_OPEN_ITEMS)
    .map((t) => ({
      title: t.title,
      priority: t.priority,
      due: t.due_label || "No due date",
      status: t.status,
    }));

  return {
    meeting: {
      id: meeting.id,
      title: meeting.title,
      time: meeting.time || "Time TBC",
      date: fmtDate(meeting.starts_at),
      attendees,
      scope: client ? "external" : "internal",
      status: meeting.status,
    },
    client: client
      ? {
          name: client.name,
          title: client.title,
          company: client.company,
          tone: client.tone,
          preferred_channel: client.preferred_channel,
          tags: client.tags ?? [],
          bio: client.bio,
          preferences_notes: client.preferences_notes,
        }
      : null,
    recent: recent.slice(0, MAX_RECENT),
    openItems,
    docs: docs.slice(0, MAX_DOCS).map((d) => ({
      format: d.format,
      when: relative(d.created_at),
      excerpt: excerpt(d.output),
    })),
  };
}

/** True when there's nothing beyond the meeting's own title/time to show. */
export function isThinContext(ctx: PrepContext): boolean {
  return !ctx.client && !ctx.recent.length && !ctx.openItems.length && !ctx.docs.length;
}
