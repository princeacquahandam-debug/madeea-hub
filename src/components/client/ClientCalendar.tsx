import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, ChevronLeft, ChevronRight, MapPin, Video, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { MonthView, TimeGridView, type CalendarItem } from "@/components/calendar/views";
import {
  addDays, addMonths, dayKeyOf, dayLabel as dayKeyLabel, rangeOfDays, startOfMonthKey, startOfWeek,
  timeLabel, todayKey, weekdayOf, zoneLabel, type DayKey,
} from "@/lib/calendarTime";
import type { CalendarEvent } from "@/data/hooks";
import { cn } from "@/lib/utils";
import { clockTime, dateOnly, dayLabel, localDayKey } from "./format";
import { CLIENT_LAST_SYNC_KEY, syncClientCalendar } from "./ClientIntegrations";

/**
 * The calendar, reflected to the client. Rowena's opening ask (0:18): "syempre,
 * ang calendar na mag-re-reflect kay Client."
 *
 * MONTH, WEEK, OR AGENDA. It was an agenda only, on the view that a client
 * just wants "what is booked, and when". Clients asked for the calendar the
 * agency sees, so the same Month and Week grids are here (the agency's own
 * components, not copies), and the agenda stays as the third view and the
 * default on a phone, where a grid of tiny days is the wrong shape.
 *
 * WHAT IS NOT HERE is decided in 0073, not in this file: attendees, the agenda
 * description, the organiser and the Google event link never reach the browser,
 * because client_calendar does not select them. The Meet room does, since a
 * client who cannot join their own call is being shown a calendar for nothing.
 */

interface EventRow {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  location: string | null;
  event_timezone: string | null;
  hangout_link: string | null;
}

type View = "month" | "week" | "agenda";
/** How stale a connected Google Calendar may get before opening this tab refreshes it. */
const AUTO_SYNC_MS = 30 * 60 * 1000;
const VIEW_KEY = "madeea-client-calendar-view";
const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

function initialView(): View {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    if (v === "month" || v === "week" || v === "agenda") return v;
  } catch { /* storage blocked */ }
  return typeof window !== "undefined" && window.innerWidth < 768 ? "agenda" : "month";
}

