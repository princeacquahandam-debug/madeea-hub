import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

/**
 * Recently deleted tasks (migration 0090; Reich's testing, 20 Oct 2026).
 *
 * Deleting a task moves a copy here (a database trigger does it, so every way of
 * deleting is covered). It stays 30 days and can be restored with its
 * checklist, notes, progress, links and comments.
 *
 * Demo mode has no database, so the list is simply empty there.
 */
export interface TrashedTask {
  id: string;
  task_id: string;
  title: string;
  deleted_by: string | null;
  deleted_at: string;
  task: {
    priority?: string;
    status?: string;
    due_at?: string | null;
    assignee_id?: string | null;
    subtasks?: { id: string; label: string; done: boolean }[];
  };
}

export const TRASH_DAYS = 30;

export function useTaskTrash(enabled = true) {
  return useQuery<TrashedTask[]>({
    queryKey: ["task_trash"],
    enabled,
    queryFn: async () => {
      if (!supabase) return [];
      // Anything past 30 days is cleared first, so the list never shows it.
      await supabase.rpc("purge_old_task_trash");
      const { data, error } = await supabase
        .from("task_trash")
        .select("id,task_id,title,deleted_by,deleted_at,task")
        .order("deleted_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as TrashedTask[];
    },
  });
}

export function useTaskTrashMutations() {
  const qc = useQueryClient();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["task_trash"] });
    qc.invalidateQueries({ queryKey: ["tasks"] });
    qc.invalidateQueries({ queryKey: ["task_comments"] });
  };

  const restore = useMutation({
    mutationFn: async (trashId: string) => {
      if (!supabase) return;
      const { error } = await supabase.rpc("restore_task", { p_trash_id: trashId });
      if (error) throw error;
    },
    onSettled: refresh,
  });

  /* Delete forever. RLS lets whoever deleted it, or a manager and up, do this;
     anyone else's delete matches no rows, so the count is checked rather than
     reporting a success that didn't happen. */
  const purge = useMutation({
    mutationFn: async (trashId: string) => {
      if (!supabase) return;
      const { data, error } = await supabase.from("task_trash").delete().eq("id", trashId).select("id");
      if (error) throw error;
      if (!data?.length) throw new Error("Only the person who deleted it, or a manager, can delete it for good.");
    },
    onSettled: refresh,
  });

  return { restore, purge };
}
