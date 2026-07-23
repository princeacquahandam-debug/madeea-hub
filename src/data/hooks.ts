import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import * as seed from "@/data/seed";
import type { Task, TaskStatus, Client, Meeting, Message, Automation, Sop, SopRun, AutomationRun, Reminder, Snooze, TaskEvent } from "@/types/db";
import type { ClientDoc } from "@/lib/meetingPrep";
import type { MemoryEntry } from "@/lib/memory";
import type { Note } from "@/lib/notes";
import { addDemoTask, loadDemoTasks, removeDemoTask, updateDemoTask } from "@/store/demoTasks";
import { loadSnoozes, saveSnooze } from "@/store/demoSnoozes";
import { loadAssignees, loadDemoTaskEvents, saveAssignee } from "@/store/demoAssignees";
import { applyDemo, demoCreate, demoDelete, demoId, demoPatch } from "@/store/demoWrites";

// Live Supabase data layer with a read-only seed fallback for demo mode
// (no creds). owner_id + workspace_id auto-fill via column defaults (migration
// 0003), so inserts only need the meaningful fields.

const live = () => Boolean(supabase);

// ---------------- tasks ----------------
type TaskRow = Omit<Task, "client_name"> & { client_id: string | null; clients: { name: string } | null };
const mapTask = (r: TaskRow): Task => ({
  id: r.id, title: r.title, due_label: r.due_label, due_at: r.due_at, priority: r.priority, status: r.status,
  subtasks: Array.isArray(r.subtasks) ? r.subtasks : [],
  recurrence: r.recurrence ?? "none",
  depends_on: r.depends_on ?? null,
  updated_at: (r as { updated_at?: string | null }).updated_at ?? null,
  created_at: (r as { created_at?: string | null }).created_at ?? null,
  completed_at: (r as { completed_at?: string | null }).completed_at ?? null,
  // Keep the FK, not just the joined name — the timeline needs to match on id.
  client_id: r.client_id ?? null,
  assignee_id: (r as { assignee_id?: string | null }).assignee_id ?? null,
  client_name: r.clients?.name ?? "Unassigned",
});

function nextDue(due_at: string | null, rec: string): string | null {
  if (!due_at) return null;
  const d = new Date(due_at);
  if (rec === "daily") d.setUTCDate(d.getUTCDate() + 1);
  else if (rec === "weekly") d.setUTCDate(d.getUTCDate() + 7);
  else if (rec === "monthly") d.setUTCMonth(d.getUTCMonth() + 1);
  else return due_at;
  return d.toISOString();
}

