import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChevronLeft, ChevronRight, RefreshCw, Link2, MapPin, Users, Check,
  ExternalLink, Sparkles, AlertTriangle, CalendarDays, ChevronDown, X, Plus,
} from "lucide-react";
import { PageHeader } from "@/components/ui";
import {
  useCalendarEvents, useCalendarSync, useGoogleConnection, useTasks,
  type CalendarEvent,
} from "@/data/hooks";
import { reconnectMail } from "@/hooks/useSendEmail";
import {
  type DayKey, addDays, addMonths, dayKeyOf, dayLabel, rangeOfDays,
  startOfMonthKey, startOfWeek, todayKey, weekdayOf, zoneLabel, timeLabel,
} from "@/lib/calendarTime";
import {
  MonthView, TimeGridView, YearView, ScheduleView, type CalendarItem,
} from "@/components/calendar/views";
import { NewEventDialog } from "@/components/calendar/NewEventDialog";
import { cn } from "@/lib/utils";

/**
 * The calendar, in the shape Google made everyone fluent in.
 *
 * WHY COPY IT RATHER THAN INVENT. Nobody needs to learn a calendar. Day, week,
 * month, year and schedule, the keyboard letters that switch between them, and
 * the toggles for weekends, declined invitations and completed tasks are muscle
 * memory for anyone who has used a calendar this decade. A different
 * arrangement would cost all of that and buy nothing.
 *
 * THE ZONE IS THE PART THAT WAS ACTUALLY WRONG. Times render in the calendar's
 * timezone, labelled in the corner the way Google labels it. Before, they
 * rendered in whatever zone the laptop happened to be set to: a Manila team on
 * a machine in Mountain time saw 8pm meetings listed at 5am, and anything
 * within eight hours of midnight sat on the wrong DAY. The instant was always
 * right. The frame of reference was missing.
 *
 * ONE FILTER, EVERY VIEW. Weekends, declined events and completed tasks are
 * decided once here and handed down, so a meeting hidden in the month cannot
 * still be present in the week.
 */

type View = "day" | "week" | "month" | "year" | "schedule" | "four";

const VIEWS: { id: View; label: string; key: string }[] = [
  { id: "day", label: "Day", key: "D" },
  { id: "week", label: "Week", key: "W" },
  { id: "month", label: "Month", key: "M" },
  { id: "year", label: "Year", key: "Y" },
  { id: "schedule", label: "Schedule", key: "A" },
  { id: "four", label: "4 days", key: "X" },
];

const PREFS_KEY = "madeea-calendar-prefs";

interface Prefs {
  view: View;
  weekends: boolean;
  declined: boolean;
  completedTasks: boolean;
}
const DEFAULT_PREFS: Prefs = { view: "month", weekends: true, declined: true, completedTasks: true };

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : DEFAULT_PREFS;
  } catch {
    /* A remembered view is not worth a blank page. Private windows and blocked
       site data both throw on this. */
    return DEFAULT_PREFS;
  }
}

