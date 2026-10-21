import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { isValidZone, useUserTimeZone } from "@/lib/userTimeZone";
import { DEMO_ME } from "@/data/hooks";

/**
 * Each teammate's chosen time zone (profiles.timezone, 0092), keyed by user id
 * (Reich's testing, 20 Oct 2026). Kept out of useWorkspaceMembers so a database
 * without 0092 yet still lists the team: a missing column here just means no
 * zones are shown. Demo mode only knows your own choice.
 */
export function useMemberTimeZones(ids: string[]) {
  const mine = useUserTimeZone((s) => s.chosen);
  const key = [...ids].sort().join(",");
  return useQuery<Record<string, string>>({
    queryKey: ["member-timezones", key, supabase ? "" : mine],
    queryFn: async () => {
      if (!supabase) return mine ? { [DEMO_ME]: mine } : {};
      if (!ids.length) return {};
      const { data, error } = await supabase.from("profiles").select("id,timezone").in("id", ids);
      if (error) return {};
      const out: Record<string, string> = {};
      for (const r of (data ?? []) as { id: string; timezone?: string | null }[]) {
        if (isValidZone(r.timezone)) out[r.id] = r.timezone;
      }
      return out;
    },
    staleTime: 5 * 60_000,
  });
}