export function useTasks() {
  return useQuery<Task[]>({
    queryKey: ["tasks"],
    queryFn: async () => {
      if (!supabase) {
        // Demo mode has no DB, so reassignments live in localStorage and are
        // layered over the seed tasks here.
        const overrides = loadAssignees();
        return [...loadDemoTasks(), ...seed.TASKS].map((t) =>
          t.id in overrides ? { ...t, assignee_id: overrides[t.id] } : t,
        );
      }
      const { data, error } = await supabase
        .from("tasks")
        // `*` rather than an explicit column list: migration 0013 adds updated_at, and
        // this way the new column flows through the moment it exists.
        .select("*,clients(name)")
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
      if (!supabase) { updateDemoTask(id, { status }); return; }
      const { error } = await supabase.from("tasks").update({ status }).eq("id", id);
      if (error) throw error;
      // Recurring tasks spawn their next instance on completion.
      if (status === "done") {
        const { data: t } = await supabase
          .from("tasks").select("title,priority,due_at,client_id,recurrence,subtasks").eq("id", id).single();
        if (t && t.recurrence && t.recurrence !== "none") {
          const subtasks = Array.isArray(t.subtasks) ? t.subtasks.map((s: { id: string; label: string }) => ({ ...s, done: false })) : [];
          await supabase.from("tasks").insert({
            title: t.title, priority: t.priority, due_at: nextDue(t.due_at, t.recurrence),
            status: "todo", client_id: t.client_id, recurrence: t.recurrence, subtasks,
          });
        }
      }
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

  // client_id was always a column on `tasks`, but nothing ever set it — so every
  // task created in the app came out "Unassigned". Voice capture needs it, and so
  // does the manual form.
  type TaskInput = {
    title: string; priority?: Task["priority"]; due_at?: string | null;
    subtasks?: Task["subtasks"]; recurrence?: Task["recurrence"]; depends_on?: string | null;
    client_id?: string | null;
    assignee_id?: string | null;
  };
  const create = useMutation({
    mutationFn: async (input: TaskInput) => {
      if (!supabase) {
        addDemoTask({
          id: `local-${Date.now()}`,
          title: input.title,
          client_name: seed.CLIENTS.find((c) => c.id === input.client_id)?.name ?? "Unassigned",
          due_label: input.due_at ? new Date(`${input.due_at}T12:00:00`).toLocaleDateString("en-GB", { weekday: "long" }) : "",
          due_at: input.due_at ?? null,
          priority: input.priority ?? "normal",
          status: "todo",
          subtasks: input.subtasks ?? [],
          recurrence: input.recurrence ?? "none",
          depends_on: input.depends_on ?? null,
        });
        return;
      }
      const { error } = await supabase.from("tasks").insert({
        title: input.title, priority: input.priority ?? "normal", due_at: input.due_at ?? null, status: "todo",
        subtasks: input.subtasks ?? [], recurrence: input.recurrence ?? "none", depends_on: input.depends_on ?? null,
        client_id: input.client_id ?? null,
        assignee_id: input.assignee_id ?? null,
      });
      if (error) throw error;
    },
    onSettled: invalidate,
  });

  const update = useMutation({
    mutationFn: async ({ id, ...fields }: Partial<TaskInput> & { id: string }) => {
      if (!supabase) { updateDemoTask(id, fields as Partial<Task>); return; }
      const { error } = await supabase.from("tasks").update(fields).eq("id", id);
      if (error) throw error;
    },
    onSettled: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      if (!supabase) { removeDemoTask(id); return; }
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
      if (!supabase) return applyDemo("clients", seed.CLIENTS);
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
      if (!supabase) {
        demoCreate("clients", {
          id: demoId(), tags: [], active_tasks: [], schedule: [], avatar_url: null, ...input,
        });
        return;
      }
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
      if (!supabase) { demoPatch("clients", id, fields); return; }
      const { error } = await supabase.from("clients").update(fields).eq("id", id);
      if (error) throw error;
    },
    onSettled: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      if (!supabase) { demoDelete("clients", id); return; }
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
        // `*` so attendee_emails (migration 0014) flows through on migration.
        .select("*,clients(name)")
        .order("starts_at", { ascending: true });
      if (error) throw error;
      return (data as any[]).map((m) => ({
        id: m.id, title: m.title, status: m.status,
        starts_at: m.starts_at ?? null,
        time: m.starts_at ? new Date(m.starts_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "",
        with: m.clients?.name ?? "Internal",
        client_id: m.client_id ?? null,
        attendee_emails: m.attendee_emails ?? [],
      }));
    },
  });
}

// ---------------- client docs ----------------
// The Vault has no file store, so a client's "documents" are the AI Suite outputs
// logged against them in ai_generations. Fetched lazily, per client, only when a
// prep packet opens — there's no need to hold every generation in memory.
export function useClientDocs(clientId: string | null | undefined) {
  return useQuery<ClientDoc[]>({
    queryKey: ["client-docs", clientId],
    enabled: Boolean(clientId),
    queryFn: async () => {
      if (!supabase || !clientId) return [];
      const { data, error } = await supabase
        .from("ai_generations")
        .select("id,tool,format,output,created_at")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return data as ClientDoc[];
    },
    retry: false,
  });
}

// ---------------- messages ----------------
export function useMessages() {
  return useQuery<Message[]>({
    queryKey: ["messages"],
    queryFn: async () => {
      if (!supabase) return applyDemo("messages", seed.MESSAGES);
      const { data, error } = await supabase
        .from("messages")
        .select("*,clients(name,title,company)")
        .order("received_at", { ascending: true });
      if (error) throw error;
      return (data as any[]).map((m) => ({
        id: m.id, sender_name: m.sender_name, subject: m.subject, preview: m.preview, body: m.body,
        category: m.category,
        received_at: m.received_at ?? null,
        time: m.received_at ? new Date(m.received_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "",
        thread_id: m.thread_id ?? null,
        sender_email: m.sender_email ?? null,
        direction: m.direction ?? "inbound",
        first_reply_at: m.first_reply_at ?? null,
        reply_received_at: m.reply_received_at ?? null,
        client_id: m.client_id ?? null,
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
      if (!supabase) return applyDemo("automations", seed.AUTOMATIONS);
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
      if (!supabase) { demoPatch("automations", id, { status }); return; }
      const { error } = await supabase.from("automations").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: ["automations"] });
      const prev = qc.getQueryData<Automation[]>(["automations"]);
      qc.setQueryData<Automation[]>(["automations"], (old) => (old ?? []).map((a) => (a.id === id ? { ...a, status } : a)));
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(["automations"], ctx.prev),
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
      if (!supabase) {
        demoCreate("automations", { id: demoId(), ...input, status: "active", is_custom: true, total_runs: 0, last_run: "Never" });
        return;
      }
      const { error } = await supabase.from("automations").insert({ ...input, status: "active", is_custom: true, automation_key: "custom" });
      if (error) throw error;
    },
    onSettled: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      if (!supabase) { demoDelete("automations", id); return; }
      const { error } = await supabase.from("automations").delete().eq("id", id);
      if (error) throw error;
    },
    onSettled: invalidate,
  });

  return { toggle, runNow, create, remove };
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
      if (!supabase) { demoPatch("messages", id, { category }); return; }
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
      if (!supabase) return applyDemo<SopRun>("sop_runs", []);
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
      if (!supabase) {
        const run: SopRun = {
          id: demoId(), sop_id, client_id: client_id ?? null, checked: [],
          status: "in_progress", started_at: new Date().toISOString(), completed_at: null,
        };
        demoCreate("sop_runs", run);
        return run;
      }
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
      if (!supabase) { demoPatch("sop_runs", id, { checked }); return; }
      const { error } = await supabase.from("sop_runs").update({ checked }).eq("id", id);
      if (error) throw error;
    },
    onSettled: invalidate,
  });

  const complete = useMutation({
    mutationFn: async (id: string) => {
      if (!supabase) {
        demoPatch("sop_runs", id, { status: "completed", completed_at: new Date().toISOString() });
        return;
      }
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

// ---------------- reminders ----------------
export function useReminders() {
  return useQuery<Reminder[]>({
    queryKey: ["reminders"],
    queryFn: async () => {
      // Demo mode: reminders created via the bell live in the local write overlay.
      if (!supabase) return applyDemo<Reminder>("reminders", []);
      const { data, error } = await supabase
        .from("reminders")
        .select("id,label,remind_at,dismissed,task_id")
        .eq("dismissed", false)
        .order("remind_at", { ascending: true });
      if (error) return []; // table not migrated yet — degrade gracefully
      return data as Reminder[];
    },
    retry: false,
  });
}

export function useReminderMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["reminders"] });
  const create = useMutation({
    mutationFn: async (input: { label: string; remind_at: string; task_id?: string | null }) => {
      if (!supabase) {
        demoCreate("reminders", { id: demoId(), label: input.label, remind_at: input.remind_at, task_id: input.task_id ?? null, dismissed: false });
        return;
      }
      const { error } = await supabase.from("reminders").insert({ label: input.label, remind_at: input.remind_at, task_id: input.task_id ?? null });
      if (error) throw error;
    },
    onSettled: invalidate,
  });
  const dismiss = useMutation({
    mutationFn: async (id: string) => {
      if (!supabase) { demoDelete("reminders", id); return; }
      const { error } = await supabase.from("reminders").update({ dismissed: true }).eq("id", id);
      if (error) throw error;
    },
    onSettled: invalidate,
  });
  return { create, dismiss };
}

// ---------------- workspace / admin ----------------
export type MemberRole = "admin" | "ea";

export interface Member {
  user_id: string;
  role: MemberRole;
  name: string;
  initials: string;
  joined_at: string;
  open_tasks: number;
  clients: number;
  is_me: boolean;
}

// open_tasks / clients used to be hardcoded numbers here — a workload view that
// looked real and wasn't. They're derived from the demo tasks/clients below, the
// same way live mode derives them.
const DEMO_MEMBER_BASE: Omit<Member, "open_tasks" | "clients">[] = [
  { user_id: "demo-1", role: "admin", name: "You (Admin)", initials: "AD", joined_at: "2026-01-10", is_me: true },
  { user_id: "demo-2", role: "ea", name: "Bryan Sumait", initials: "BS", joined_at: "2026-03-02", is_me: false },
  { user_id: "demo-3", role: "ea", name: "Belle Reyes", initials: "BR", joined_at: "2026-04-15", is_me: false },
];

function demoMembers(): Member[] {
  const overrides = loadAssignees();
  const tasks = [...loadDemoTasks(), ...seed.TASKS].map((t) =>
    t.id in overrides ? { ...t, assignee_id: overrides[t.id] } : t,
  );
  return DEMO_MEMBER_BASE.map((m) => ({
    ...m,
    open_tasks: tasks.filter((t) => t.assignee_id === m.user_id && t.status !== "done").length,
    clients: seed.CLIENTS.filter((c) => c.lead_ea_id === m.user_id).length,
  }));
}

/** The signed-in user in demo mode — there is no real auth, so assume the admin. */
export const DEMO_ME = "demo-1";

// Current user's role. NOTE: this is for UI gating only — the real boundary is
// Postgres RLS (admins-only writes on memberships, workspace isolation).
export function useMyRole() {
  return useQuery<MemberRole>({
    queryKey: ["my-role"],
    staleTime: 15_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      if (!supabase) return "admin"; // demo mode previews the admin UI
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) return "ea";
      const { data, error } = await supabase.from("memberships").select("role").eq("user_id", uid).limit(1).maybeSingle();
      if (error) return "ea";
      return ((data?.role as MemberRole) ?? "ea");
    },
  });
}

