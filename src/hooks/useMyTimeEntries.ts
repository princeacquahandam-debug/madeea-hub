import { useMemo } from "react";
import { useTimeEntries } from "@/data/hooks";
import { useAuth } from "@/hooks/useAuth";
import { isSupabaseConfigured } from "@/lib/supabase";
import type { TimeEntry } from "@/types/db";

/**
 * The signed-in person's OWN shifts.
 *
 * useTimeEntries returns every row RLS allows, and RLS lets owners and admins
 * read the whole team's (0027) so the timesheet can show it. Everything that
 * asks "is MY shift running / paused / what is MY focus today" read that same
 * list and took the first open row it found: an owner's header clock showed an
 * EA's running shift, its Pause and Clock out acted on that EA's shift (the
 * "admin correct" policy allows the update), and screen capture attached the
 * owner's screenshots to it (QA write test, 23 Nov 2026).
 *
 * Until the session is known this is still loading (data undefined), never an
 * empty list: "no shift" must not be guessed, see useTimeEntries. Demo rows carry
 * a placeholder owner, so the demo keeps them all.
 */
export function useMyTimeEntries() {
  const q = useTimeEntries();
  const { user } = useAuth();
  const uid = user?.id;
  const data = useMemo<TimeEntry[] | undefined>(() => {
    if (!q.data) return q.data;
    if (!isSupabaseConfigured) return q.data;
    if (!uid) return undefined;
    return q.data.filter((e) => e.owner_id === uid);
  }, [q.data, uid]);
  return { ...q, data, isSuccess: q.isSuccess && data !== undefined };
}