export default function Calendar() {
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [detail, setDetail] = useState<CalendarItem | null>(null);
  const [tzOverride, setTzOverride] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const nav = useNavigate();
  const menuRef = useRef<HTMLDivElement>(null);

  const { data: google } = useGoogleConnection();
  const { data: allTasks = [] } = useTasks();
  const sync = useCalendarSync();

  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [anchor, setAnchor] = useState<DayKey>(() => todayKey(browserTz));

  useEffect(() => {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* not worth failing over */ }
  }, [prefs]);

  /* The window this view needs, which is also what Sync asks Google for. Wider
     than what is drawn in month view, because that grid shows the tail of the
     previous month and the head of the next. */
  const { days, rangeFrom, rangeTo, title } = useMemo(() => {
    switch (prefs.view) {
      case "day":
        return { days: [anchor], rangeFrom: anchor, rangeTo: anchor,
          title: dayLabel(anchor, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) };
      case "four": {
        const d = rangeOfDays(anchor, 4);
        return { days: d, rangeFrom: d[0], rangeTo: d[3],
          title: `${dayLabel(d[0], { day: "numeric", month: "short" })} to ${dayLabel(d[3], { day: "numeric", month: "short", year: "numeric" })}` };
      }
      case "week": {
        const d = rangeOfDays(startOfWeek(anchor), 7);
        return { days: d, rangeFrom: d[0], rangeTo: d[6],
          title: `${dayLabel(d[0], { day: "numeric", month: "short" })} to ${dayLabel(d[6], { day: "numeric", month: "short", year: "numeric" })}` };
      }
      case "schedule": {
        const d = rangeOfDays(anchor, 30);
        return { days: d, rangeFrom: d[0], rangeTo: d[29],
          title: `${dayLabel(d[0], { day: "numeric", month: "long", year: "numeric" })}, next 30 days` };
      }
      case "year": {
        const y = anchor.slice(0, 4);
        return { days: [], rangeFrom: `${y}-01-01`, rangeTo: `${y}-12-31`, title: y };
      }
      case "month":
      default: {
        const first = startOfMonthKey(anchor);
        const d = rangeOfDays(addDays(first, -weekdayOf(first)), 42);
        return { days: d, rangeFrom: d[0], rangeTo: d[41],
          title: dayLabel(first, { month: "long", year: "numeric" }) };
      }
    }
  }, [prefs.view, anchor]);

  const fromIso = useMemo(() => new Date(`${rangeFrom}T00:00:00Z`).toISOString(), [rangeFrom]);
  const toIso = useMemo(() => new Date(`${rangeTo}T23:59:59Z`).toISOString(), [rangeTo]);
  const { data: events = [], isLoading, isError } = useCalendarEvents(fromIso, toIso);

  /* The calendar's own zone, taken from the synced events, because that is what
     Google renders in and what the team means when it says "3pm". The browser
     is the fallback only when nothing has been synced yet. */
  const calendarTz = events.find((e) => e.event_timezone)?.event_timezone ?? null;
  const tz = tzOverride ?? calendarTz ?? browserTz;
  const today = todayKey(tz);

  /* Weekends is a filter on COLUMNS, not on data. Hiding Saturday removes the
     column; it must not delete a Saturday meeting from the schedule list. */
  const weekdayColumns = prefs.weekends ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5];
  const visibleDays = prefs.weekends
    ? days
    : days.filter((d) => weekdayOf(d) !== 0 && weekdayOf(d) !== 6);

  const itemsByDay = useMemo(() => {
    const m = new Map<DayKey, CalendarItem[]>();
    const push = (k: DayKey, i: CalendarItem) => m.set(k, [...(m.get(k) ?? []), i]);

    for (const e of events) {
      const declined = e.response_status === "declined";
      if (declined && !prefs.declined) continue;
      push(dayKeyOf(e.starts_at, tz), {
        kind: "event", id: e.id, title: e.title, at: e.starts_at,
        event: e, declined, allDay: e.all_day,
      });
    }

    /* Tasks with a due date, on the day they are due. These are MadeEA tasks,
       not Google Tasks: that API needs a scope this connection was never
       granted, and an empty "Tasks" layer would be worse than the real ones. */
    for (const t of allTasks) {
      if (!t.due_at) continue;
      const done = t.status === "done";
      if (done && !prefs.completedTasks) continue;
      push(dayKeyOf(t.due_at, tz), {
        kind: "task", id: `task-${t.id}`, title: t.title, at: t.due_at,
        task: t, done, allDay: true,
      });
    }

    for (const [k, list] of m) {
      list.sort((a, b) => (a.allDay === b.allDay ? a.at.localeCompare(b.at) : a.allDay ? -1 : 1));
      m.set(k, list);
    }
    return m;
  }, [events, allTasks, prefs.declined, prefs.completedTasks, tz]);

  /* D W M Y A X and T, as in Google. Suppressed inside fields, so typing "w" in
     a search box does not throw you into week view. */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      /* Escape before EVERYTHING, including the "ignore keys typed in a field"
         rule below. The cursor is almost always in a field when you want to
         abandon a dialog, so an Escape handler that sits behind that check is
         an Escape handler that never fires. Caught by pressing it in the title
         box and watching the dialog stay open. */
      if (e.key === "Escape") { setMenuOpen(false); setDetail(null); setCreating(false); return; }

      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;

      /* Everything else is for the calendar, not for whatever is on top of it.
         Without this, clicking into a dialog and typing "Weekly sync" would
         fire W and Y and page the view around underneath it. */
      if (detail || creating || menuOpen) return;

      const hit = VIEWS.find((v) => v.key.toLowerCase() === e.key.toLowerCase());
      if (hit) { setPrefs((p) => ({ ...p, view: hit.id })); return; }
      if (e.key.toLowerCase() === "t") { setAnchor(todayKey(tz)); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tz, detail, creating, menuOpen]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    if (menuOpen) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

  function step(dir: -1 | 1) {
    switch (prefs.view) {
      case "day": setAnchor(addDays(anchor, dir)); break;
      case "four": setAnchor(addDays(anchor, 4 * dir)); break;
      case "week": setAnchor(addDays(anchor, 7 * dir)); break;
      case "schedule": setAnchor(addDays(anchor, 30 * dir)); break;
      case "year": setAnchor(addMonths(anchor, 12 * dir)); break;
      default: setAnchor(addMonths(startOfMonthKey(anchor), dir));
    }
  }

  function planThisDay(day: DayKey) {
    const list = itemsByDay.get(day) ?? [];
    const lines = list.map((i) => `${i.allDay ? "All day" : timeLabel(i.at, tz)} ${i.title}`);
    nav(`/quick-actions?${new URLSearchParams({
      action: "Plan the Calendar",
      output: "Reorder today",
      constraints: lines.length
        ? `On ${dayLabel(day, { weekday: "long", day: "numeric", month: "long" })} I already have:\n${lines.join("\n")}`
        : `${dayLabel(day, { weekday: "long", day: "numeric", month: "long" })} is currently clear.`,
    })}`);
  }

  function prepare(e: CalendarEvent) {
    const mins = e.ends_at
      ? Math.round((new Date(e.ends_at).getTime() - new Date(e.starts_at).getTime()) / 60000)
      : null;
    nav(`/quick-actions?${new URLSearchParams({
      action: "Meeting Preparation",
      output: "Pre-read brief",
      meeting: e.title,
      topics: [
        e.attendee_emails.length ? `Attendees: ${e.attendee_emails.join(", ")}` : "",
        e.location ? `Location: ${e.location}` : "",
        e.description?.trim() ? `From the invite:\n${e.description.trim().slice(0, 800)}` : "",
      ].filter(Boolean).join("\n\n"),
      length: mins ? (mins < 60 ? `${mins} minutes` : `${Math.round((mins / 60) * 10) / 10} hours`) : "",
    })}`);
  }

  const viewProps = {
    days: visibleDays, itemsByDay, tz, today, selected: anchor,
    onSelectDay: (d: DayKey) => {
      setAnchor(d);
      // Clicking a date in the year overview means "show me that day".
      if (prefs.view === "year") setPrefs((p) => ({ ...p, view: "day" }));
    },
    onOpen: setDetail,
  };

  return (
    <div>
      <PageHeader title="Calendar" subtitle="Your Google Calendar, in the same place as the work it creates" />

      {google && !google.connected && (
        <Notice>
          No Google account is connected, so there is nothing to show here.{" "}
          <button className="underline underline-offset-2" onClick={() => void reconnectMail("gmail").then(setConnectError)}>
            <Link2 size={11} className="inline" /> Connect Google
          </button>
        </Notice>
      )}
      {google?.connected && !google.calendar && (
        <Notice>
          This Google connection covers email but not calendar, so no events can be read.{" "}
          <button className="underline underline-offset-2" onClick={() => void reconnectMail("gmail").then(setConnectError)}>
            Reconnect and allow calendar access
          </button>
        </Notice>
      )}
      {connectError && <Notice>{connectError}</Notice>}
      {isError && <Notice>Could not load events. This is a read failure, not an empty calendar.</Notice>}
      {sync.isError && <Notice>{(sync.error as Error)?.message}</Notice>}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button className="btn-ghost grid h-8 w-8 place-items-center border border-border p-0" onClick={() => step(-1)} aria-label="Previous">
            <ChevronLeft size={15} />
          </button>
          <button className="btn-ghost grid h-8 w-8 place-items-center border border-border p-0" onClick={() => step(1)} aria-label="Next">
            <ChevronRight size={15} />
          </button>
        </div>
        <button className="btn-ghost border border-border px-2.5 py-1.5 text-xs" onClick={() => setAnchor(todayKey(tz))}>
          Today
        </button>
        <h2 className="text-base font-semibold">{title}</h2>

        {/* The zone, stated. Google puts it in the corner of the grid, and it is
            the whole difference between 8pm and 5am. */}
        <button
          onClick={() => setTzOverride(tz === browserTz ? (calendarTz ?? browserTz) : browserTz)}
          title={
            tz === browserTz
              ? `Showing this device's timezone (${tz}).${calendarTz ? ` Click to use the calendar's (${calendarTz}).` : ""}`
              : `Showing the calendar's timezone (${tz}). Click to use this device's (${browserTz}).`
          }
          className="rounded-full border border-border px-2 py-1 text-[11px] text-faint hover:text-text"
        >
          {zoneLabel(tz, anchor)} · {tz.split("/").pop()?.replace(/_/g, " ")}
        </button>

        <div className="relative ml-auto" ref={menuRef}>
          <button
            className="btn-ghost border border-border px-2.5 py-1.5 text-xs"
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
          >
            {VIEWS.find((v) => v.id === prefs.view)?.label}
            <ChevronDown size={13} />
          </button>

          {menuOpen && (
            <div role="menu" className="absolute right-0 z-30 mt-1 w-56 rounded-xl border border-[var(--border-strong)] bg-surface p-1 shadow-2xl">
              {VIEWS.map((v) => (
                <button
                  key={v.id}
                  role="menuitemradio"
                  aria-checked={prefs.view === v.id}
                  onClick={() => { setPrefs((p) => ({ ...p, view: v.id })); setMenuOpen(false); }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-[var(--chip-bg)]",
                    prefs.view === v.id && "font-medium",
                  )}
                >
                  <span className="w-4">{prefs.view === v.id && <Check size={13} />}</span>
                  <span className="flex-1">{v.label}</span>
                  <span className="text-[11px] text-faint">{v.key}</span>
                </button>
              ))}

              <div className="my-1 h-px bg-border" />

              <Toggle label="Show weekends" on={prefs.weekends}
                onChange={() => setPrefs((p) => ({ ...p, weekends: !p.weekends }))} />
              <Toggle label="Show declined events" on={prefs.declined}
                onChange={() => setPrefs((p) => ({ ...p, declined: !p.declined }))} />
              <Toggle label="Show completed tasks" on={prefs.completedTasks}
                onChange={() => setPrefs((p) => ({ ...p, completedTasks: !p.completedTasks }))} />
            </div>
          )}
        </div>

        {/* Plan works on the SELECTED day, so a clear day can be planned too.
            It used to live only inside an event's detail, which meant the one
            day most worth planning, an empty one, had no way to reach it. */}
        <button
          className="btn-ghost border border-border px-2.5 py-1.5 text-xs"
          onClick={() => planThisDay(anchor)}
          title="Hand this day's commitments to the planner"
        >
          <Sparkles size={13} /> Plan day
        </button>

        <button
          className="btn-primary px-2.5 py-1.5 text-xs"
          onClick={() => setCreating(true)}
          title={google?.canCreate ? "Add an event to your Google Calendar" : "Reconnect Google to allow calendar changes"}
        >
          <Plus size={13} /> New event
        </button>

        <button
          className="btn-ghost border border-border px-2.5 py-1.5 text-xs"
          onClick={() => sync.mutate({ timeMin: fromIso, timeMax: toIso })}
          disabled={sync.isPending || !google?.calendar}
          title={google?.calendar ? "Pull this range again from Google" : "Calendar access is not granted"}
        >
          <RefreshCw size={13} className={sync.isPending ? "animate-spin" : ""} />
          {sync.isPending ? "Syncing…" : "Sync"}
        </button>
      </div>

      {sync.isSuccess && !sync.isPending && (
        <p className="mb-3 text-[12.5px] text-emerald-300">
          Synced {sync.data.synced} of {sync.data.scanned} events from Google.
        </p>
      )}

      {isLoading ? (
        <p className="text-sm text-faint">Loading…</p>
      ) : prefs.view === "month" ? (
        <MonthView {...viewProps} weekdays={weekdayColumns} />
      ) : prefs.view === "year" ? (
        <YearView
          year={Number(anchor.slice(0, 4))}
          itemsByDay={itemsByDay}
          today={today}
          onSelectDay={viewProps.onSelectDay}
        />
      ) : prefs.view === "schedule" ? (
        <ScheduleView {...viewProps} />
      ) : (
        <TimeGridView {...viewProps} zoneLabel={zoneLabel(tz, anchor)} />
      )}

      {creating && (
        <NewEventDialog
          day={anchor}
          tz={tz}
          canCreate={Boolean(google?.canCreate)}
          onClose={() => setCreating(false)}
        />
      )}

      {detail && (
        <EventDetail
          item={detail}
          tz={tz}
          onClose={() => setDetail(null)}
          onPrepare={prepare}
          onPlanDay={() => planThisDay(dayKeyOf(detail.at, tz))}
        />
      )}
    </div>
  );
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: () => void }) {
  return (
    <button
      role="menuitemcheckbox"
      aria-checked={on}
      onClick={onChange}
      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-[var(--chip-bg)]"
    >
      <span className="w-4">{on && <Check size={13} />}</span>
      <span>{label}</span>
    </button>
  );
}