export function useWorkspaceMembers() {
  return useQuery<Member[]>({
    queryKey: ["members"],
    queryFn: async () => {
      if (!supabase) return applyDemo("members", demoMembers(), "user_id");
      const { data: auth } = await supabase.auth.getUser();
      const myId = auth.user?.id ?? "";
      const { data: mem, error } = await supabase
        .from("memberships").select("user_id, role, created_at").order("created_at", { ascending: true });
      if (error) throw error;
      const ids = (mem ?? []).map((m) => m.user_id);
      const [profsRes, tasksRes, clientsRes] = await Promise.all([
        supabase.from("profiles").select("id, full_name, initials").in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]),
        // assignee_id (0015), not owner_id: "open tasks" must mean work on your
        // plate, not work you happened to create for someone else.
        supabase.from("tasks").select("*"),
        supabase.from("clients").select("*"),
      ]);
      const pm = Object.fromEntries((profsRes.data ?? []).map((p) => [p.id, p]));
      const tasks = (tasksRes.data ?? []) as { assignee_id?: string | null; status: string }[];
      const clients = (clientsRes.data ?? []) as { lead_ea_id?: string | null; owner_id?: string | null }[];
      return (mem ?? []).map((m) => ({
        user_id: m.user_id,
        role: m.role as MemberRole,
        name: pm[m.user_id]?.full_name ?? "Team member",
        initials: pm[m.user_id]?.initials ?? "EA",
        joined_at: m.created_at,
        open_tasks: tasks.filter((t) => t.assignee_id === m.user_id && t.status !== "done").length,
        clients: clients.filter((c) => (c.lead_ea_id ?? c.owner_id) === m.user_id).length,
        is_me: m.user_id === myId,
      }));
    },
  });
}