export function ClientCalendar() {
  const [view, setViewState] = useState<View>(initialView);
  const setView = (v: View) => { setViewState(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* storage blocked */ } };
  const [anchor, setAnchor] = useState<DayKey>(() => todayKey(browserTz));
  const [open, setOpen] = useState<EventRow | null>(null);
  const qc = useQueryClient();

  /* If the client connected their Google Calendar (Connected accounts), bring
     it up to date when they open this tab, at most every half hour. Quiet on
     failure: the tab still shows what is already here, and Connected
     accounts is where a sync error is explained. */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const last = Number(localStorage.getItem(CLIENT_LAST_SYNC_KEY) ?? 0);
        if (Date.now() - last < AUTO_SYNC_MS) return;
      } catch { /* storage blocked: sync anyway */ }
      const { data: auth } = await supabase!.auth.getUser();
      if (!auth.user || cancelled) return;
      const { data: cred } = await supabase!.from("google_credentials").select("owner_id").eq("owner_id", auth.user.id).maybeSingle();
      if (!cred || cancelled) return;
      try {
        await syncClientCalendar();
        if (!cancelled) void qc.invalidateQueries({ queryKey: ["client-portal", "calendar"] });
      } catch { /* see above */ }
    })();
    return () => { cancelled = true; };
  }, [qc]);

  /* The span on screen. Month is the 6-week grid; agenda is the next 60 days
     from the start of today (a meeting that began an hour ago is the one most
     likely to be looked up). */
  const { days, from, to, title } = useMemo(() => {
    if (view === "week") {
      const d = rangeOfDays(startOfWeek(anchor), 7);
      return { days: d, from: d[0], to: d[6],
        title: `${dayKeyLabel(d[0], { day: "numeric", month: "short" })} to ${dayKeyLabel(d[6], { day: "numeric", month: "short", year: "numeric" })}` };
    }
    if (view === "agenda") {
      const start = todayKey(browserTz);
      return { days: [] as DayKey[], from: start, to: addDays(start, 60), title: "Next 60 days" };
    }
    const first = startOfMonthKey(anchor);
    const d = rangeOfDays(addDays(first, -weekdayOf(first)), 42);
    return { days: d, from: d[0], to: d[41], title: dayKeyLabel(first, { month: "long", year: "numeric" }) };
  }, [view, anchor]);

  const { data: events = [], isLoading } = useQuery({
    queryKey: ["client-portal", "calendar", from, to],
    queryFn: async () => {
      const { data, error } = await supabase!
        .from("client_calendar")
        .select("id, title, starts_at, ends_at, all_day, location, event_timezone, hangout_link")
        .gte("starts_at", new Date(`${from}T00:00:00Z`).toISOString())
        .lte("starts_at", new Date(`${to}T23:59:59Z`).toISOString())
        .order("starts_at", { ascending: true })
        .limit(300);
      if (error) throw error;
      return (data ?? []) as EventRow[];
    },
  });

  /* The calendar's own zone, as the agency Calendar does: "3pm" means the
     zone the meeting was booked in. The browser's zone only when none is known. */
  const tz = events.find((e) => e.event_timezone)?.event_timezone ?? browserTz;
  const today = todayKey(tz);

  const itemsByDay = useMemo(() => {
    const m = new Map<DayKey, CalendarItem[]>();
    for (const e of events) {
      const k = dayKeyOf(e.starts_at, tz);
      const item: CalendarItem = {
        kind: "event", id: e.id, title: e.title, at: e.starts_at, allDay: e.all_day,
        // The grid only reads id/title/times from it.
        event: { id: e.id, title: e.title, starts_at: e.starts_at, ends_at: e.ends_at, all_day: e.all_day } as unknown as CalendarEvent,
      };
      m.set(k, [...(m.get(k) ?? []), item]);
    }
    return m;
  }, [events, tz]);

  const openItem = (i: CalendarItem) => setOpen(events.find((e) => e.id === i.id) ?? null);
  const step = (dir: number) => setAnchor((a) => (view === "week" ? addDays(a, 7 * dir) : addMonths(a, dir)));

  return (
    <div className="space-y-4">
      {/* Toolbar: views, then navigation (not shown for the agenda). */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-xl border border-border p-0.5" role="group" aria-label="Calendar view">
          {(["month", "week", "agenda"] as View[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              aria-pressed={view === v}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition-colors",
                view === v ? "bg-accent text-white" : "text-muted hover:text-text",
              )}
            >
              {v}
            </button>
          ))}
        </div>
        {view !== "agenda" && (
          <div className="flex items-center gap-1.5">
            <button onClick={() => step(-1)} aria-label="Previous" className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted hover:text-text"><ChevronLeft size={16} /></button>
            <button onClick={() => setAnchor(todayKey(tz))} className="h-8 rounded-lg border border-border px-3 text-xs font-semibold text-muted hover:text-text">Today</button>
            <button onClick={() => step(1)} aria-label="Next" className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted hover:text-text"><ChevronRight size={16} /></button>
          </div>
        )}
        <p className="text-sm font-bold">{title}</p>
        <span className="pill ml-auto border border-border text-[11px] text-faint">{zoneLabel(tz, today)}</span>
      </div>

      {isLoading ? (
        <p className="text-faint text-sm">Loading…</p>
      ) : view === "month" ? (
        /* The month grid needs room; on a narrow phone it scrolls inside its own box. */
        <div className="overflow-x-auto">
          <div className="min-w-[640px]">
            <MonthView days={days} itemsByDay={itemsByDay} tz={tz} today={today} selected={anchor}
              onSelectDay={(d) => setAnchor(d)} onOpen={openItem} weekdays={[0, 1, 2, 3, 4, 5, 6]} />
          </div>
        </div>
      ) : view === "week" ? (
        <div className="overflow-x-auto">
          <div className="min-w-[640px]">
            <TimeGridView days={days} itemsByDay={itemsByDay} tz={tz} today={today} selected={anchor}
              onSelectDay={(d) => setAnchor(d)} onOpen={openItem} zoneLabel={zoneLabel(tz, today)} />
          </div>
        </div>
      ) : (
        <Agenda events={events} onOpen={(e) => setOpen(e)} />
      )}

      {view !== "agenda" && !isLoading && events.length === 0 && (
        <p className="text-faint text-sm">Nothing is booked in this period. Meetings your assistant schedules for you appear here.</p>
      )}

      {open && <Details e={open} tz={tz} onClose={() => setOpen(null)} />}
    </div>
  );
}

