import { useState } from "react";
import { CalendarPlus, Check, Loader2, AlertTriangle, ExternalLink, Video, VideoOff } from "lucide-react";
import { useCreateCalendarEvent, useGoogleConnection, type CreatedEvent } from "@/data/hooks";
import { reconnectMail } from "@/hooks/useSendEmail";
import { zoneLabel } from "@/lib/calendarTime";
import { instantFor, endInstant } from "@/lib/workday";

/**
 * Turning a prepared meeting into a meeting that exists.
 *
 * WHY THIS EXISTS. "Meeting Preparation" wrote an excellent agenda and then
 * stopped, which left the EA to open Google Calendar, retype the title, retype
 * the times, paste the agenda in, and remember to add a Meet link. The prep was
 * the easy half. This books the event, attaches the room, and puts the agenda
 * that was just written into the description, so the thing the assistant
 * produced and the thing the attendees receive are the same thing.
 *
 * It is the sibling of PlanProposals: that one books blocks a model proposed,
 * this one books the single meeting a person described. Both go through
 * calendar-create-event, which is the only path that writes to a calendar.
 *
 * ── NOTHING IS BOOKED WITHOUT A CLICK ────────────────────────────────────
 * Generating an agenda must never send a calendar invitation on its own. The
 * attendees are real people and the invitation lands in their inbox; that is an
 * outward-facing act and it waits for somebody to mean it.
 */

/** Minutes from the value DurationSlider stores ("1 hour 30 minutes", "45"). */
function minutesFrom(value: string): number | null {
  if (!value) return null;
  const h = value.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/i);
  const m = value.match(/(\d+)\s*(?:minutes?|mins?|m)\b/i);
  if (h || m) return Math.round((h ? parseFloat(h[1]) * 60 : 0) + (m ? +m[1] : 0));
  const bare = value.match(/^\s*(\d+)\s*$/);
  return bare ? +bare[1] : null;
}

/** Addresses that are actually addresses. Anything else is dropped, not sent. */
function emailsFrom(value: string): string[] {
  return (value ?? "")
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(s));
}