export function useMemberMutations() {
  const qc = useQueryClient();
  const invalidate = () => { qc.invalidateQueries({ queryKey: ["members"] }); qc.invalidateQueries({ queryKey: ["my-role"] }); };
  const setRole = useMutation({
    mutationFn: async ({ user_id, role }: { user_id: string; role: MemberRole }) => {
      if (!supabase) { demoPatch("members", user_id, { role }); return; }
      // .select() so we can tell a real change from a silent RLS no-op (Supabase
      // returns no error when a policy filters the row out and 0 rows change).
      const { data, error } = await supabase.from("memberships").update({ role }).eq("user_id", user_id).select("user_id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("Change not saved — admin rights required, or the member is in another workspace.");
    },
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: async ({ user_id }: { user_id: string }) => {
      if (!supabase) { demoDelete("members", user_id); return; }
      const { data, error } = await supabase.from("memberships").delete().eq("user_id", user_id).select("user_id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("Not removed — admin rights required, or the member is in another workspace.");
    },
    onSuccess: invalidate,
  });
  return { setRole, remove };
}

// Invite a teammate. The edge function verifies the caller is an admin and uses
// the service role server-side — if it isn't deployed yet, callers get a clear
// fallback message (the page still works for monitoring + role management).
export function useInviteMember() {
  return useMutation({
    mutationFn: async (email: string): Promise<{ ok: boolean; email?: string }> => {
      if (!supabase) return { ok: true, email };
      const { data, error } = await supabase.functions.invoke("invite-member", { body: { email } });
      if (error) throw new Error(error.message || "Invite service unavailable");
      return data as { ok: boolean; email?: string };
    },
  });
}

export { live };

// ---------------- snoozes ----------------
// Backs the "stop nagging me about this" action. The `snoozes` table arrives with
// migration 0013; until then (and in demo mode) this falls back to localStorage so
// the button still works rather than silently doing nothing.
export function useSnoozes() {
  return useQuery<Snooze[]>({
    queryKey: ["snoozes"],
    queryFn: async () => {
      if (!supabase) return loadSnoozes();
      const { data, error } = await supabase.from("snoozes").select("id,item_type,item_id,snooze_until");
      if (error) return loadSnoozes(); // table not migrated yet
      return data as Snooze[];
    },
    retry: false,
  });
}

export function useSnoozeMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["snoozes"] });

  const snooze = useMutation({
    mutationFn: async ({ item_type, item_id, days }: { item_type: Snooze["item_type"]; item_id: string; days: number }) => {
      const until = new Date(Date.now() + days * 86_400_000).toISOString();
      if (!supabase) { saveSnooze(item_type, item_id, until); return; }
      const { error } = await supabase
        .from("snoozes")
        .upsert({ item_type, item_id, snooze_until: until }, { onConflict: "workspace_id,item_type,item_id" });
      if (error) {
        // Same rule as memories/notes (see isMissingTable + commit "Stop the Memory
        // Helper hiding real save failures"): only a genuinely-missing table falls
        // back to local storage. Every other failure — an RLS refusal, a network
        // drop — is thrown and surfaced. A snooze kept only in this browser would
        // diverge from the shared workspace and quietly mislead: the nag looks
        // silenced for everyone when it isn't.
        if (!isMissingTable(error)) throw new Error(error.message || "Couldn't snooze that — please try again.");
        saveSnooze(item_type, item_id, until); // pre-migration fallback
      }
    },
    onSettled: invalidate,
  });

  return { snooze };
}

