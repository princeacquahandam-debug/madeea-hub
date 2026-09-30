import type { Client, Meeting, Message, Task } from "@/types/db";
import type { CalendarEvent } from "@/data/hooks";
import type { MadelineItem } from "@/store/madeline";

/**
 * What Madeline is told about the thing the user has open.
 *
 * Plain labelled lines, not JSON: it goes into the model's context as page
 * data, and a line like "Due: Fri 18 Sept" reads the same to it as to us.
 * Only what the page already shows the user, so nothing here widens access.
 * Long free text is clipped; the server caps the whole block again anyway.
 */
type Item = Omit<MadelineItem, "path">;

const clip = (s: string | null | undefined, n: number) => {
  const v = (s ?? "").trim();
  return v.length > n ? `${v.slice(0, n)}…` : v;
};

const lines = (pairs: [string, string | null | undefined | false][]) =>
  pairs.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join("\n");

const when = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : null;

export function taskItem(t: Task, assigneeName?: string | null): Item {
  return {
    kind: "task",
    id: t.id,
    label: t.title,
    details: lines([
      ["Task", t.title],
      ["Status", t.status],
      ["Priority", t.priority],
      ["Due", t.due_at ? when(t.due_at) : t.due_label],
      ["Client", t.client_name && t.client_name !== "Unassigned" ? t.client_name : null],
      ["Assigned to", assigneeName ?? (t.assignee_id ? "a teammate" : "nobody yet")],
      ["Blocked", t.blocked ? (t.blocker_note || "yes") : null],
      ["Subtasks", t.subtasks?.length ? t.subtasks.map((s) => `${s.done ? "[x]" : "[ ]"} ${s.label}`).join("; ") : null],
      ["Notes", clip(t.notes, 600)],
    ]),
  };
}

export function meetingItem(m: Meeting): Item {
  return {
    kind: "meeting",
    id: m.id,
    label: m.title,
    details: lines([
      ["Meeting", m.title],
      ["Starts", when(m.starts_at) ?? m.time],
      ["With", m.with],
      ["Attendees", m.attendee_emails?.length ? m.attendee_emails.join(", ") : null],
      ["Prep status", m.status],
    ]),
  };
}

export function calendarEventItem(e: CalendarEvent): Item {
  return {
    kind: "meeting",
    id: e.id,
    label: e.title,
    details: lines([
      ["Meeting", e.title],
      ["Starts", when(e.starts_at)],
      ["Ends", e.all_day ? "all day" : when(e.ends_at)],
      ["Client", e.client_name],
      ["Location", e.location],
      ["Organiser", e.organizer_email],
      ["Attendees", e.attendee_emails.length ? e.attendee_emails.join(", ") : null],
      ["Your response", e.response_status],
      ["From the invite", clip(e.description, 800)],
    ]),
  };
}

export function clientItem(c: Client): Item {
  return {
    kind: "client",
    id: c.id,
    label: c.name,
    details: lines([
      ["Client", c.name],
      ["Role", [c.title, c.company].filter(Boolean).join(", ")],
      ["Email", c.email],
      ["Preferred channel", c.preferred_channel],
      ["Tone", c.tone],
      ["Tags", c.tags?.length ? c.tags.join(", ") : null],
      ["Preferences", clip(c.preferences_notes, 500)],
      ["Bio", clip(c.bio, 400)],
    ]),
  };
}

export function emailItem(m: Message): Item {
  return {
    kind: "email",
    id: m.id,
    label: m.subject || "(no subject)",
    details: lines([
      ["Subject", m.subject || "(no subject)"],
      ["From", m.sender_email ? `${m.sender_name} <${m.sender_email}>` : m.sender_name],
      ["Received", when(m.received_at) ?? m.time],
      ["Client", m.client_name],
      ["Direction", m.direction === "outbound" ? "sent by us" : "received"],
      ["Body", clip(m.body || m.preview, 1500)],
    ]),
  };
}
