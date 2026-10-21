import { useCallback, useEffect, useMemo, useState } from "react";
import { useDirtyGuard } from "@/hooks/useDirtyGuard";
import { X, Loader2, CheckCircle2, AlertTriangle, ExternalLink, Link2 } from "lucide-react";
import { useClients, useCreateCalendarEvent } from "@/data/hooks";
import { reconnectMail } from "@/hooks/useSendEmail";
import { type DayKey, dayLabel, dayKeyOf, timeLabel, zoneLabel } from "@/lib/calendarTime";
import { instantFor } from "@/lib/workday";
import { timeZones } from "@/lib/timezones";
import { isValidZone, zoneCity } from "@/lib/userTimeZone";

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
 *
 * AND YOU CAN PICK ANOTHER ONE (Reich's testing, 20 Oct 2026). Booking across
 * countries means typing "9am" and meaning the CLIENT's 9am. The zone selector
 * defaults to the zone the calendar is showing (yours, when you set one in
 * Settings), offers the client's zone in one click, and states the other side's
 * clock under the times so nobody has to do the arithmetic.
 */
export function NewEventDialog({
  day, tz: calendarTz, myTz, canCreate, onClose,
}: {
  day: DayKey;
  /** The zone the calendar is drawn in. The form's default. */
  tz: string;
  /** Your zone from Settings (or the computer's). Offered as a quick option. */
  myTz: string;
  /** False when the connection can read the calendar but not add to it. */
  canCreate: boolean;
  onClose: () => void;
}) {
  const create = useCreateCalendarEvent();
  const { data: clients = [] } = useClients();
  /* Only for the time hint and the quick zone option: Google has no notion of
     a MadeEA client, so nothing about the client is sent with the event. */
  const [clientId, setClientId] = useState("");
  const [tz, setTz] = useState(calendarTz);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState<DayKey>(day);
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("09:30");
  const [location, setLocation] = useState("");
  const [attendees, setAttendees] = useState("");
  const [description, setDescription] = useState("");
  const [connectError, setConnectError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [nudge, setNudge] = useState(false);
  const { ref, isDirty } = useDirtyGuard(true);

  useEffect(() => { setDate(day); }, [day]);

  /* A half-filled event is real work. Clicking beside the dialog used to throw
     it away with no warning, which is a lot of damage for a stray click. */
  const attemptClose = useCallback(() => {
    if (isDirty()) { setConfirming(true); return; }
    onClose();
  }, [isDirty, onClose]);

  useEffect(() => {
    if (!nudge) return;
    const t = setTimeout(() => setNudge(false), 2600);
    return () => clearTimeout(t);
  }, [nudge]);

  /* Escape is handled here rather than by the page, so it asks instead of
     discarding. The page's own handler still closes a clean dialog. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (isDirty()) { e.stopPropagation(); setConfirming(true); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [isDirty]);

  /* A wall-clock time in a named zone is not a Date. The naive
     `new Date("2026-08-24T09:00")` is the BROWSER's 9am, which for a Manila
     calendar viewed from Denver is fifteen hours out. instantFor asks the zone
     what offset it is at on that date (DST included); it is the one shared
     copy, which this dialog used to duplicate. */
  const timesOk = /^\d{2}:\d{2}$/.test(start) && /^\d{2}:\d{2}$/.test(end) && /^\d{4}-\d{2}-\d{2}$/.test(date);
  const startsAt = timesOk ? instantFor(date, start, tz) : "";
  const endsAt = timesOk ? instantFor(date, end, tz) : "";
  const invalid = !timesOk || new Date(endsAt) <= new Date(startsAt);

  const withZone = useMemo(
    () => clients.filter((c) => isValidZone(c.timezone)).sort((a, b) => a.name.localeCompare(b.name)),
    [clients],
  );
  const client = withZone.find((c) => c.id === clientId) ?? null;
  const clientTz = client && isValidZone(client.timezone) ? client.timezone : null;
  const zones = useMemo(() => {
    const all = timeZones();
    const extra = [calendarTz, myTz, clientTz].filter((z): z is string => !!z && !all.includes(z));
    return [...new Set(extra), ...all];
  }, [calendarTz, myTz, clientTz]);

  /* "That's 9:00 AM in Dubai (Acme Ltd)". The date is added when the other
     side is already on a different day, which is exactly the case that books
     someone at 1am. */
  function elsewhere(zone: string): string | null {
    if (!startsAt || invalid || zone === tz) return null;
    const otherDay = dayKeyOf(startsAt, zone);
    const dayNote = otherDay !== date ? ` on ${dayLabel(otherDay, { weekday: "short", day: "numeric", month: "short" })}` : "";
    return `${timeLabel(startsAt, zone)} to ${timeLabel(endsAt, zone)}${dayNote}`;
  }
  const clientLine = clientTz ? elsewhere(clientTz) : null;
  const myLine = myTz !== clientTz ? elsewhere(myTz) : null;

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
    <div
      className="fixed inset-0 z-40 grid place-items-center bg-black/50 p-4"
      onClick={() => { if (isDirty()) setNudge(true); else onClose(); }}
    >
      <form
        ref={ref as React.RefObject<HTMLFormElement>}
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
              Added to your Google Calendar. Times below are in {zoneCity(tz)} ({zoneLabel(tz, date)}).
            </p>
          </div>
          <button type="button" className="btn-ghost grid h-7 w-7 place-items-center p-0" onClick={attemptClose} aria-label="Close">
            <X size={15} />
          </button>
        </div>

        {confirming && (
          <div role="alertdialog" aria-label="Discard this event?"
               className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-2.5 text-[12.5px] text-amber-200">
            <span className="min-w-0 flex-1">This event has not been added yet.</span>
            <button type="button" className="btn-ghost border border-amber-500/40 px-2 py-1 text-[11.5px]" onClick={() => setConfirming(false)}>
              Keep editing
            </button>
            <button type="button" className="btn-primary px-2 py-1 text-[11.5px]" onClick={onClose}>Discard</button>
          </div>
        )}
        {nudge && !confirming && (
          <p role="status" className="mb-3 rounded-xl border border-border bg-surface-2 p-2 text-[12px] text-muted">
            Still here. Use Close or Escape to leave.
          </p>
        )}

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

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div>
                  <label className="field-label" htmlFor="ev-tz">Time zone</label>
                  <select id="ev-tz" className="input" value={tz} onChange={(e) => setTz(e.target.value)}>
                    {zones.map((z) => (
                      <option key={z} value={z}>{z.replace(/_/g, " ")} ({zoneLabel(z, date)})</option>
                    ))}
                  </select>
                </div>
                {withZone.length > 0 && (
                  <div>
                    <label className="field-label" htmlFor="ev-client">Client</label>
                    <select id="ev-client" className="input" value={clientId} onChange={(e) => setClientId(e.target.value)}>
                      <option value="">None</option>
                      {withZone.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* One-click zones: yours and the client's. */}
              {(tz !== myTz || (clientTz && tz !== clientTz)) && (
                <div className="flex flex-wrap gap-1.5">
                  {tz !== myTz && (
                    <button type="button" className="btn-ghost border border-border px-2 py-1 text-[11.5px]" onClick={() => setTz(myTz)}>
                      Use mine ({zoneCity(myTz)})
                    </button>
                  )}
                  {client && clientTz && tz !== clientTz && (
                    <button type="button" className="btn-ghost border border-border px-2 py-1 text-[11.5px]" onClick={() => setTz(clientTz)}>
                      Use {client.name}'s ({zoneCity(clientTz)})
                    </button>
                  )}
                </div>
              )}

              {(clientLine || myLine) && (
                <div className="space-y-0.5 rounded-lg bg-surface-2 px-2 py-1.5 text-[12px] text-muted">
                  {client && clientTz && clientLine && (
                    <p>That's {clientLine} in {zoneCity(clientTz)} ({client.name}).</p>
                  )}
                  {myLine && <p>That's {myLine} for you ({zoneCity(myTz)}).</p>}
                </div>
              )}

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