// ---------------- memory (Memory Helper) ----------------
// Table arrives with migration 0017. Until it's applied — and in demo mode — this
// falls back to the local write overlay, the same way reminders and snoozes do, so
// the page works rather than showing an error nobody can act on.
export function useMemories() {
  return useQuery<MemoryEntry[]>({
    queryKey: ["memories"],
    queryFn: async () => {
      if (!supabase) return applyDemo<MemoryEntry>("memories", []);
      const { data, error } = await supabase
        .from("memories")
        .select("id,kind,client_id,body,source,pinned,created_at")
        .order("pinned", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) return applyDemo<MemoryEntry>("memories", []); // not migrated yet
      return data as MemoryEntry[];
    },
    retry: false,
  });
}

/**
 * Is this error "the table isn't there yet", as opposed to a real failure?
 *
 * The local-storage fallback below exists for exactly one situation: migration 0017
 * hasn't been applied, so nothing typed should be lost. Once the table DOES exist,
 * falling back on any error is actively harmful — the read path returns database
 * rows, so a locally-stashed entry is never displayed again. The user watches what
 * they typed disappear and is told nothing.
 *
 * So: fall back only for a missing table. Everything else (a rejected CHECK
 * constraint, an RLS refusal, a network failure) is surfaced.
 */
function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  // 42P01 = undefined_table (Postgres). PGRST205 = unknown table (PostgREST).
  if (error.code === "42P01" || error.code === "PGRST205") return true;
  return /relation .* does not exist|could not find the table/i.test(error.message ?? "");
}

