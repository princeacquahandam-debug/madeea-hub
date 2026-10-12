import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { atLeast, useMyRole } from "@/data/hooks";
import { emitOnce } from "@/lib/alerts";
import { cn } from "@/lib/utils";

/**
 * Who has not started today.
 *
 * WHY THIS EXISTS. 0063 gates the clock on reporting and 0064 tells the client
 * when their assistant starts. Both fire when somebody DOES something. An
 * assistant who does nothing at all fires neither, and on the 14 Sep call
 * (17:30) Bryan named the route out loud -- "papasok yan kay Rachel kung
 * sakali, kasi si Rachel nag-monitor" -- for a thing that did not exist.
 *
 * A MISSING CLOCK-IN IS THE ABSENCE OF A ROW, so nothing can emit it at the
 * moment it happens. There is no event to hook. Something has to go looking,
 * and the honest options were a scheduled job or a screen. This is the screen:
 * it puts the fact in front of the person already watching the tracker, and
 * emits ea_not_clocked_in so the route in 0075 can carry it further once an
 * admin points it somewhere in Settings.
 *
 * That means it is a monitor, not a guarantee. If nobody opens this page, the
 * alert does not fire. Said plainly here rather than left for somebody to
 * discover the morning it mattered: the scheduled version belongs in n8n,
 * reading the same view, and the route is already seeded for it.
 *
 * MANAGERS AND ABOVE. staff_clock_status enforces the same thing in its WHERE
 * clause, so an employee querying it directly gets nothing rather than a
 * register of who was late.
 */

interface Row {
  user_id: string;
  name: string;
  role: string;
  last_worked: string | null;
  clocked_in_today: boolean;
  filed_eod_today: boolean;
}

/** Before this hour, "has not started" is just "it is early". */
const EXPECT_BY_HOUR = 10;

/** Rows shown before "View all". */
const PREVIEW = 6;

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");

export function ClockWatch({ className }: { className?: string }) {
  const [all, setAll] = useState(false);
  const { data: role } = useMyRole();
  const allowed = atLeast(role, "manager");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["staff-clock-status"],
    enabled: allowed,
    // The answer changes as people clock in through the morning.
    refetchInterval: 5 * 60_000,
    queryFn: async () => {
      if (!supabase) return [];
      const { data, error } = await supabase
        .from("staff_clock_status")
        .select("user_id, name, role, last_worked, clocked_in_today, filed_eod_today")
        .order("name");
      // Not migrated yet reads as "nothing to report", never as a crash.
      if (error) return [];
      return (data ?? []) as Row[];
    },
    retry: false,
  });

  const missing = rows.filter((r) => !r.clocked_in_today);
  const late = new Date().getHours() >= EXPECT_BY_HOUR;

  useEffect(() => {
    /* Once per person per day per session. emitOnce keys on the pair, and the
       date is in the key so tomorrow is a new alert rather than a silent one. */
    if (!late) return;
    const today = new Date().toISOString().slice(0, 10);
    for (const r of missing) {
      emitOnce("ea_not_clocked_in", `${r.user_id}:${today}`, {
        name: r.name,
        last_worked: r.last_worked,
      });
    }
  }, [late, missing]);

  if (!allowed) return null;
  if (isLoading || rows.length === 0) return null;

  /* A compact "Team today" list beside your own clock (12 Oct 2026, UI review
     deck slide 6). Whoever hasn't started comes first. */
  const clockedIn = rows.length - missing.length;
  const ordered = [...missing, ...rows.filter((r) => r.clocked_in_today)];
  const shown = all ? ordered : ordered.slice(0, PREVIEW);
  const noEod = rows.filter((r) => r.clocked_in_today && !r.filed_eod_today).length;

  return (
    <section className={cn("card overflow-hidden", className)} aria-label="Team today">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">Team today</h2>
        <span className="pill bg-surface-2 text-muted">{clockedIn} of {rows.length} clocked in</span>
        {rows.length > PREVIEW && (
          <button className="ml-auto text-xs font-medium text-accent-soft hover:underline" onClick={() => setAll(!all)}>
            {all ? "Show less" : "View all"}
          </button>
        )}
      </div>
      <ul className="divide-y divide-border">
        {shown.map((r) => (
          <li key={r.user_id} className="flex items-center gap-2.5 px-4 py-2 text-sm">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-surface-2 text-[10px] font-semibold text-muted">
              {initials(r.name)}
            </span>
            <span className="min-w-0 flex-1 truncate">{r.name}</span>
            {/* The date beside the flag, because a clock-in that has not synced
                and somebody absent for days look identical without it. */}
            <span className={cn("shrink-0 text-xs", r.clocked_in_today ? "text-emerald-500" : late ? "text-accent" : "text-faint")}>
              {r.clocked_in_today
                ? "Clocked in"
                : r.last_worked
                  ? `Last worked ${new Date(`${r.last_worked}T00:00:00`).toLocaleDateString([], { month: "short", day: "numeric" })}`
                  : "Never logged"}
            </span>
          </li>
        ))}
      </ul>
      {noEod > 0 && (
        <p className="border-t border-border px-4 py-2 text-xs text-faint">
          {noEod} clocked in without an EOD yet. They can't clock out until they submit one.
        </p>
      )}
    </section>
  );
}
