import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import * as seed from "@/data/seed";
import type { Task, TaskStatus, Client, Meeting, Message, Automation, Sop, SopRun, AutomationRun } from "@/types/db";

// Live Supabase data layer with a read-only seed fallback for demo mode
// (no creds). owner_id + workspace_id auto-fill via column defaults (migration
// 0003), so inserts only need the meaningful fields.

const live = () => Boolean(supabase);

// ---------------- tasks ----------------
type TaskRow = Omit<Task, "client_name"> & { client_id: string | null; clients: { name: string } | null };
const mapTask = (r: TaskRow): Task => ({
  id: r.id, title: r.title, due_label: r.due_label, due_at: r.due_at, priority: r.priority, status: r.status,
  client_name: r.clients?.name ?? "Unassigned",
});

export function useTasks() {
  return useQuery<Task[]>({
    queryKey: ["tasks"],
    queryFn: async () => {
      if (!supabase) return seed.TASKS;
      const { data, error } = await supabase
        .from("tasks")
        .select("id,title,due_label,due_at,priority,status,client_id,clients(name)")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data as unknown as TaskRow[]).map(mapTask);
    },
  });
}

export function useTaskMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["tasks"] });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: TaskStatus }) => {
      if (!supabase) return;
      const { error } = await supabase.from("tasks").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: ["tasks"] });
      const prev = qc.getQueryData<Task[]>(["tasks"]);
      qc.setQueryData<Task[]>(["tasks"], (ts) => (ts ?? []).map((t) => (t.id === id ? { ...t, status } : t)));
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(["tasks"], ctx.prev),
    onSettled: invalidate,
  });

  const create = useMutation({
    mutationFn: async (input: { title: string; priority?: Task["priority"]; due_at?: string | null }) => {
      if (!supabase) return;
      const { error } = await supabase.from("tasks").insert({
        title: input.title, priority: input.priority ?? "normal", due_at: input.due_at ?? null, status: "todo",
      });
      if (error) throw error;
    },
    onSettled: invalidate,
  });

  const update = useMutation({
    mutationFn: async ({ id, ...fields }: { id: string; title?: string; priority?: Task["priority"]; due_at?: string | null }) => {
      if (!supabase) return;
      const { error } = await supabase.from("tasks").update(fields).eq("id", id);
      if (error) throw error;
    },
    onSettled: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      if (!supabase) return;
      const { error } = await supabase.from("tasks").delete().eq("id", id);
      if (error) throw error;
    },
    onSettled: invalidate,
  });

  return { setStatus, create, update, remove };
}

// ---------------- clients ----------------
export function useClients() {
  return useQuery<Client[]>({
    queryKey: ["clients"],
    queryFn: async () => {
      if (!supabase) return seed.CLIENTS;
      const { data, error } = await supabase
        .from("clients")
        .select("*")
        .order("created_at", { ascending: true });
      if (error) throw error;
      // active_tasks / schedule are seed-only enrichments for now (Phase A.4 wires joins)
      return (data as Client[]).map((c) => ({ ...c, active_tasks: c.active_tasks ?? [], schedule: c.schedule ?? [] }));
    },
  });
}

export function useClientMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["clients"] });

  const create = useMutation({
    mutationFn: async (input: Partial<Client> & { name: string }) => {
      if (!supabase) return;
      const { error } = await supabase.from("clients").insert({
        name: input.name, title: input.title, company: input.company,
        preferred_channel: input.preferred_channel, tone: input.tone,
        tags: input.tags ?? [], bio: input.bio, preferences_notes: input.preferences_notes,
        avatar_url: input.avatar_url ?? null,
      });
      if (error) throw error;
    },
    onSettled: invalidate,
  });

  const update = useMutation({
    mutationFn: async ({ id, ...fields }: Partial<Client> & { id: string }) => {
      if (!supabase) return;
      const { error } = await supabase.from("clients").update(fields).eq("id", id);
      if (error) throw error;
    },
    onSettled: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      if (!supabase) return;
      const { error } = await supabase.from("clients").delete().eq("id", id);
      if (error) throw error;
    },
    onSettled: invalidate,
  });

  return { create, update, remove };
}

