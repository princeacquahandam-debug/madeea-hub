/**
 * Create the tasks that routines are due to produce.
 *
 * Mounted in AppShell, so it runs when anyone opens the app.
 *
 * IT USED TO LIVE ON THE ROUTINES PAGE, and that was wrong. The reasoning was
 * "attendance gating means an EA opens the app every morning, so page-open and
 * daily are the same event". True of the app. Not true of the Routines page:
 * you set a routine up once and never go back, so Monday's task would never be
 * created and the feature would sit there doing nothing. Which is exactly what
 * a routine must not do.
 *
 * This is still not a scheduler, and it should not pretend to be. If nobody
 * opens the app on Monday, Monday's task appears on Tuesday when somebody does.
 * For a nine person team that all sign in daily to record attendance, that is
 * the same thing in practice. The real fix is pg_cron or an n8n schedule
 * calling materialize_routine_occurrence(), which is a small job now that the
 * outbound plumbing exists.
 *
 * Safe to call as often as you like. A unique index on
 * (routine_id, occurrence_date) makes a second attempt a no-op.
 */
import { useEffect, useRef } from "react";
import { useRoutines, useRoutineMutations } from "@/data/hooks";

export function useRoutineRunner(): void {
  const { data: routines = [] } = useRoutines();
  const { materialize } = useRoutineMutations();
  // Once per page load, not once per render. This writes rows.
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    const active = routines.filter((r) => r.is_active);
    if (!active.length) return;
    ran.current = true;
    materialize.mutate(active);
    // materialize is a stable mutation object; depending on it would re-fire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routines]);
}