export function BookMeeting({ values, agenda, tz }: {
  /** The Meeting Preparation form, as filled in. */
  values: Record<string, string>;
  /** What the model just wrote. Becomes the event description. */
  agenda: string;
  /** The calendar's zone, so 14:00 means 14:00 where the calendar lives. */
  tz: string;
}) {
  const { data: google } = useGoogleConnection();
  const create = useCreateCalendarEvent();
  const [done, setDone] = useState<CreatedEvent | null>(null);
  const [error, setError] = useState("");
  const [connectError, setConnectError] = useState<string | null>(null);
  const [withMeet, setWithMeet] = useState(true);

  const title = (values.meeting ?? "").trim();
  const date = values.date ?? "";
  const time = values.time ?? "";
  const mins = minutesFrom(values.duration ?? "");
  const invitees = emailsFrom(values.attendees ?? "");

  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const validTime = /^\d{2}:\d{2}$/.test(time);
  /* Everything the booking needs, listed rather than reduced to one boolean, so
     the panel can say WHICH part is missing instead of just refusing. */
  const missing = [
    !title && "a name",
    !validDate && "a date",
    !validTime && "a start time",
    !mins && "a length",
  ].filter(Boolean) as string[];

  const canBook = google?.canCreate && missing.length === 0;

  async function book() {
    if (!validDate || !validTime || !mins) return;
    setError("");
    try {
      const startsAt = instantFor(date, time, tz);
      const res = await create.mutateAsync({
        title,
        startsAt,
        endsAt: endInstant(startsAt, mins),
        timeZone: tz,
        /* The agenda goes in as written. An attendee opening the invitation
           gets the same preparation the assistant just produced, rather than a
           title and a blank body. */
        description: agenda || undefined,
        attendees: invitees.length ? invitees : undefined,
        addMeet: withMeet,
      });
      setDone(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the event.");
    }
  }

  // ── booked ─────────────────────────────────────────────────────────────
  if (done) {
    return (
      <div className="mt-3 rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3">
        <p className="flex items-center gap-2 text-sm font-medium text-emerald-300">
          <Check size={15} /> In the calendar
          {invitees.length > 0 && (
            <span className="font-normal text-emerald-200/70">
              · {invitees.length} {invitees.length === 1 ? "invitation" : "invitations"} sent
            </span>
          )}
        </p>

        <div className="mt-2 flex flex-wrap gap-2">
          {done.hangoutLink && (
            <a
              href={done.hangoutLink}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-ghost border border-emerald-500/40 px-2.5 py-1 text-xs text-emerald-200"
            >
              <Video size={13} /> Join with Google Meet
            </a>
          )}
          {done.htmlLink && (
            <a
              href={done.htmlLink}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-ghost border border-border px-2.5 py-1 text-xs"
            >
              <ExternalLink size={13} /> Open in Google Calendar
            </a>
          )}
        </div>

        {/* Asked for a room and did not get one. Said plainly, because the
            alternative is an invitation to a call with nowhere to call. */}
        {done.meetMissing && (
          <p className="mt-2 flex items-start gap-2 text-xs text-amber-300">
            <VideoOff size={13} className="mt-0.5 shrink-0" />
            The event was created but Google did not attach a Meet link. A Workspace policy can
            forbid it. Add a joining link by hand before anyone tries to dial in.
          </p>
        )}

        {done.warning && <p className="mt-2 text-xs text-amber-300">{done.warning}</p>}
      </div>
    );
  }

  // ── not booked yet ─────────────────────────────────────────────────────
  return (
    <div className="mt-3 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <p className="field-label !mb-0">Put it in the calendar</p>
        {validDate && (
          <span className="text-[11px] text-faint">
            {date}{validTime ? ` ${time}` : ""} · {zoneLabel(tz, date)}
          </span>
        )}
      </div>

      {missing.length > 0 ? (
        <p className="mt-2 text-[12.5px] text-muted">
          Add {missing.join(", ")} above and this becomes bookable. The agenda is yours either way.
        </p>
      ) : (
        <p className="mt-2 text-[12.5px] text-muted">
          Books <span className="text-zinc-200">{title}</span> for {mins} minutes
          {invitees.length > 0
            ? <> and invites <span className="text-zinc-200">{invitees.join(", ")}</span></>
            : <> with no invitations</>}
          . The agenda above goes in as the description.
        </p>
      )}

      <label className="mt-2.5 flex items-start gap-2 text-[12.5px]">
        <input
          type="checkbox"
          className="mt-0.5 accent-[color:var(--accent)]"
          checked={withMeet}
          onChange={(e) => setWithMeet(e.target.checked)}
        />
        <span>Add a Google Meet link</span>
      </label>

      {!google?.canCreate && (
        <p className="mt-2 flex items-start gap-2 text-[12.5px] text-amber-300">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            This Google connection cannot add events.{" "}
            <button
              className="underline underline-offset-2"
              onClick={() => void reconnectMail("gmail").then(setConnectError)}
            >
              Reconnect and allow calendar changes
            </button>
            {connectError && <span className="block text-red-300">{connectError}</span>}
          </span>
        </p>
      )}

      {error && (
        <p className="mt-2 flex items-start gap-2 text-[12.5px] text-red-300">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {error}
        </p>
      )}

      <button
        className="btn-primary mt-3 px-3 py-1.5 text-xs"
        disabled={!canBook || create.isPending}
        onClick={() => void book()}
      >
        {create.isPending
          ? <><Loader2 size={13} className="animate-spin" /> Creating…</>
          : <><CalendarPlus size={13} /> Create event{withMeet ? " + Meet link" : ""}</>}
      </button>
    </div>
  );
}