// ---------------- meetings ----------------
export function useMeetings() {
  return useQuery<Meeting[]>({
    queryKey: ["meetings"],
    queryFn: async () => {
      if (!supabase) return seed.MEETINGS;
      const { data, error } = await supabase
        .from("meetings")
        .select("id,title,status,starts_at,client_id,clients(name)")
        .order("starts_at", { ascending: true });
      if (error) throw error;
      return (data as any[]).map((m) => ({
        id: m.id, title: m.title, status: m.status,
        time: m.starts_at ? new Date(m.starts_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "",
        with: m.clients?.name ?? "Internal",
      }));
    },
  });
}

// ---------------- messages ----------------
export function useMessages() {
  return useQuery<Message[]>({
    queryKey: ["messages"],
    queryFn: async () => {
      if (!supabase) return seed.MESSAGES;
      const { data, error } = await supabase
        .from("messages")
        .select("id,sender_name,subject,preview,body,category,received_at,client_id,clients(name,title,company)")
        .order("received_at", { ascending: true });
      if (error) throw error;
      return (data as any[]).map((m) => ({
        id: m.id, sender_name: m.sender_name, subject: m.subject, preview: m.preview, body: m.body,
        category: m.category,
        time: m.received_at ? new Date(m.received_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "",
        client_name: m.clients?.name,
        client_title: m.clients ? `${m.clients.title}, ${m.clients.company}` : undefined,
      }));
    },
  });
}

// ---------------- automations ----------------
export function useAutomations() {
  return useQuery<Automation[]>({
    queryKey: ["automations"],
    queryFn: async () => {
      if (!supabase) return seed.AUTOMATIONS;
      const { data, error } = await supabase
        .from("automations")
        .select("id,name,description,status,total_runs,last_run_at,trigger,action,is_custom")
        .order("is_custom", { ascending: true })
        .order("name", { ascending: true });
      if (error) throw error;
      return (data as any[]).map((a) => ({
        ...a, last_run: a.last_run_at ? new Date(a.last_run_at).toLocaleString() : "Never",
      }));
    },
  });
}

export function useAutomationMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["automations"] });

  const toggle = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "active" | "paused" }) => {
      if (!supabase) return;
      const { error } = await supabase.from("automations").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSettled: invalidate,
  });

  const runNow = useMutation({
    mutationFn: async ({ id, total_runs }: { id: string; total_runs: number }) => {
      if (!supabase) return;
      const { error } = await supabase
        .from("automations")
        .update({ total_runs: total_runs + 1, last_run_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSettled: invalidate,
  });

  const create = useMutation({
    mutationFn: async (input: { name: string; description: string; trigger: string; action: string }) => {
      if (!supabase) return;
      const { error } = await supabase.from("automations").insert({ ...input, status: "active", is_custom: true, automation_key: "custom" });
      if (error) throw error;
    },
    onSettled: invalidate,
  });

  return { toggle, runNow, create };
}

export function useAutomationRuns() {
  return useQuery<AutomationRun[]>({
    queryKey: ["automation_runs"],
    queryFn: async () => {
      if (!supabase) return [];
      const { data, error } = await supabase
        .from("automation_runs")
        .select("id,automation_id,ran_at,summary,output")
        .order("ran_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as AutomationRun[];
    },
  });
}

// ---------------- messages ----------------
export function useMessageMutations() {
  const qc = useQueryClient();
  const setCategory = useMutation({
    mutationFn: async ({ id, category }: { id: string; category: Message["category"] }) => {
      if (!supabase) return;
      const { error } = await supabase.from("messages").update({ category }).eq("id", id);
      if (error) throw error;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["messages"] }),
  });
  return { setCategory };
}

// ---------------- SOPs (Working Playbooks) ----------------
export function useSops() {
  return useQuery<Sop[]>({
    queryKey: ["sops"],
    queryFn: async () => {
      if (!supabase) return seed.SOPS;
      const { data, error } = await supabase
        .from("sops")
        .select("id,title,description,category,steps,success_criteria")
        .eq("is_active", true)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as Sop[];
    },
  });
}

export function useSopRuns() {
  return useQuery<SopRun[]>({
    queryKey: ["sop_runs"],
    queryFn: async () => {
      if (!supabase) return [];
      const { data, error } = await supabase
        .from("sop_runs")
        .select("id,sop_id,client_id,checked,status,started_at,completed_at")
        .order("started_at", { ascending: false });
      if (error) throw error;
      return data as SopRun[];
    },
  });
}

export function useSopMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["sop_runs"] });

  const start = useMutation({
    mutationFn: async ({ sop_id, client_id }: { sop_id: string; client_id?: string | null }) => {
      if (!supabase) return null;
      const { data, error } = await supabase
        .from("sop_runs")
        .insert({ sop_id, client_id: client_id ?? null, checked: [], status: "in_progress" })
        .select("id,sop_id,client_id,checked,status,started_at,completed_at")
        .single();
      if (error) throw error;
      return data as SopRun;
    },
    onSettled: invalidate,
  });

  const setChecked = useMutation({
    mutationFn: async ({ id, checked }: { id: string; checked: string[] }) => {
      if (!supabase) return;
      const { error } = await supabase.from("sop_runs").update({ checked }).eq("id", id);
      if (error) throw error;
    },
    onSettled: invalidate,
  });

  const complete = useMutation({
    mutationFn: async (id: string) => {
      if (!supabase) return;
      const { error } = await supabase
        .from("sop_runs")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSettled: invalidate,
  });

  return { start, setChecked, complete };
}

export { live };