/* The agenda: what is booked, day by day. The original view, unchanged. */
function Agenda({ events, onOpen }: { events: EventRow[]; onOpen: (e: EventRow) => void }) {
  const days = useMemo(() => {
    const byKey = new Map<string, { key: string; events: EventRow[] }>();
    for (const e of events) {
      const key = localDayKey(e.starts_at);
      const day = byKey.get(key) ?? { key, events: [] };
      day.events.push(e);
      byKey.set(key, day);
    }
    return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
  }, [events]);

  if (days.length === 0) {
    return (
      <p className="text-faint text-sm">
        Nothing is booked on your account. Meetings your assistant schedules for you appear here.
      </p>
    );
  }
  return (
    <div className="space-y-4">
      {days.map((day) => (
        <section key={day.key}>
          <h3 className="text-faint mb-2 text-xs font-semibold uppercase tracking-wider">{dayLabel(dateOnly(day.key))}</h3>
          <ul className="space-y-2">
            {day.events.map((e) => (
              <li key={e.id}>
                <button onClick={() => onOpen(e)} className="flex w-full items-start gap-3 rounded-lg bg-surface-2 p-3 text-left hover:ring-1 hover:ring-accent/40">
                  <CalendarDays size={16} className="text-faint mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{e.title}</div>
                    <div className="text-faint mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      <span>{e.all_day ? "All day" : `${clockTime(e.starts_at)}${e.ends_at ? ` to ${clockTime(e.ends_at)}` : ""}`}</span>
                      {e.location ? <span className="flex items-center gap-1.5"><MapPin size={12} /> {e.location}</span> : null}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/* A meeting, opened from any view. */
function Details({ e, tz, onClose }: { e: EventRow; tz: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 sm:items-center sm:p-6" onClick={onClose}>
      <div role="dialog" aria-label={e.title} onClick={(ev) => ev.stopPropagation()} className="card w-full max-w-md rounded-b-none p-5 shadow-2xl sm:rounded-2xl">
        <div className="flex items-start gap-3">
          <p className="min-w-0 flex-1 text-lg font-extrabold leading-tight">{e.title}</p>
          <button onClick={onClose} aria-label="Close" className="text-faint hover:text-text"><X size={18} /></button>
        </div>
        <p className="mt-1.5 text-sm text-muted">
          {dayKeyLabel(dayKeyOf(e.starts_at, tz), { weekday: "long", day: "numeric", month: "long" })}
          {" · "}
          {e.all_day ? "All day" : `${timeLabel(e.starts_at, tz)}${e.ends_at ? ` to ${timeLabel(e.ends_at, tz)}` : ""}`}
        </p>
        {e.location && <p className="mt-2 flex items-center gap-1.5 text-sm text-muted"><MapPin size={14} /> {e.location}</p>}
        {e.hangout_link && (
          <a href={e.hangout_link} target="_blank" rel="noreferrer noopener" className="btn-primary mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 text-sm">
            <Video size={14} /> Join the call
          </a>
        )}
      </div>
    </div>
  );
}