export function useMemoryMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["memories"] });

  type MemoryInput = {
    kind: MemoryEntry["kind"];
    body: string;
    client_id?: string | null;
    source?: string;
    pinned?: boolean;
  };

  const create = useMutation({
    mutationFn: async (input: MemoryInput) => {
      const row = {
        kind: input.kind,
        body: input.body,
        client_id: input.client_id ?? null,
        source: input.source ?? "",
        pinned: input.pinned ?? false,
      };
      if (!supabase) {
        demoCreate("memories", { id: demoId(), created_at: new Date().toISOString(), ...row });
        return;
      }
      const { error } = await supabase.from("memories").insert(row);
      if (error) {
        if (!isMissingTable(error)) throw new Error(error.message || "Could not save that memory.");
        demoCreate("memories", { id: demoId(), created_at: new Date().toISOString(), ...row });
      }
    },
    onSettled: invalidate,
  });

  const update = useMutation({
    mutationFn: async ({ id, ...fields }: Partial<MemoryInput> & { id: string }) => {
      if (!supabase) { demoPatch("memories", id, fields); return; }
      const { error } = await supabase.from("memories").update(fields).eq("id", id);
      if (error) {

        if (!isMissingTable(error)) throw new Error(error.message || "Could not update that memory.");

        demoPatch("memories", id, fields);

      }
    },
    onSettled: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      if (!supabase) { demoDelete("memories", id); return; }
      const { error } = await supabase.from("memories").delete().eq("id", id);
      if (error) {

        if (!isMissingTable(error)) throw new Error(error.message || "Could not delete that memory.");

        demoDelete("memories", id);

      }
    },
    onSettled: invalidate,
  });

  return { create, update, remove };
}

// ---------------- notes (Notes) ----------------
// Table arrives with migration 0019. Same graceful pattern as memories: demo mode
// and a not-yet-migrated live workspace both fall back to the local write overlay,
// so nothing typed is lost and the page works rather than showing a dead error.
// The demo seed only shows for demo mode (no creds) — a live workspace waiting on
// the migration gets an empty pad, never invented notes.
const DEMO_NOTES: Note[] = [
  { id: "demo-note-1", client_id: null, title: "Office parking code", body: "Parking code for the Harrington office is 4471 — expires end of quarter.", pinned: true, created_at: "2026-07-18T09:00:00Z", updated_at: "2026-07-18T09:00:00Z" },
  { id: "demo-note-2", client_id: null, title: "Handover watch", body: "Priya mentioned she's switching PAs in Q1 — keep handover notes tidy.", pinned: false, created_at: "2026-07-20T14:00:00Z", updated_at: "2026-07-20T14:00:00Z" },
];

