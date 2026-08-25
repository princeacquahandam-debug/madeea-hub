import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { supabase } from "@/lib/supabase";

/**
 * Says so when the signed-in person is in no workspace.
 *
 * WHY THIS EXISTS. Every policy in the schema reads
 * `workspace_id = my_workspace()`, and that is "the workspace this person is a
 * member of". Someone with no membership matches nothing anywhere: no EOD
 * reports, no tasks, no messages, no clients. The app renders perfectly and
 * every number is zero.
 *
 * That state is indistinguishable from a working app with an empty database,
 * and it was reported — correctly — as "the EOD is not working for the team".
 * Seven names on a compliance grid with 0.00% beside each is a convincing lie;
 * five of those people simply had no seat.
 *
 * An empty state must be able to tell the difference between "there is nothing
 * here" and "you cannot see anything here". This is that difference, said once,
 * above whatever page they are on.
 */
export function WorkspaceGate() {
  const { data: hasSeat } = useQuery({
    queryKey: ["has-workspace"],
    queryFn: async () => {
      if (!supabase) return true;
      const { data } = await supabase.auth.getUser();
      if (!data.user) return true;   // signed out is the login screen's problem
      /* RLS on memberships already limits this to the caller's own workspace,
         so a count is enough: zero means no seat, not an empty table. */
      const { count, error } = await supabase
        .from("memberships")
        .select("user_id", { count: "exact", head: true })
        .eq("user_id", data.user.id);
      if (error) return true;        // never block the app on a failed check
      return (count ?? 0) > 0;
    },
    staleTime: 60_000,
    retry: false,
  });

  if (hasSeat !== false) return null;

  return (
    <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-500/50 bg-amber-500/10 p-4">
      <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-400" />
      <div className="text-sm text-amber-100">
        <p className="font-semibold">You are not in a workspace yet.</p>
        <p className="mt-1 leading-relaxed text-amber-100/80">
          Everything on this screen will read as empty until an admin adds you — not because there
          is nothing there, but because nothing is visible to an account without a seat. Ask whoever
          runs the workspace to invite this email address, then sign out and back in.
        </p>
      </div>
    </div>
  );
}
