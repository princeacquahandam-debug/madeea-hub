import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, MapPin, Video } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { clockTime, dateOnly, dayLabel, localDayKey } from "./format";

/**
 * The calendar, reflected to the client. Rowena's opening ask (0:18): "syempre,
 * ang calendar na mag-re-reflect kay Client."
 *
 * A LIST, NOT A GRID. The agency Calendar copies Google because an assistant
 * lives in it all day and needs to see shape — gaps, collisions, a week at a
 * glance. A client opens this to answer one question: what is booked on my
 * account, and when. An agenda answers that in one screen on a phone, which is
 * where most of these will be read.
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

export function ClientCalendar() {
  const { data: events = [], isLoading } = useQuery({
    queryKey: ["client-portal", "calendar"],
    queryFn: async () => {
      /* From the start of today, not from now: a meeting that began an hour ago
         is the one most likely to be looked up, and dropping it at its start
         time empties the page in the middle of the thing it describes. */
      const from = new Date();
      from.setHours(0, 0, 0, 0);
      const { data, error } = await supabase!
        .from("client_calendar")
        .select("id, title, starts_at, ends_at, all_day, location, event_timezone, hangout_link")
        .gte("starts_at", from.toISOString())
        .order("starts_at", { ascending: true })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as EventRow[];
    },
  });

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

  if (isLoading) return <p className="text-faint text-sm">Loading…</p>;

  if (days.length === 0) {
    return (
      <div className="">
        <p className="text-faint text-sm">
          Nothing is booked on your account. Meetings your assistant schedules for you
          appear here.
        </p>
      </div>
    );
  }

  /* One zone label for the page rather than one per row. Every event on an
     account is normally booked in the same calendar, so repeating it on each
     line is noise — but omitting it entirely is how a Manila assistant books a
     client in Dubai for a time neither of them meant. */
  const zone = events.find((e) => e.event_timezone)?.event_timezone ?? null;

  return (
    <div className="space-y-4">
      <p className="text-faint text-sm">
        What is booked on your account.
        {zone ? <> Times are shown in {zone}.</> : null}
      </p>

      {days.map((day) => (
        <section key={day.key}>
          <h3 className="text-faint mb-2 text-xs font-semibold uppercase tracking-wider">
            {dayLabel(dateOnly(day.key))}
          </h3>
          <ul className="space-y-2">
            {day.events.map((e) => (
              <li
                key={e.id}
                className="flex items-start gap-3 rounded-xl px-4 py-3"
                style={{ background: "var(--glass)", border: "1px solid var(--c-border)" }}
              >
                <CalendarDays size={16} className="text-faint mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{e.title}</div>
                  <div className="text-faint mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <span>
                      {e.all_day
                        ? "All day"
                        : `${clockTime(e.starts_at)}${e.ends_at ? ` – ${clockTime(e.ends_at)}` : ""}`}
                    </span>
                    {e.location ? (
                      <span className="flex items-center gap-1.5">
                        <MapPin size={12} /> {e.location}
                      </span>
                    ) : null}
                  </div>
                  {e.hangout_link ? (
                    <a
                      href={e.hangout_link}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-medium"
                      style={{ color: "var(--c-accent)" }}
                    >
                      <Video size={12} /> Join the call
                    </a>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
