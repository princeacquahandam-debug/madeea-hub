import { useQuery } from "@tanstack/react-query";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

/**
 * The client this account speaks for, or null for staff.
 *
 * WHY THE RPC AND NOT A SELECT. `client_users` is readable by staff too — its
 * policy is `user_id = auth.uid() OR workspace_id = my_workspace()`, so the app
 * can show which clients have a login. A `select client_id from client_users
 * limit 1` therefore returns SOMEBODY's row for every member of staff, and
 * would route the whole agency into the client portal.
 *
 * my_client() is security definer and reads only auth.uid()'s own row, so it
 * answers the question actually being asked: are YOU a client.
 */
export function useClientUser(enabled: boolean) {
  return useQuery({
    queryKey: ["my-client"],
    // Nothing to ask before there is a session to ask about.
    enabled,
    // Staleness here is a routing decision, not a data one. Whether you are a
    // client does not change while you are signed in.
    staleTime: Infinity,
    queryFn: async (): Promise<string | null> => {
      if (!isSupabaseConfigured || !supabase) return null;
      const { data, error } = await supabase.rpc("my_client");
      if (error) throw error;
      return (data as string | null) ?? null;
    },
  });
}
