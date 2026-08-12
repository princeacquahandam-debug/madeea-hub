import { useEffect, useState } from "react";

/**
 * A ticking clock, for anything that has to count up on screen.
 *
 * Pass null to stop. That matters here: the timesheet only needs a per-second
 * re-render while a timer is actually running, and an interval that keeps
 * firing on a page with nothing moving is a wakeup every second for a laptop
 * on battery.
 */
export function useNow(intervalMs: number | null): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (intervalMs === null) return;
    // Set once immediately so switching from paused to running does not show a
    // stale value until the first tick lands.
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);

  return now;
}
