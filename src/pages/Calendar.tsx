import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChevronLeft, ChevronRight, RefreshCw, Link2, MapPin, Users,
  ExternalLink, Sparkles, AlertTriangle, CalendarDays,
} from "lucide-react";
import { PageHeader } from "@/components/ui";
import {
  useCalendarEvents, useCalendarSync, useGoogleConnection, type CalendarEvent,
} from "@/data/hooks";
import { reconnectMail } from "@/hooks/useSendEmail";
import { cn } from "@/lib/utils";

/**
 * The month, and one day inside it.
 *
 * WHAT THIS IS FOR. Not "look at a grid". An EA opens a calendar to answer two
 * questions: what is happening today, and where is there room. So the month is
 * the navigation and the day is the content, rather than a wall of small boxes
 * with truncated titles that has to be clicked to be useful.
 *
 * EVERYTHING HERE IS REAL. Events come from Google through calendar-sync. When
 * the connection is missing, or covers Gmail but not Calendar, the page says
 * which rather than rendering an empty month that looks like a free fortnight.
 * A monitoring product that invents a quiet week is worse than one that admits
 * it cannot see.
 */

const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const endOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const key = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/* "5a", "1:30p". A month cell is about fifty pixels wide, and "5:00 AM" spends
   every one of them on the time: the first render showed "5:00 ..." with the
   title cut off completely, so the grid said when something happened and never
   what it was. The agenda beside it carries the full time. */