export function useNotes() {
  return useQuery<Note[]>({
    queryKey: ["notes"],
    queryFn: async () => {
      if (!supabase) return applyDemo<Note>("notes", DEMO_NOTES);
      const { data, error } = await supabase
        .from("notes")
        .select("id,client_id,title,body,pinned,created_at,updated_at")
        .order("pinned", { ascending: false })
        .order("updated_at", { ascending: false });
      if (error) return applyDemo<Note>("notes", []); // not migrated yet — empty, never invented
      return data as Note[];
    },
    retry: false,
  });
}

export function useNoteMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["notes"] });

  type NoteInput = {
    title?: string;
    body: string;
    client_id?: string | null;
    pinned?: boolean;
  };

  const create = useMutation({
    mutationFn: async (input: NoteInput) => {
      const row = {
        title: input.title ?? "",
        body: input.body,
        client_id: input.client_id ?? null,
        pinned: input.pinned ?? false,
      };
      if (!supabase) {
        const now = new Date().toISOString();
        demoCreate("notes", { id: demoId(), created_at: now, updated_at: now, ...row });
        return;
      }
      const { error } = await supabase.from("notes").insert(row);
      if (error) {
        // Only a genuinely missing table falls back; every other error is surfaced,
        // so a rejected write never masquerades as a save (see memories, 0017).
        if (!isMissingTable(error)) throw new Error(error.message || "Could not save that note.");
        const now = new Date().toISOString();
        demoCreate("notes", { id: demoId(), created_at: now, updated_at: now, ...row });
      }
    },
    onSettled: invalidate,
  });

  const update = useMutation({
    mutationFn: async ({ id, ...fields }: Partial<NoteInput> & { id: string }) => {
      if (!supabase) { demoPatch("notes", id, { ...fields, updated_at: new Date().toISOString() }); return; }
      const { error } = await supabase.from("notes").update(fields).eq("id", id);
      if (error) {
        if (!isMissingTable(error)) throw new Error(error.message || "Could not update that note.");
        demoPatch("notes", id, { ...fields, updated_at: new Date().toISOString() });
      }
    },
    onSettled: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      if (!supabase) { demoDelete("notes", id); return; }
      const { error } = await supabase.from("notes").delete().eq("id", id);
      if (error) {
        if (!isMissingTable(error)) throw new Error(error.message || "Could not delete that note.");
        demoDelete("notes", id);
      }
    },
    onSettled: invalidate,
  });

  return { create, update, remove };
}

// ---------------- delegation ----------------
// Reassigning a task. In live mode the trigger from migration 0015 writes the
// task_events row; here we only change the field. In demo mode there is no DB, so
// both the assignment and its audit entry are kept in localStorage.
export function useAssignTask() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({
      task_id, from, to, actor_id,
    }: { task_id: string; from: string | null; to: string | null; actor_id: string }) => {
      if (!supabase) { saveAssignee(task_id, from, to, actor_id); return; }
      const { error } = await supabase.from("tasks").update({ assignee_id: to }).eq("id", task_id);
      if (error) throw error;
    },
    onMutate: async ({ task_id, to }) => {
      await qc.cancelQueries({ queryKey: ["tasks"] });
      const prev = qc.getQueryData<Task[]>(["tasks"]);
      qc.setQueryData<Task[]>(["tasks"], (ts) =>
        (ts ?? []).map((t) => (t.id === task_id ? { ...t, assignee_id: to } : t)),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(["tasks"], ctx.prev),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["task_events"] });
    },
  });
}

/** Reassignment history. Feeds the client activity timeline. */
export function useTaskEvents() {
  return useQuery<TaskEvent[]>({
    queryKey: ["task_events"],
    queryFn: async () => {
      if (!supabase) return loadDemoTaskEvents();
      const { data, error } = await supabase
        .from("task_events")
        .select("id,task_id,actor_id,from_user_id,to_user_id,created_at")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) return loadDemoTaskEvents(); // table not migrated yet
      return data as TaskEvent[];
    },
    retry: false,
  });
}