function EventDetail({ item, tz, onClose, onPrepare, onPlanDay }: {
  item: CalendarItem; tz: string; onClose: () => void;
  onPrepare: (e: CalendarEvent) => void; onPlanDay: () => void;
}) {
  const e = item.event;
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <div className="card w-full max-w-md p-4" onClick={(ev) => ev.stopPropagation()} role="dialog" aria-modal="true">
        <div className="mb-2 flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold leading-snug">{item.title}</h3>
            <p className="mt-0.5 text-xs text-faint">
              {dayLabel(dayKeyOf(item.at, tz), { weekday: "long", day: "numeric", month: "long" })}
              {!item.allDay && ` · ${timeLabel(item.at, tz)}`}
              {e?.ends_at && !item.allDay && ` to ${timeLabel(e.ends_at, tz)}`}
            </p>
          </div>
          <button className="btn-ghost grid h-7 w-7 place-items-center p-0" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </div>

        {item.declined && (
          <p className="mb-2 rounded-lg bg-surface-2 px-2 py-1 text-[12px] text-faint">You declined this invitation.</p>
        )}
        {item.kind === "task" && (
          <p className="mb-2 rounded-lg bg-accent/10 px-2 py-1 text-[12px] text-accent-soft">
            MadeEA task{item.done ? ", completed" : ""}.
          </p>
        )}

        {e?.location && (
          <p className="mt-1 flex items-center gap-1.5 text-[12.5px] text-muted">
            <MapPin size={12} className="shrink-0" /> {e.location}
          </p>
        )}
        {e?.attendee_emails.length ? (
          <p className="mt-1 flex items-start gap-1.5 text-[12.5px] text-muted">
            <Users size={12} className="mt-0.5 shrink-0" />
            <span className="break-words">{e.attendee_emails.join(", ")}</span>
          </p>
        ) : null}
        {e?.description && (
          <p className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap rounded-lg bg-surface-2 p-2 text-[12.5px] leading-relaxed text-muted">
            {e.description.slice(0, 600)}
          </p>
        )}

        <div className="mt-3 flex flex-wrap gap-1.5">
          {e && (
            <button className="btn-primary px-2.5 py-1.5 text-xs" onClick={() => onPrepare(e)}>
              <Sparkles size={13} /> Prepare
            </button>
          )}
          <button className="btn-ghost border border-border px-2.5 py-1.5 text-xs" onClick={onPlanDay}>
            <CalendarDays size={13} /> Plan this day
          </button>
          {e?.html_link && (
            <a href={e.html_link} target="_blank" rel="noreferrer" className="btn-ghost border border-border px-2.5 py-1.5 text-xs">
              <ExternalLink size={13} /> Open in Google
            </a>
          )}
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