const compactTime = (iso: string) => {
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes();
  const suffix = h < 12 ? "a" : "p";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12}${suffix}` : `${h12}:${String(m).padStart(2, "0")}${suffix}`;
};

/** "45 min", "2 hr 30 min", or nothing when the event has no end. */
function duration(e: CalendarEvent): string | null {
  if (e.all_day) return "All day";
  if (!e.ends_at) return null;
  const mins = Math.round((new Date(e.ends_at).getTime() - new Date(e.starts_at).getTime()) / 60000);
  if (mins <= 0) return null;
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

export default function Calendar() {
  /* reconnectMail RETURNS the reason it could not start, rather than throwing
     or navigating. Dropping that on the floor is what makes a Connect button
     that does nothing at all when a provider is misconfigured. */
  const [connectError, setConnectError] = useState<string | null>(null);
  const [cursor, setCursor] = useState(() => new Date());
  const [selected, setSelected] = useState(() => new Date());
  const nav = useNavigate();

  const from = startOfMonth(cursor).toISOString();
  const to = endOfMonth(cursor).toISOString();
  const { data: events = [], isLoading, isError } = useCalendarEvents(from, to);
  const { data: google } = useGoogleConnection();
  const sync = useCalendarSync();

  const byDay = useMemo(() => {
    const m = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      const k = key(new Date(e.starts_at));
      m.set(k, [...(m.get(k) ?? []), e]);
    }
    return m;
  }, [events]);

  /* Six weeks from the Sunday on or before the 1st. Always six, so the grid
     does not change height between months and the day under the cursor does
     not move when you page through. */
  const cells = useMemo(() => {
    const first = startOfMonth(cursor);
    const gridStart = new Date(first);
    gridStart.setDate(first.getDate() - first.getDay());
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      return d;
    });
  }, [cursor]);

  const dayEvents = byDay.get(key(selected)) ?? [];
  const today = new Date();

  function move(months: number) {
    const next = new Date(cursor.getFullYear(), cursor.getMonth() + months, 1);
    setCursor(next);
  }

  /* Hands the day's real commitments to the planner, so the field that asks
     "what has to be worked around" is not typed out from memory. This is the
     whole point of the calendar living in the same product as the actions. */
  function planThisDay() {
    const lines = dayEvents.map((e) => {
      const d = duration(e);
      return `${e.all_day ? "All day" : time(e.starts_at)} ${e.title}${d && !e.all_day ? ` (${d})` : ""}`;
    });
    const params = new URLSearchParams({
      action: "Plan the Calendar",
      output: "Reorder today",
      constraints: lines.length
        ? `On ${selected.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })} I already have:\n${lines.join("\n")}`
        : `${selected.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })} is currently clear.`,
    });
    nav(`/quick-actions?${params}`);
  }

  function prepare(e: CalendarEvent) {
    const params = new URLSearchParams({
      action: "Meeting Preparation",
      output: "Pre-read brief",
      meeting: e.title,
      topics: [
        e.attendee_emails.length ? `Attendees: ${e.attendee_emails.join(", ")}` : "",
        e.location ? `Location: ${e.location}` : "",
        e.description?.trim() ? `From the invite:\n${e.description.trim().slice(0, 800)}` : "",
      ].filter(Boolean).join("\n\n"),
      length: duration(e) ?? "",
    });
    nav(`/quick-actions?${params}`);
  }

  const monthLabel = cursor.toLocaleDateString([], { month: "long", year: "numeric" });

  return (
    <div>
      <PageHeader title="Calendar" subtitle="Your Google Calendar, in the same place as the work it creates" />

      {/* Connection state before anything else. An empty grid and a grid we
          cannot read look identical, and only one of them means a free month. */}
      {google && !google.connected && (
        <Notice>
          No Google account is connected, so there is nothing to show here.{" "}
          <button
            className="underline underline-offset-2"
            onClick={() => void reconnectMail("gmail").then(setConnectError)}
          >
            <Link2 size={11} className="inline" /> Connect Google
          </button>
        </Notice>
      )}
      {google?.connected && !google.calendar && (
        <Notice>
          This Google connection covers email but not calendar, so no events can be read.{" "}
          <button
            className="underline underline-offset-2"
            onClick={() => void reconnectMail("gmail").then(setConnectError)}
          >
            Reconnect and allow calendar access
          </button>
        </Notice>
      )}
      {connectError && <Notice>{connectError}</Notice>}
      {isError && <Notice>Could not load events. This is a read failure, not an empty calendar.</Notice>}
      {sync.isError && <Notice>{(sync.error as Error)?.message}</Notice>}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button className="btn-ghost grid h-8 w-8 place-items-center border border-border p-0" onClick={() => move(-1)} aria-label="Previous month">
            <ChevronLeft size={15} />
          </button>
          <button className="btn-ghost grid h-8 w-8 place-items-center border border-border p-0" onClick={() => move(1)} aria-label="Next month">
            <ChevronRight size={15} />
          </button>
        </div>
        <h2 className="text-base font-semibold tabular-nums">{monthLabel}</h2>
        <button
          className="btn-ghost border border-border px-2.5 py-1.5 text-xs"
          onClick={() => { setCursor(new Date()); setSelected(new Date()); }}
        >
          Today
        </button>

        <button
          className="btn-ghost ml-auto border border-border px-2.5 py-1.5 text-xs"
          onClick={() => sync.mutate({ timeMin: from, timeMax: to })}
          disabled={sync.isPending || !google?.calendar}
          title={google?.calendar ? "Pull this month again from Google" : "Calendar access is not granted"}
        >
          <RefreshCw size={13} className={sync.isPending ? "animate-spin" : ""} />
          {sync.isPending ? "Syncing…" : "Sync this month"}
        </button>
      </div>

      {sync.isSuccess && !sync.isPending && (
        <p className="mb-3 text-[12.5px] text-emerald-300">
          Synced {sync.data.synced} of {sync.data.scanned} events from Google for {monthLabel}.
        </p>
      )}

      {/* The grid needs the room. At 1.55fr the day cells were about fifty
          pixels wide, which is not enough to name an event. */}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,2.1fr)_minmax(0,1fr)]">
        <div className="card p-3">
          <div className="mb-1 grid grid-cols-7 gap-1">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <div key={d} className="px-1 py-1 text-center text-[11px] font-medium text-faint">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((d) => {
              const list = byDay.get(key(d)) ?? [];
              const outside = d.getMonth() !== cursor.getMonth();
              const isToday = sameDay(d, today);
              const isSelected = sameDay(d, selected);
              return (
                <button
                  key={d.toISOString()}
                  onClick={() => setSelected(new Date(d))}
                  aria-label={`${d.toDateString()}, ${list.length} event${list.length === 1 ? "" : "s"}`}
                  aria-pressed={isSelected}
                  className={cn(
                    "min-h-[74px] rounded-lg border p-1.5 text-left transition-colors",
                    isSelected ? "border-accent ring-1 ring-accent" : "border-border hover:border-[var(--border-strong)]",
                    outside ? "opacity-40" : "",
                  )}
                >
                  <span className={cn(
                    "inline-grid h-5 min-w-5 place-items-center rounded-full px-1 text-[11px] font-semibold tabular-nums",
                    isToday ? "bg-accent text-white" : "text-faint",
                  )}>
                    {d.getDate()}
                  </span>
                  <span className="mt-1 block space-y-0.5">
                    {list.slice(0, 2).map((e) => (
                      <span key={e.id} className="flex items-baseline gap-1 rounded bg-surface-2 px-1 py-0.5 text-[10.5px] leading-tight">
                        {!e.all_day && (
                          <span className="shrink-0 tabular-nums text-faint">{compactTime(e.starts_at)}</span>
                        )}
                        <span className="truncate">{e.title}</span>
                      </span>
                    ))}
                    {list.length > 2 && (
                      <span className="block px-1 text-[10px] text-faint">+{list.length - 2} more</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="lg:sticky lg:top-4 lg:self-start">
          <div className="card p-4">
            <div className="mb-3 flex flex-wrap items-baseline gap-2">
              <h3 className="text-sm font-semibold">
                {selected.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}
              </h3>
              <span className="text-xs tabular-nums text-faint">
                {dayEvents.length} event{dayEvents.length === 1 ? "" : "s"}
              </span>
              <button
                className="btn-ghost ml-auto border border-border px-2.5 py-1.5 text-xs"
                onClick={planThisDay}
                title="Open the planner with this day's commitments already filled in"
              >
                <Sparkles size={13} /> Plan this day
              </button>
            </div>

            {isLoading ? (
              <p className="text-sm text-faint">Loading…</p>
            ) : dayEvents.length === 0 ? (
              <div className="py-8 text-center">
                <CalendarDays size={22} className="mx-auto mb-2 text-faint" />
                <p className="text-sm font-medium">Nothing scheduled.</p>
                <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-faint">
                  {google?.calendar
                    ? "This day is clear in the events synced from Google. Sync the month if you have added something since."
                    : "Nothing has been synced from Google for this day."}
                </p>
              </div>
            ) : (
              <ul className="space-y-2">
                {dayEvents.map((e) => (
                  <li key={e.id} className="rounded-lg border border-border p-2.5">
                    <div className="flex items-baseline gap-2">
                      <span className="text-xs font-semibold tabular-nums text-accent-soft">
                        {e.all_day ? "All day" : time(e.starts_at)}
                      </span>
                      {duration(e) && !e.all_day && (
                        <span className="text-[11px] text-faint">{duration(e)}</span>
                      )}
                      {e.client_name && (
                        <span className="ml-auto truncate text-[11px] text-faint">{e.client_name}</span>
                      )}
                    </div>
                    <p className="mt-0.5 text-sm font-medium leading-snug">{e.title}</p>

                    {e.location && (
                      <p className="mt-1 flex items-center gap-1 text-[11.5px] text-faint">
                        <MapPin size={11} className="shrink-0" /> <span className="truncate">{e.location}</span>
                      </p>
                    )}
                    {e.attendee_emails.length > 0 && (
                      <p className="mt-0.5 flex items-center gap-1 text-[11.5px] text-faint">
                        <Users size={11} className="shrink-0" />
                        <span className="truncate">
                          {e.attendee_emails.length} attendee{e.attendee_emails.length === 1 ? "" : "s"}
                        </span>
                      </p>
                    )}

                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <button className="btn-ghost border border-border px-2 py-1 text-[11.5px]" onClick={() => prepare(e)}>
                        <Sparkles size={12} /> Prepare
                      </button>
                      {e.html_link && (
                        <a
                          href={e.html_link} target="_blank" rel="noreferrer"
                          className="btn-ghost border border-border px-2 py-1 text-[11.5px]"
                        >
                          <ExternalLink size={12} /> Open in Google
                        </a>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p className="card mb-3 flex items-start gap-2 border-amber-500/40 bg-amber-500/5 p-2.5 text-[12.5px] text-amber-200">
      <AlertTriangle size={13} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
