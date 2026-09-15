import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { CircleCheck, CircleAlert, Clock } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { atLeast, useMyRole } from "@/data/hooks";
import { emitOnce } from "@/lib/alerts";

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

export function ClockWatch() {
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

  return (
    <div className="card mt-6 p-5">
      <div className="mb-3 flex items-center gap-2">
        <Clock size={15} className="text-faint" />
        <h2 className="text-sm font-semibold uppercase tracking-wider">Today at a glance</h2>
      </div>

      {missing.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted">
          <CircleCheck size={15} style={{ color: "var(--c-accent)" }} />
          Everyone has clocked in.
        </p>
      ) : (
        <>
          <p className="mb-2 text-sm text-muted">
            {missing.length} {missing.length === 1 ? "person has" : "people have"} not started today
            {late ? "." : ", though it is still early."}
          </p>
          <ul className="space-y-1.5">
            {missing.map((r) => (
              <li key={r.user_id} className="flex items-center gap-2.5 text-sm">
                <CircleAlert
                  size={15}
                  className="shrink-0"
                  style={{ color: late ? "var(--c-danger)" : "var(--c-text-faint)" }}
                />
                <span>{r.name}</span>
                <span className="text-xs text-faint">
                  {/* The date beside the flag, because a clock-in that has not
                      synced and somebody absent for days look identical without
                      it -- and they are very different conversations. */}
                  {r.last_worked
                    ? `last worked ${new Date(`${r.last_worked}T00:00:00`).toLocaleDateString()}`
                    : "no time ever logged"}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {rows.some((r) => r.clocked_in_today && !r.filed_eod_today) ? (
        <p className="mt-3 text-xs text-faint">
          {rows.filter((r) => r.clocked_in_today && !r.filed_eod_today).length} clocked in and have not
          filed an EOD yet. They cannot clock out until they do.
        </p>
      ) : null}
    </div>
  );
}
