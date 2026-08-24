import { useEffect, useRef } from "react";
import type { CalendarEvent } from "@/data/hooks";
import type { Task } from "@/types/db";
import {
  type DayKey, dayLabel, daysInMonth, compactTime, timeLabel, minutesOf, weekdayOf,
} from "@/lib/calendarTime";
import { cn } from "@/lib/utils";

/**
 * The five shapes a calendar takes, and the one rule they share.
 *
 * Every view is handed days that have ALREADY been filtered and grouped by the
 * page. None of them decides what is visible: weekends, declined invitations
 * and completed tasks are one decision, made once, so a meeting cannot be
 * hidden in the month and present in the week.
 *
 * Times are formatted in the calendar's zone, never the browser's. See
 * lib/calendarTime for why that distinction is load-bearing rather than
 * pedantic.
 */

export interface CalendarItem {
  kind: "event" | "task";
  id: string;
  title: string;
  /** Instant, ISO. Tasks use their due date. */
  at: string;
  event?: CalendarEvent;
  task?: Task;
  declined?: boolean;
  done?: boolean;
  allDay?: boolean;
}

export interface ViewProps {
  days: DayKey[];
  itemsByDay: Map<DayKey, CalendarItem[]>;
  tz: string;
  today: DayKey;
  selected: DayKey;
  onSelectDay: (d: DayKey) => void;
  onOpen: (item: CalendarItem) => void;
}

/** Shared chip. A task reads as a task, not as a meeting with no attendees. */
function Chip({ item, tz, onOpen, compact }: {
  item: CalendarItem; tz: string; onOpen: (i: CalendarItem) => void; compact?: boolean;
}) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onOpen(item); }}
      title={item.title}
      className={cn(
        "flex w-full items-baseline gap-1 rounded px-1 py-0.5 text-left leading-tight",
        compact ? "text-[10.5px]" : "text-[11.5px]",
        item.kind === "task" ? "bg-accent/15" : "bg-surface-2",
        /* Declined is struck through AND faded, because fade alone is how a
           busy month full of low-contrast text ends up unreadable. */
        item.declined && "line-through opacity-55",
        item.done && "line-through opacity-55",
      )}
    >
      {!item.allDay && (
        <span className="shrink-0 tabular-nums text-faint">{compactTime(item.at, tz)}</span>
      )}
      {item.kind === "task" && <span className="shrink-0 text-accent-soft">✓</span>}
      <span className="truncate">{item.title}</span>
    </button>
  );
}

/* ---------------------------------------------------------------- month --- */

