import { useEffect, useMemo, useState } from "react";
import { X, Loader2, CheckCircle2, AlertTriangle, ExternalLink, Link2 } from "lucide-react";
import { useCreateCalendarEvent } from "@/data/hooks";
import { reconnectMail } from "@/hooks/useSendEmail";
import { type DayKey, dayLabel, zoneLabel } from "@/lib/calendarTime";

/**
 * Booking something, for real, on Google.
 *
 * WHAT THIS ANSWERS. "Plan the Calendar" could describe a better day and then
 * leave you to type all of it into Google by hand, which is most of the work it
 * claimed to save. A calendar you can read and not write is a report.
 *
 * THE TIMES ARE IN THE CALENDAR'S ZONE. The fields say 3pm and mean 3pm where
 * the calendar lives, which is the same 3pm the rest of the page shows and the
 * same one Google will show. Reading these as the laptop's zone is how you book
 * a Manila meeting for the middle of the night.
 */
export function NewEventDialog({
  day, tz, canCreate, onClose,
}: {
  day: DayKey;
  tz: string;
  /** False when the connection can read the calendar but not add to it. */
  canCreate: boolean;
  onClose: () => void;
}) {
  const create = useCreateCalendarEvent();
  const [title, setTitle] = useState("");
  const [date, setDate] = useState<DayKey>(day);
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("09:30");
  const [location, setLocation] = useState("");
  const [attendees, setAttendees] = useState("");
  const [description, setDescription] = useState("");
  const [connectError, setConnectError] = useState<string | null>(null);

  useEffect(() => { setDate(day); }, [day]);

  /* A wall-clock time in a named zone is not a Date. Build the instant by
     asking what offset that zone is at on that date, then subtracting it: the
     naive `new Date("2026-08-24T09:00")` is the BROWSER's 9am, which for a
     Manila calendar viewed from Denver is fifteen hours out. */
  const toInstant = useMemo(() => (d: DayKey, hhmm: string): string => {
    const [h, m] = hhmm.split(":").map(Number);
    const [y, mo, dd] = d.split("-").map(Number);
    const guess = Date.UTC(y, mo - 1, dd, h, m);
    const seen = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(new Date(guess));
    const p = Object.fromEntries(seen.map((x) => [x.type, x.value])) as Record<string, string>;
    const asZone = Date.UTC(+p.year, +p.month - 1, +p.day, Number(p.hour) % 24, +p.minute);
    return new Date(guess - (asZone - guess)).toISOString();
  }, [tz]);

  const startsAt = toInstant(date, start);
  const endsAt = toInstant(date, end);
  const invalid = new Date(endsAt) <= new Date(startsAt);
  const ready = title.trim().length > 0 && !invalid && !create.isPending && canCreate;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    await create.mutateAsync({
      title: title.trim(),
      startsAt, endsAt, timeZone: tz,
      location: location.trim() || undefined,
      description: description.trim() || undefined,
      attendees: attendees.split(/[,\s]+/).map((a) => a.trim()).filter(Boolean),
    }).catch(() => { /* surfaced from create.error below */ });
  }

  const done = create.isSuccess ? create.data : null;

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="card w-full max-w-md p-4"
        role="dialog"
        aria-modal="true"
        aria-label="New event"
      >
        <div className="mb-3 flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold">New event</h3>
            <p className="mt-0.5 text-[11.5px] text-faint">
              Added to your Google Calendar, in {zoneLabel(tz, date)} ({tz.split("/").pop()?.replace(/_/g, " ")}).
            </p>
          </div>
          <button type="button" className="btn-ghost grid h-7 w-7 place-items-center p-0" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </div>

        {!canCreate && (
          <Notice>
            This Google connection can read your calendar but not add to it.{" "}
            <button type="button" className="underline underline-offset-2" onClick={() => void reconnectMail("gmail").then(setConnectError)}>
              <Link2 size={11} className="inline" /> Reconnect and allow calendar changes
            </button>
          </Notice>
        )}
        {connectError && <Notice>{connectError}</Notice>}

        {done ? (
          <div className="py-4 text-center">
            <CheckCircle2 size={22} className="mx-auto mb-2 text-emerald-300" />
            <p className="text-sm font-medium">Added to Google Calendar.</p>
            {done.warning && <p className="mt-1 text-[12px] text-amber-300">{done.warning}</p>}
            <div className="mt-3 flex justify-center gap-1.5">
              {done.htmlLink && (
                <a href={done.htmlLink} target="_blank" rel="noreferrer" className="btn-ghost border border-border px-2.5 py-1.5 text-xs">
                  <ExternalLink size={13} /> Open in Google
                </a>
              )}
              <button type="button" className="btn-primary px-2.5 py-1.5 text-xs" onClick={onClose}>Done</button>
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-2.5">
              <div>
                <label className="field-label" htmlFor="ev-title">Title</label>
                <input
                  id="ev-title" className="input" value={title} autoFocus
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Client check-in"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-3 sm:col-span-1">
                  <label className="field-label" htmlFor="ev-date">Date</label>
                  <input id="ev-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value as DayKey)} />
                </div>
                <div>
                  <label className="field-label" htmlFor="ev-start">Start</label>
                  <input id="ev-start" type="time" className="input" value={start} onChange={(e) => setStart(e.target.value)} />
                </div>
                <div>
                  <label className="field-label" htmlFor="ev-end">End</label>
                  <input id="ev-end" type="time" className="input" value={end} onChange={(e) => setEnd(e.target.value)} />
                </div>
              </div>

              <div>
                <label className="field-label" htmlFor="ev-guests">Guests</label>
                <input
                  id="ev-guests" className="input" value={attendees}
                  onChange={(e) => setAttendees(e.target.value)}
                  placeholder="Comma separated email addresses"
                />
                <p className="mt-1 text-[11px] text-faint">They are invited and emailed by Google, as with any invitation.</p>
              </div>

              <div>
                <label className="field-label" htmlFor="ev-loc">Location</label>
                <input id="ev-loc" className="input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Optional" />
              </div>

              <div>
                <label className="field-label" htmlFor="ev-desc">Description</label>
                <textarea id="ev-desc" className="input min-h-[60px] resize-none" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
              </div>
            </div>

            {invalid && <p className="mt-2 text-[12.5px] text-amber-300">The end time must be after the start time.</p>}
            {create.isError && <Notice>{(create.error as Error).message}</Notice>}

            <p className="mt-2 text-[11.5px] text-faint">
              {dayLabel(date, { weekday: "long", day: "numeric", month: "long" })}, {start} to {end} {zoneLabel(tz, date)}
            </p>

            <button className="btn-primary mt-3 w-full justify-center py-2.5" disabled={!ready}>
              {create.isPending ? <><Loader2 size={14} className="animate-spin" /> Adding…</> : "Add to Google Calendar"}
            </button>
          </>
        )}
      </form>
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 flex items-start gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/5 p-2 text-[12.5px] text-amber-200">
      <AlertTriangle size={13} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
