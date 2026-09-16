import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Share2 } from "lucide-react";
import { supabase } from "@/lib/supabase";

/**
 * The delegation plans a client has written for this account, read by the
 * assistant those plans are about.
 *
 * WHY THE ASSISTANT SEES THIS AT ALL. The plan says how much rope they have,
 * what done looks like, what the client is worried about, and how often they
 * will be asked. That is the brief. Leaving it only in the client portal means
 * the person being delegated to is the one person who cannot read the terms.
 *
 * READ ONLY, and not because of a missing form. A delegation plan the delegatee
 * edited is not a delegation plan. 0076 gives staff a select policy and no
 * others; changes go through the client, in their portal.
 *
 * The handed-over ones also exist as ordinary tasks on the board -- that is what
 * client_hand_off_plan does -- so this is the context behind a task, not a
 * second to-do list competing with the first.
 */

interface Plan {
  id: string;
  task_name: string;
  outcome: string | null;
  autonomy_level: string | null;
  deadline: string | null;
  success_criteria: string[];
  handoff_message: string | null;
  status: "draft" | "active" | "done";
  task_id: string | null;
  created_at: string;
}

const AUTONOMY_LABEL: Record<string, string> = {
  recommend: "Check with them first",
  act_inform: "Act, then tell them",
  own: "Owns it outright",
};

export function DelegationPlans({ clientId }: { clientId: string }) {
  const { data: plans = [] } = useQuery({
    queryKey: ["delegation-plans", clientId],
    queryFn: async () => {
      if (!supabase) return [];
      const { data, error } = await supabase
        .from("delegation_plans")
        .select("id, task_name, outcome, autonomy_level, deadline, success_criteria, handoff_message, status, task_id, created_at")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false })
        .limit(10);
      // Not migrated yet reads as "none", never as a crash.
      if (error) return [];
      return (data ?? []) as Plan[];
    },
    retry: false,
  });

  // Nothing at all rather than an empty heading: most clients will never use
  // this, and a permanently empty section reads as something broken.
  if (plans.length === 0) return null;

  return (
    <div className="space-y-3">
      {plans.map((p) => (
        <div key={p.id} className="rounded-lg bg-surface-2 px-3 py-2.5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span className="flex items-center gap-1.5 text-sm font-medium">
              <Share2 size={13} className="text-faint" /> {p.task_name}
            </span>
            <span className="text-xs text-faint">
              {p.status === "active" ? "Handed to you" : p.status === "done" ? "Done" : "Still a draft"}
            </span>
          </div>

          {p.outcome ? <p className="mt-1 text-sm text-muted">{p.outcome}</p> : null}

          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-faint">
            {p.autonomy_level ? <span>{AUTONOMY_LABEL[p.autonomy_level] ?? p.autonomy_level}</span> : null}
            {p.deadline ? <span>By {new Date(p.deadline).toLocaleDateString()}</span> : null}
          </div>

          {p.success_criteria?.length ? (
            <ul className="mt-2 space-y-1">
              {p.success_criteria.map((c, i) => (
                <li key={i} className="flex items-start gap-1.5 text-xs text-muted">
                  <CheckCircle2 size={12} className="mt-0.5 shrink-0 text-accent" />
                  {c}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ))}
    </div>
  );
}