export function MonthView({ days, itemsByDay, tz, today, selected, onSelectDay, onOpen, weekdays }: ViewProps & { weekdays: number[] }) {
  return (
    <div className="card p-3">
      <div className="mb-1 grid gap-1" style={{ gridTemplateColumns: `repeat(${weekdays.length}, minmax(0,1fr))` }}>
        {weekdays.map((w) => (
          <div key={w} className="px-1 py-1 text-center text-[11px] font-medium text-faint">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][w]}
          </div>
        ))}
      </div>
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${weekdays.length}, minmax(0,1fr))` }}>
        {days.map((d) => {
          const list = itemsByDay.get(d) ?? [];
          const outside = d.slice(0, 7) !== selected.slice(0, 7);
          return (
            <button
              key={d}
              onClick={() => onSelectDay(d)}
              aria-label={`${dayLabel(d, { weekday: "long", day: "numeric", month: "long" })}, ${list.length} item${list.length === 1 ? "" : "s"}`}
              aria-pressed={d === selected}
              className={cn(
                "min-h-[86px] rounded-lg border p-1.5 text-left align-top transition-colors",
                d === selected ? "border-accent ring-1 ring-accent" : "border-border hover:border-[var(--border-strong)]",
                outside && "opacity-40",
              )}
            >
              <span className={cn(
                "inline-grid h-5 min-w-5 place-items-center rounded-full px-1 text-[11px] font-semibold tabular-nums",
                d === today ? "bg-accent text-white" : "text-faint",
              )}>
                {Number(d.slice(8))}
              </span>
              <span className="mt-1 block space-y-0.5">
                {list.slice(0, 3).map((it) => (
                  <Chip key={it.id} item={it} tz={tz} onOpen={onOpen} compact />
                ))}
                {list.length > 3 && (
                  <span className="block px-1 text-[10px] text-faint">+{list.length - 3} more</span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------- day / 4 days / week --- */

const HOUR_PX = 44;

export function TimeGridView({ days, itemsByDay, tz, today, onOpen, zoneLabel }: ViewProps & { zoneLabel: string }) {
  const hours = Array.from({ length: 24 }, (_, h) => h);
  const scroller = useRef<HTMLDivElement>(null);

  /* Open where the day actually happens.
     A 24-hour grid starts at midnight, so the first render was eight empty
     hours and the meetings were below the fold: the week looked free. Scrolls
     to just above the earliest thing in view, or to the working morning when
     there is nothing, which is what every calendar does and nobody notices
     until it is missing. */
  const earliest = days
    .flatMap((d) => itemsByDay.get(d) ?? [])
    .filter((i) => !i.allDay)
    .reduce<number | null>((min, i) => {
      const m = minutesOf(i.at, tz);
      return min === null || m < min ? m : min;
    }, null);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const target = earliest === null ? 8 * 60 : Math.max(0, earliest - 45);
    el.scrollTop = (target / 60) * HOUR_PX;
  }, [earliest, days.join(",")]);

  return (
    <div className="card overflow-hidden p-0">
      {/* Header row of days, sticky so scrolling the grid keeps the dates. */}
      <div className="flex border-b border-border">
        <div className="w-14 shrink-0 py-2 text-center text-[10px] text-faint">{zoneLabel}</div>
        {days.map((d) => (
          <div key={d} className="min-w-0 flex-1 border-l border-border px-1 py-2 text-center">
            <div className="text-[10.5px] uppercase tracking-wide text-faint">
              {dayLabel(d, { weekday: "short" })}
            </div>
            <div className={cn(
              "mx-auto mt-0.5 grid h-7 w-7 place-items-center rounded-full text-sm font-semibold tabular-nums",
              d === today ? "bg-accent text-white" : "",
            )}>
              {Number(d.slice(8))}
            </div>
          </div>
        ))}
      </div>

      {/* All-day strip, above the scrolling grid as in Google. Without it an
          all-day event has no hour to sit at and would silently vanish. */}
      <AllDayStrip days={days} itemsByDay={itemsByDay} tz={tz} onOpen={onOpen} />

      <div ref={scroller} className="max-h-[62vh] overflow-y-auto">
        <div className="flex">
          <div className="w-14 shrink-0">
            {hours.map((h) => (
              <div key={h} className="relative text-right" style={{ height: HOUR_PX }}>
                <span className="absolute -top-1.5 right-1.5 text-[10px] tabular-nums text-faint">
                  {h === 0 ? "" : `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? "am" : "pm"}`}
                </span>
              </div>
            ))}
          </div>

          {days.map((d) => {
            const timed = (itemsByDay.get(d) ?? []).filter((i) => !i.allDay);
            return (
              <div key={d} className="relative min-w-0 flex-1 border-l border-border">
                {hours.map((h) => (
                  <div key={h} className="border-b border-border/40" style={{ height: HOUR_PX }} />
                ))}
                {layout(timed, tz).map(({ item, top, height, col, cols }) => (
                  <button
                    key={item.id}
                    onClick={() => onOpen(item)}
                    title={`${timeLabel(item.at, tz)} ${item.title}`}
                    className={cn(
                      "absolute overflow-hidden rounded border px-1 py-0.5 text-left text-[10.5px] leading-tight",
                      item.kind === "task" ? "border-accent/50 bg-accent/20" : "border-accent/40 bg-accent/15",
                      (item.declined || item.done) && "line-through opacity-55",
                    )}
                    style={{
                      top, height: Math.max(height, 16),
                      left: `calc(${(col / cols) * 100}% + 2px)`,
                      width: `calc(${100 / cols}% - 4px)`,
                    }}
                  >
                    <span className="block truncate font-medium">{item.title}</span>
                    <span className="block truncate text-faint">{timeLabel(item.at, tz)}</span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function AllDayStrip({ days, itemsByDay, tz, onOpen }: Pick<ViewProps, "days" | "itemsByDay" | "tz" | "onOpen">) {
  const any = days.some((d) => (itemsByDay.get(d) ?? []).some((i) => i.allDay));
  if (!any) return null;
  return (
    <div className="flex border-b border-border bg-surface-2/40">
      <div className="w-14 shrink-0 py-1 text-right text-[10px] text-faint">
        <span className="pr-1.5">all day</span>
      </div>
      {days.map((d) => (
        <div key={d} className="min-w-0 flex-1 space-y-0.5 border-l border-border p-1">
          {(itemsByDay.get(d) ?? []).filter((i) => i.allDay).map((it) => (
            <Chip key={it.id} item={it} tz={tz} onOpen={onOpen} compact />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Overlapping events sit side by side rather than on top of each other.
 *
 * Greedy column packing: an event takes the first column whose last event has
 * already finished. Two meetings at the same hour is the normal case in an EA's
 * day, and stacking them would hide one completely.
 */
function layout(items: CalendarItem[], tz: string) {
  const sorted = [...items].sort((a, b) => minutesOf(a.at, tz) - minutesOf(b.at, tz));
  const colEnds: number[] = [];
  const placed = sorted.map((item) => {
    const start = minutesOf(item.at, tz);
    const endIso = item.event?.ends_at ?? null;
    let end = endIso ? minutesOf(endIso, tz) : start + 30;
    if (end <= start) end = start + 30;          // same-instant or malformed
    let col = colEnds.findIndex((e) => e <= start);
    if (col === -1) { col = colEnds.length; colEnds.push(end); }
    else colEnds[col] = end;
    return { item, start, end, col };
  });
  const cols = Math.max(1, colEnds.length);
  return placed.map((p) => ({
    item: p.item,
    top: (p.start / 60) * HOUR_PX,
    height: ((p.end - p.start) / 60) * HOUR_PX,
    col: p.col,
    cols,
  }));
}

/* ----------------------------------------------------------------- year --- */

export function YearView({ year, itemsByDay, today, onSelectDay }: {
  year: number;
  itemsByDay: Map<DayKey, CalendarItem[]>;
  today: DayKey;
  onSelectDay: (d: DayKey) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 12 }, (_, m) => {
        const first: DayKey = `${year}-${String(m + 1).padStart(2, "0")}-01`;
        const total = daysInMonth(first);
        const lead = weekdayOf(first);
        return (
          <div key={m} className="card p-2.5">
            <p className="mb-1.5 text-center text-xs font-semibold">
              {dayLabel(first, { month: "long" })}
            </p>
            <div className="grid grid-cols-7 gap-px text-center">
              {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                <span key={i} className="text-[9px] text-faint">{d}</span>
              ))}
              {Array.from({ length: lead }, (_, i) => <span key={`b${i}`} />)}
              {Array.from({ length: total }, (_, i) => {
                const key = `${year}-${String(m + 1).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`;
                const n = (itemsByDay.get(key) ?? []).length;
                return (
                  <button
                    key={key}
                    onClick={() => onSelectDay(key)}
                    aria-label={`${dayLabel(key, { day: "numeric", month: "long" })}, ${n} item${n === 1 ? "" : "s"}`}
                    className={cn(
                      "relative grid h-5 place-items-center rounded text-[10px] tabular-nums hover:bg-[var(--chip-bg)]",
                      key === today ? "bg-accent font-semibold text-white" : n ? "font-medium" : "text-faint",
                    )}
                  >
                    {i + 1}
                    {/* A dot, because in a cell this size a count is unreadable
                        and colour alone says nothing to anyone who cannot see
                        it. The label carries the number. */}
                    {n > 0 && key !== today && (
                      <span className="absolute bottom-0 h-1 w-1 rounded-full bg-accent" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------- schedule --- */

export function ScheduleView({ days, itemsByDay, tz, today, onOpen }: ViewProps) {
  const withItems = days.filter((d) => (itemsByDay.get(d) ?? []).length > 0);
  if (withItems.length === 0) {
    return (
      <div className="card p-10 text-center">
        <p className="text-sm font-medium">Nothing scheduled in this range.</p>
        <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-faint">
          Schedule lists only days that have something on them, so an empty
          result here means the range really is clear.
        </p>
      </div>
    );
  }
  return (
    <div className="card divide-y divide-border p-0">
      {withItems.map((d) => (
        <div key={d} className="flex gap-3 p-3">
          <div className="w-20 shrink-0">
            <p className={cn("text-xs font-semibold tabular-nums", d === today && "text-accent")}>
              {dayLabel(d, { day: "numeric", month: "short" })}
            </p>
            <p className="text-[11px] text-faint">{dayLabel(d, { weekday: "long" })}</p>
          </div>
          <ul className="min-w-0 flex-1 space-y-1.5">
            {(itemsByDay.get(d) ?? []).map((it) => (
              <li key={it.id}>
                <button
                  onClick={() => onOpen(it)}
                  className={cn(
                    "flex w-full items-baseline gap-2 rounded-lg border border-border px-2.5 py-1.5 text-left transition-colors hover:border-[var(--border-strong)]",
                    (it.declined || it.done) && "opacity-60",
                  )}
                >
                  <span className="w-16 shrink-0 text-[11.5px] tabular-nums text-accent-soft">
                    {it.allDay ? "All day" : timeLabel(it.at, tz)}
                  </span>
                  <span className={cn("min-w-0 flex-1 truncate text-sm", (it.declined || it.done) && "line-through")}>
                    {it.title}
                  </span>
                  {it.kind === "task" && (
                    <span className="shrink-0 rounded-full bg-accent/15 px-1.5 text-[10px] text-accent-soft">Task</span>
                  )}
                  {it.declined && (
                    <span className="shrink-0 rounded-full bg-surface-2 px-1.5 text-[10px] text-faint">Declined</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
