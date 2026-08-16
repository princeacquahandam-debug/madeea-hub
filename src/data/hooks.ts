import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import * as seed from "@/data/seed";
import type { Task, TaskStatus, Client, Meeting, Message, MailboxSync, MeetingNote, MeetingDecision, FathomSyncState, Automation, Sop, SopRun, AutomationRun, Reminder, Snooze, TaskEvent, EodReport, TimeEntry, Recording, TaskComment, TaskActivity, WorkspaceFile, SavedItem, Routine, Credential, AcademyModule, AcademyLesson, AcademyQuestion, AcademyAttempt, AcademyStatus, GradeResult } from "@/types/db";
import type { ClientDoc } from "@/lib/meetingPrep";
import type { MemoryEntry } from "@/lib/memory";
import type { Note } from "@/lib/notes";
import { IMPORTED_EOD } from "@/data/eodImport";
import { loadDemoEod, saveDemoEod, removeDemoEod } from "@/store/demoEod";
import { addDemoTask, loadDemoTasks, loadTaskPatches, removeDemoTask, updateDemoTask } from "@/store/demoTasks";
import { addDemoTime, loadDemoTime, removeDemoTime, updateDemoTime } from "@/store/demoTime";
import { addDemoRecording, loadDemoRecordings, removeDemoRecording } from "@/store/demoRecordings";
import { addDemoActivity, addDemoComment, loadDemoActivity, loadDemoComments, removeDemoComment } from "@/store/demoComments";
import { addDemoFile, addDemoSaved, loadDemoFiles, loadDemoSaved, removeDemoFile, removeDemoSaved } from "@/store/demoFiles";
import { addDemoRoutine, claimDemoRun, loadDemoRoutines, removeDemoRoutine, updateDemoRoutine } from "@/store/demoRoutines";
import { addDemoAttempt, loadDemoAttempts, loadDemoProgress, setDemoProgress } from "@/store/demoAcademy";
import * as academy from "@/data/academySeed";
import { isoDate, nextOccurrences } from "@/lib/recurrence";
import type { Sealed } from "@/lib/vault";
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
  // Keep the FK, not just the joined name, the timeline needs to match on id.
  client_id: r.client_id ?? null,
  assignee_id: (r as { assignee_id?: string | null }).assignee_id ?? null,
  /* blocked / blocker_note were being dropped here. The row carried them (the
     select is `*`) but this mapper never copied them across, so in LIVE mode
     every task arrived unblocked and the EOD draft's blockers section could
     never populate, the one place the board is supposed to feed it. Demo mode
     hid it, because the seed objects are used as-is and skip this function. */
  blocked: (r as { blocked?: boolean }).blocked ?? false,
  blocker_note: (r as { blocker_note?: string | null }).blocker_note ?? null,
  // Migration 0030. Defaulted, so the board works before it is applied.
  requires_approval: (r as { requires_approval?: boolean }).requires_approval ?? false,
  approved_by: (r as { approved_by?: string | null }).approved_by ?? null,
  approved_at: (r as { approved_at?: string | null }).approved_at ?? null,
  // Migration 0026. Defaulted, so the app works before the migration is run.
  notes: (r as { notes?: string | null }).notes ?? null,
  progress: Array.isArray(r.progress) ? r.progress : [],
  attachments: Array.isArray(r.attachments) ? r.attachments : [],
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
        // Demo mode has no DB, so edits live in localStorage and are layered
        // over the seed tasks here: reassignments, and any other field change
        // (status being the one that matters, that is the board).
        const overrides = loadAssignees();
        const patches = loadTaskPatches();
        return [...loadDemoTasks(), ...seed.TASKS].map((t) => {
          const merged = t.id in patches ? { ...t, ...patches[t.id] } : t;
          return t.id in overrides ? { ...merged, assignee_id: overrides[t.id] } : merged;
        });
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

/**
 * A demo task as the APP sees it: the seed or created row with its overrides
 * applied.
 *
 * Reading the raw seed row is a trap that has bitten twice now. Every edit in
 * demo mode is stored as an override rather than written back into the seed
 * array, so `seed.TASKS.find(...)` returns the task as it shipped, not as it
 * is, which silently skipped the approval check on any task whose approval
 * flag had been set through the UI.
 */
function demoTask(id: string): Task | undefined {
  const base = [...loadDemoTasks(), ...seed.TASKS].find((t) => t.id === id);
  if (!base) return undefined;
  const patch = loadTaskPatches()[id];
  return patch ? { ...base, ...patch } : base;
}

export function useTaskMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["tasks"] });
    // Any task write may have produced activity, a status move, a priority
    // change, a due date. Refreshing the feed here keeps it honest without each
    // mutation having to know which verbs it triggered.
    qc.invalidateQueries({ queryKey: ["task_activity"] });
  };

  /**
   * Sign off on client-facing work (migration 0030).
   *
   * Stamping approved_at is all this does; moving it to done stays a separate,
   * deliberate act. Approving and completing in one click would make "approved"
   * mean somebody pressed a button, not that somebody read the work.
   */
  const approve = useMutation({
    mutationFn: async (id: string) => {
      const approved_at = new Date().toISOString();
      if (!supabase) {
        updateDemoTask(id, { approved_at, approved_by: "demo" });
        addDemoActivity({
          id: `act-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          task_id: id, actor_id: "demo", verb: "approved",
          from_value: null, to_value: null, created_at: approved_at,
        });
        return;
      }
      // approved_by is stamped by the trigger from auth.uid(), so it cannot be
      // set by hand to somebody who never looked at the work.
      const { error } = await supabase.from("tasks").update({ approved_at }).eq("id", id);
      if (error) throw error;
    },
    onSettled: invalidate,
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: TaskStatus }) => {
      if (!supabase) {
        /* The same rule the 0030 trigger enforces, so dragging a card to Done in
           demo behaves the way it will in production rather than differing in
           silence. Reads through demoTask, because the approval flag lives in
           the overrides store and not in the seed row. */
        const current = demoTask(id);
        if (status === "done" && current?.requires_approval && !current.approved_at) {
          throw new Error("This task needs approval before it can be completed.");
        }
        // Live, DB triggers stamp completed_at (0014/0016) and write the move to
        // task_activity (0029). Demo has no triggers, so mirror both here, the
        // activity feed being empty in the one mode the team reviews in is how
        // the drag bug hid for a week.
        const before = current;
        updateDemoTask(id, { status, completed_at: status === "done" ? new Date().toISOString() : null });
        if (before && before.status !== status) {
          addDemoActivity({
            id: `act-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            task_id: id, actor_id: "demo", verb: "status",
            from_value: before.status, to_value: status,
            created_at: new Date().toISOString(),
          });
        }
        return;
      }
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

  // client_id was always a column on `tasks`, but nothing ever set it, so every
  // task created in the app came out "Unassigned". Voice capture needs it, and so
  // does the manual form.
  type TaskInput = {
    title: string; priority?: Task["priority"]; due_at?: string | null;
    subtasks?: Task["subtasks"]; recurrence?: Task["recurrence"]; depends_on?: string | null;
    client_id?: string | null;
    assignee_id?: string | null;
    /** Declared blocker + reason (migration 0016). Feeds the EOD draft. */
    blocked?: boolean;
    blocker_note?: string | null;
    /* Migration 0026. Listed here as well as on the insert below: `update`
       spreads whatever it is given straight into Postgres, but `create` names
       its columns, so a field missing from that list is silently dropped and
       the form appears to save. */
    notes?: string | null;
    progress?: Task["progress"];
    attachments?: Task["attachments"];
    /* Which column it lands in. Defaults to todo, but the board's per-column
       "Add Task" needs to create it where it was asked for rather than making
       someone drag it across immediately. */
    status?: TaskStatus;
    /** Migration 0030. The DB refuses `done` while this is set and unapproved. */
    requires_approval?: boolean;
  };
  const create = useMutation({
    mutationFn: async (input: TaskInput) => {
      if (!supabase) {
        // The id is returned, not just written. A caller that needs to link
        // something to the new task (a workflow run, 0035) cannot do that if
        // create() reports nothing back.
        const id = `local-${Date.now()}`;
        addDemoTask({
          id,
          title: input.title,
          client_name: seed.CLIENTS.find((c) => c.id === input.client_id)?.name ?? "Unassigned",
          due_label: input.due_at ? new Date(`${input.due_at}T12:00:00`).toLocaleDateString("en-GB", { weekday: "long" }) : "",
          due_at: input.due_at ?? null,
          priority: input.priority ?? "normal",
          status: input.status ?? "todo",
          subtasks: input.subtasks ?? [],
          recurrence: input.recurrence ?? "none",
          depends_on: input.depends_on ?? null,
          // Demo mode dropped these, so a task created here belonged to nobody
          // and its blocker vanished, which left the EOD draft empty.
          client_id: input.client_id ?? null,
          assignee_id: input.assignee_id ?? null,
          blocked: input.blocked ?? false,
          blocker_note: input.blocker_note ?? null,
          notes: input.notes ?? null,
          progress: input.progress ?? [],
          attachments: input.attachments ?? [],
          completed_at: null,
        });
        return { id };
      }
      const { data, error } = await supabase.from("tasks").insert({
        title: input.title, priority: input.priority ?? "normal", due_at: input.due_at ?? null, status: input.status ?? "todo",
        subtasks: input.subtasks ?? [], recurrence: input.recurrence ?? "none", depends_on: input.depends_on ?? null,
        client_id: input.client_id ?? null,
        assignee_id: input.assignee_id ?? null,
        blocked: input.blocked ?? false,
        blocker_note: input.blocker_note ?? null,
        notes: input.notes ?? null,
        progress: input.progress ?? [],
        attachments: input.attachments ?? [],
        requires_approval: input.requires_approval ?? false,
      }).select("id").single();
      if (error) throw error;
      return { id: data.id as string };
    },
    onSettled: invalidate,
  });

  const update = useMutation({
    mutationFn: async ({ id, ...fields }: Partial<TaskInput> & { id: string }) => {
      if (!supabase) {
        /* Mirror what the 0029 trigger does, which fires on ANY update, not
           just the board's. Editing a task in the modal changes status through
           HERE, not through setStatus, so logging only there left the feed
           silent for exactly the edits people make most. */
        const before = demoTask(id);
        updateDemoTask(id, fields as Partial<Task>);
        if (before) {
          const at = new Date().toISOString();
          const log = (verb: string, from: string | null, to: string | null) =>
            addDemoActivity({
              id: `act-${Date.now()}-${Math.random().toString(36).slice(2)}`,
              task_id: id, actor_id: "demo", verb, from_value: from, to_value: to, created_at: at,
            });
          if (fields.status !== undefined && fields.status !== before.status) log("status", before.status, fields.status);
          if (fields.priority !== undefined && fields.priority !== before.priority) log("priority", before.priority, fields.priority);
          /* Compare the DAY, not the timestamp. The form sends "2026-08-16"
             while the stored value is "2026-08-16T17:00:00Z", so a raw compare
             logged a due-date change on every single save. */
          const day = (v?: string | null) => (v ? v.slice(0, 10) : null);
          if (fields.due_at !== undefined && day(fields.due_at) !== day(before.due_at)) {
            log("due", day(before.due_at), day(fields.due_at));
          }
          /* Seed tasks have no `blocked` key at all, and undefined !== false, so
             every save on one reported that it had just been unblocked. */
          if (fields.blocked !== undefined && fields.blocked !== (before.blocked ?? false)) {
            log(fields.blocked ? "blocked" : "unblocked", before.blocker_note ?? null, fields.blocker_note ?? null);
          }
        }
        return;
      }
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

  return { setStatus, create, update, remove, approve };
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
// prep packet opens. There's no need to hold every generation in memory.
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
        triage_reason: m.triage_reason ?? null,
        triage_source: m.triage_source ?? null,
        triage_confidence: m.triage_confidence ?? null,
        triaged_at: m.triaged_at ?? null,
        category_locked: m.category_locked ?? false,
        is_bulk: m.is_bulk ?? false,
      }));
    },
  });
}

// ---------------- Meeting Intelligence ----------------

export function useMeetingNotes() {
  return useQuery<MeetingNote[]>({
    queryKey: ["meeting-notes"],
    queryFn: async () => {
      if (!supabase) return [];
      const { data, error } = await supabase
        .from("meeting_notes")
        .select("id,fathom_recording_id,title,meeting_url,share_url,recorded_at,attendees,transcript_chars,summary,extracted,status,error,created_at")
        .order("recorded_at", { ascending: false, nullsFirst: false });
      if (error) return [];   // not migrated yet. Empty, never invented
      return (data as any[]).map((n) => ({
        ...n,
        attendees: Array.isArray(n.attendees) ? n.attendees : [],
        extracted: n.extracted && typeof n.extracted === "object" ? n.extracted : {},
      })) as MeetingNote[];
    },
    retry: false,
  });
}

export function useMeetingDecisions() {
  return useQuery<MeetingDecision[]>({
    queryKey: ["meeting-decisions"],
    queryFn: async () => {
      if (!supabase) return [];
      const { data, error } = await supabase
        .from("meeting_decisions")
        .select("id,meeting_note_id,decision,context,quote,timestamp_label,decided_at,created_at")
        .order("decided_at", { ascending: false, nullsFirst: false });
      if (error) return [];
      return data as MeetingDecision[];
    },
    retry: false,
  });
}

export function useFathomSync() {
  return useQuery<FathomSyncState | null>({
    queryKey: ["fathom-sync"],
    queryFn: async () => {
      if (!supabase) return null;
      const { data, error } = await supabase
        .from("fathom_sync_state")
        .select("last_created_at,last_synced_at,last_status,last_error,meetings_seen,tasks_created,decisions_logged,memories_written")
        .maybeSingle();
      if (error) return null;
      return (data as FathomSyncState) ?? null;
    },
    retry: false,
  });
}

/**
 * Per-teammate health of the email organiser. Reads gmail_sync_state, which is
 * readable by any workspace member but writable only by the service role, so
 * this is a status view and never a control surface.
 */
export function useMailboxSync() {
  return useQuery<MailboxSync[]>({
    queryKey: ["mailbox-sync"],
    queryFn: async () => {
      if (!supabase) return [];
      const { data, error } = await supabase
        .from("gmail_sync_state")
        .select("owner_id,last_synced_at,last_status,last_error,messages_seen,messages_triaged")
        .order("last_synced_at", { ascending: false, nullsFirst: false });
      if (error) throw error;
      const rows = (data as any[]) ?? [];
      if (!rows.length) return [];

      // Names live in profiles; a missing profile must not hide a mailbox.
      const { data: profs } = await supabase
        .from("profiles").select("id,full_name").in("id", rows.map((r) => r.owner_id));
      const nameOf = new Map((profs ?? []).map((p: any) => [p.id, p.full_name]));

      return rows.map((r) => ({
        owner_id: r.owner_id,
        name: nameOf.get(r.owner_id) ?? "Team member",
        last_synced_at: r.last_synced_at ?? null,
        last_status: r.last_status ?? null,
        last_error: r.last_error ?? null,
        messages_seen: r.messages_seen ?? 0,
        messages_triaged: r.messages_triaged ?? 0,
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
      // applyDemo so a workflow authored in demo mode shows up beside the
      // seeded ones. Before this, "New workflow" appeared to do nothing.
      if (!supabase) return applyDemo("sops", seed.SOPS);
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
        .select("id,sop_id,client_id,task_id,checked,status,started_at,completed_at")
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
    mutationFn: async ({ sop_id, client_id, task_id }: { sop_id: string; client_id?: string | null; task_id?: string | null }) => {
      if (!supabase) {
        const run: SopRun = {
          id: demoId(), sop_id, client_id: client_id ?? null, task_id: task_id ?? null, checked: [],
          status: "in_progress", started_at: new Date().toISOString(), completed_at: null,
        };
        demoCreate("sop_runs", run);
        return run;
      }
      const { data, error } = await supabase
        .from("sop_runs")
        .insert({ sop_id, client_id: client_id ?? null, task_id: task_id ?? null, checked: [], status: "in_progress" })
        .select("id,sop_id,client_id,task_id,checked,status,started_at,completed_at")
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

  /* Authoring. The library was read-only: the only .from("sops") call was a
     select, so a workflow could only be created by writing SQL. A library
     nobody can add to stops being a library the first time the work changes.

     Admin-only, which is the policy 0007 already set and a deliberate product
     choice rather than an oversight: EAs run workflows, admins define them,
     which is what "standardised output" means (Rowena 54:55). */
  const saveSop = useMutation({
    mutationFn: async (sop: Omit<Sop, "id"> & { id?: string }) => {
      const row = {
        title: sop.title,
        description: sop.description,
        category: sop.category,
        steps: sop.steps,
        success_criteria: sop.success_criteria,
      };
      if (!supabase) {
        if (sop.id) demoPatch("sops", sop.id, row);
        else demoCreate("sops", { ...row, id: demoId() });
        return;
      }
      const { error } = sop.id
        ? await supabase.from("sops").update(row).eq("id", sop.id)
        : await supabase.from("sops").insert(row);
      if (error) throw error;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["sops"] }),
  });

  const removeSop = useMutation({
    mutationFn: async (id: string) => {
      if (!supabase) { demoDelete("sops", id); return; }
      // is_active rather than delete: runs reference this row, and past runs
      // are the record that the procedure was followed.
      const { error } = await supabase.from("sops").update({ is_active: false }).eq("id", id);
      if (error) throw error;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["sops"] }),
  });

  return { start, setChecked, complete, saveSop, removeSop };
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
      if (error) return []; // table not migrated yet. Degrade gracefully
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

// open_tasks / clients used to be hardcoded numbers here, a workload view that
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

/** The signed-in user in demo mode. There is no real auth, so assume the admin. */
export const DEMO_ME = "demo-1";

// Current user's role. NOTE: this is for UI gating only, the real boundary is
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
      if (!data || data.length === 0) throw new Error("Change not saved. Admin rights required, or the member is in another workspace.");
    },
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: async ({ user_id }: { user_id: string }) => {
      if (!supabase) { demoDelete("members", user_id); return; }
      const { data, error } = await supabase.from("memberships").delete().eq("user_id", user_id).select("user_id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("Not removed. Admin rights required, or the member is in another workspace.");
    },
    onSuccess: invalidate,
  });
  return { setRole, remove };
}

// Invite a teammate. The edge function verifies the caller is an admin and uses
// the service role server-side. If it isn't deployed yet, callers get a clear
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
        // back to local storage. Every other failure, an RLS refusal, a network
        // drop. Is thrown and surfaced. A snooze kept only in this browser would
        // diverge from the shared workspace and quietly mislead: the nag looks
        // silenced for everyone when it isn't.
        if (!isMissingTable(error)) throw new Error(error.message || "Couldn't snooze that. Please try again.");
        saveSnooze(item_type, item_id, until); // pre-migration fallback
      }
    },
    onSettled: invalidate,
  });

  return { snooze };
}

// ---------------- memory (Memory Helper) ----------------
// Table arrives with migration 0017. Until it's applied (and in demo mode) this
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
 * falling back on any error is actively harmful, the read path returns database
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
// The demo seed only shows for demo mode (no creds), a live workspace waiting on
// the migration gets an empty pad, never invented notes.
const DEMO_NOTES: Note[] = [
  { id: "demo-note-1", client_id: null, title: "Office parking code", body: "Parking code for the Harrington office is 4471. Expires end of quarter.", pinned: true, created_at: "2026-07-18T09:00:00Z", updated_at: "2026-07-18T09:00:00Z" },
  { id: "demo-note-2", client_id: null, title: "Handover watch", body: "Priya mentioned she's switching PAs in Q1. Keep handover notes tidy.", pinned: false, created_at: "2026-07-20T14:00:00Z", updated_at: "2026-07-20T14:00:00Z" },
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
      if (error) return applyDemo<Note>("notes", []); // not migrated yet. Empty, never invented
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

// ---------------- EOD reports ----------------

/**
 * Every EOD report: the imported July sheet history plus anything submitted
 * since. Falls back to the July import alone when the table isn't migrated yet
 * or we're in demo mode, so the page never goes blank.
 */
export function useEodReports() {
  return useQuery<EodReport[]>({
    queryKey: ["eod_reports"],
    queryFn: async () => {
      if (!supabase) return [...IMPORTED_EOD, ...loadDemoEod()];
      const { data, error } = await supabase
        .from("eod_reports")
        .select("id,owner_id,person_name,report_date,done,blockers,plans,notes,raw,submitted_at")
        .order("report_date", { ascending: false });
      if (error) return IMPORTED_EOD; // migration 0016 not applied yet
      return (data as (Omit<EodReport, "person"> & { person_name: string })[]).map((r) => ({
        ...r,
        person: r.person_name,
      }));
    },
    retry: false,
  });
}

// ---------------- task comments + activity (migration 0029) ----------------

/** The thread on one task. Everyone in the workspace can read it. */
export function useTaskComments(taskId: string | null) {
  return useQuery<TaskComment[]>({
    queryKey: ["task_comments", taskId],
    enabled: Boolean(taskId),
    queryFn: async () => {
      if (!taskId) return [];
      if (!supabase) return loadDemoComments().filter((c) => c.task_id === taskId);
      const { data, error } = await supabase
        .from("task_comments")
        .select("id,task_id,author_id,body,mentions,created_at,edited_at")
        .eq("task_id", taskId)
        .order("created_at");
      if (error) return []; // migration not applied yet
      return data as TaskComment[];
    },
    retry: false,
  });
}

/** What happened to one task, newest first. Read-only by construction. */
export function useTaskActivity(taskId: string | null) {
  return useQuery<TaskActivity[]>({
    queryKey: ["task_activity", taskId],
    enabled: Boolean(taskId),
    queryFn: async () => {
      if (!taskId) return loadDemoActivity().filter((a) => a.task_id === taskId);
      if (!supabase) return loadDemoActivity().filter((a) => a.task_id === taskId);
      const { data, error } = await supabase
        .from("task_activity")
        .select("id,task_id,actor_id,verb,from_value,to_value,created_at")
        .eq("task_id", taskId)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) return [];
      return data as TaskActivity[];
    },
    retry: false,
  });
}

/** How many comments each task has, for the count on the card. */
export function useCommentCounts() {
  return useQuery<Record<string, number>>({
    queryKey: ["task_comment_counts"],
    queryFn: async () => {
      const tally = (rows: { task_id: string }[]) =>
        rows.reduce<Record<string, number>>((acc, r) => { acc[r.task_id] = (acc[r.task_id] ?? 0) + 1; return acc; }, {});
      if (!supabase) return tally(loadDemoComments());
      const { data, error } = await supabase.from("task_comments").select("task_id").limit(2000);
      if (error) return {};
      return tally(data as { task_id: string }[]);
    },
    retry: false,
  });
}

export function useCommentMutations() {
  const qc = useQueryClient();
  const invalidate = (taskId: string) => {
    qc.invalidateQueries({ queryKey: ["task_comments", taskId] });
    qc.invalidateQueries({ queryKey: ["task_activity", taskId] });
    qc.invalidateQueries({ queryKey: ["task_comment_counts"] });
  };

  const add = useMutation({
    mutationFn: async ({ taskId, body }: { taskId: string; body: string }) => {
      if (!supabase) {
        addDemoComment({
          id: demoId(), task_id: taskId, author_id: "demo", body,
          created_at: new Date().toISOString(), author_name: "You",
        });
        return;
      }
      // author_id defaults to auth.uid(); the write policy requires it to match,
      // so there is nothing here a client could forge.
      const { error } = await supabase.from("task_comments").insert({ task_id: taskId, body });
      if (error) throw error;
    },
    onSuccess: (_d, v) => invalidate(v.taskId),
  });

  const remove = useMutation({
    mutationFn: async ({ id }: { id: string; taskId: string }) => {
      if (!supabase) { removeDemoComment(id); return; }
      const { error } = await supabase.from("task_comments").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => invalidate(v.taskId),
  });

  return { add, remove };
}

// ---------------- credential vault (migration 0033) ----------------

/** Salt and verifier for the workspace. Null salt means the vault is unset up. */
export function useVaultMeta() {
  return useQuery<{ salt: string | null; verifier: Sealed | null }>({
    queryKey: ["vault_meta"],
    queryFn: async () => {
      if (!supabase) {
        return {
          salt: localStorage.getItem("madeea-demo-vault-salt"),
          verifier: JSON.parse(localStorage.getItem("madeea-demo-vault-verifier") || "null"),
        };
      }
      const { data, error } = await supabase.from("workspaces").select("vault_salt,vault_verifier").limit(1).maybeSingle();
      if (error || !data) return { salt: null, verifier: null };
      return { salt: data.vault_salt ?? null, verifier: (data.vault_verifier as Sealed) ?? null };
    },
    retry: false,
  });
}

export function useCredentials() {
  return useQuery<Credential[]>({
    queryKey: ["credentials"],
    queryFn: async () => {
      if (!supabase) return JSON.parse(localStorage.getItem("madeea-demo-credentials") || "[]");
      const { data, error } = await supabase
        .from("credentials")
        .select("id,label,url,username,category,notes,secret_ciphertext,secret_nonce,key_version,client_id,rotated_at,created_at")
        .order("label");
      if (error) return []; // migration not applied yet
      return data as Credential[];
    },
    retry: false,
  });
}

export function useCredentialMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["credentials"] });
    qc.invalidateQueries({ queryKey: ["vault_meta"] });
  };

  /** First-time setup: store the salt and a verifier, never the passphrase. */
  const initVault = useMutation({
    mutationFn: async ({ salt, verifier }: { salt: string; verifier: Sealed }) => {
      if (!supabase) {
        localStorage.setItem("madeea-demo-vault-salt", salt);
        localStorage.setItem("madeea-demo-vault-verifier", JSON.stringify(verifier));
        return;
      }
      const { data: ws } = await supabase.from("workspaces").select("id").limit(1).maybeSingle();
      if (!ws) throw new Error("No workspace.");
      const { error } = await supabase.from("workspaces").update({ vault_salt: salt, vault_verifier: verifier }).eq("id", ws.id);
      if (error) throw error;
    },
    onSettled: invalidate,
  });

  const save = useMutation({
    mutationFn: async (row: Omit<Credential, "id" | "created_at" | "rotated_at">) => {
      if (!supabase) {
        const rows: Credential[] = JSON.parse(localStorage.getItem("madeea-demo-credentials") || "[]");
        rows.push({ ...row, id: demoId(), rotated_at: null, created_at: new Date().toISOString() });
        localStorage.setItem("madeea-demo-credentials", JSON.stringify(rows));
        return;
      }
      const { error } = await supabase.from("credentials").insert(row);
      if (error) throw error;
    },
    onSettled: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      if (!supabase) {
        const rows: Credential[] = JSON.parse(localStorage.getItem("madeea-demo-credentials") || "[]");
        localStorage.setItem("madeea-demo-credentials", JSON.stringify(rows.filter((r) => r.id !== id)));
        return;
      }
      const { error } = await supabase.from("credentials").delete().eq("id", id);
      if (error) throw error;
    },
    onSettled: invalidate,
  });

  /** Append-only. The table has no update or delete policy, by design. */
  const logAccess = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: "view" | "copy" | "reveal" }) => {
      if (!supabase) return;
      await supabase.from("credential_access_log").insert({ credential_id: id, action });
    },
  });

  return { initVault, save, remove, logAccess };
}

// ---------------- routines (migration 0032) ----------------

export function useRoutines() {
  return useQuery<Routine[]>({
    queryKey: ["routines"],
    queryFn: async () => {
      if (!supabase) return loadDemoRoutines();
      const { data, error } = await supabase
        .from("routines")
        .select("id,name,task_template,rrule,timezone,client_id,assignee_id,is_active,lead_days,last_run_on,created_at")
        .order("created_at", { ascending: false });
      if (error) return []; // migration not applied yet
      return data as Routine[];
    },
    retry: false,
  });
}

export function useRoutineMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["routines"] });
    qc.invalidateQueries({ queryKey: ["tasks"] });
  };

  const create = useMutation({
    mutationFn: async (input: Omit<Routine, "id" | "created_at" | "last_run_on">) => {
      if (!supabase) {
        addDemoRoutine({ ...input, id: demoId(), last_run_on: null, created_at: new Date().toISOString() });
        return;
      }
      const { error } = await supabase.from("routines").insert(input);
      if (error) throw error;
    },
    onSettled: invalidate,
  });

  const update = useMutation({
    mutationFn: async ({ id, ...patch }: Partial<Routine> & { id: string }) => {
      if (!supabase) { updateDemoRoutine(id, patch); return; }
      const { error } = await supabase.from("routines").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSettled: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      if (!supabase) { removeDemoRoutine(id); return; }
      const { error } = await supabase.from("routines").delete().eq("id", id);
      if (error) throw error;
    },
    onSettled: invalidate,
  });

  /**
   * Turn everything due into real tasks.
   *
   * There is no job runner in this stack, the plan assumes Inngest and we do
   * not have it, so this is called when the Routines page opens. That is
   * enough here for one reason: attendance gating means an EA opens this app
   * every working morning, so "when someone opens it" and "daily" are the same
   * event in practice.
   *
   * Safe to call as often as you like. Live, a unique index on
   * (routine_id, occurrence_date) makes a second attempt a no-op; demo mirrors
   * that with a claimed-runs list. Neither relies on this being called once.
   */
  const materialize = useMutation({
    mutationFn: async (routines: Routine[]) => {
      const today = new Date();
      const created: string[] = [];

      for (const r of routines) {
        if (!r.is_active) continue;
        // Look ahead by the lead time: a routine with 2 lead days should have
        // created Friday's task on Wednesday.
        const horizon = new Date(today);
        horizon.setDate(horizon.getDate() + Math.max(0, r.lead_days));

        for (const occ of nextOccurrences(r.rrule, today, 8)) {
          if (occ > isoDate(horizon)) break;
          if (!supabase) {
            if (!claimDemoRun(r.id, occ)) continue;
            addDemoTask({
              id: `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
              title: r.task_template.title || r.name,
              client_name: seed.CLIENTS.find((c) => c.id === r.client_id)?.name ?? "Unassigned",
              due_label: "", due_at: occ,
              priority: r.task_template.priority ?? "normal",
              status: "todo", subtasks: [], recurrence: "none", depends_on: null,
              client_id: r.client_id, assignee_id: r.assignee_id,
              blocked: false, blocker_note: null, notes: r.task_template.notes ?? null,
              progress: [], attachments: [], completed_at: null,
            });
            created.push(occ);
            continue;
          }
          const { data, error } = await supabase.rpc("materialize_routine_occurrence", {
            p_routine_id: r.id,
            p_occurrence: occ,
          });
          if (error) throw error;
          if (data) created.push(occ);
        }
      }
      return created.length;
    },
    onSettled: invalidate,
  });

  return { create, update, remove, materialize };
}

// ---------------- files + saved (migration 0031) ----------------

export function useFiles() {
  return useQuery<WorkspaceFile[]>({
    queryKey: ["files"],
    queryFn: async () => {
      if (!supabase) return loadDemoFiles();
      const { data, error } = await supabase
        .from("files")
        .select("id,folder_id,client_id,task_id,name,mime_type,size_bytes,storage_key,uploaded_by,created_at")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) return []; // migration not applied yet
      return data as WorkspaceFile[];
    },
    retry: false,
  });
}

export function useFileMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["files"] });

  const upload = useMutation({
    mutationFn: async ({ file, clientId }: { file: File; clientId?: string | null }) => {
      if (!supabase) {
        addDemoFile(
          {
            id: demoId(), folder_id: null, client_id: clientId ?? null, task_id: null,
            name: file.name, mime_type: file.type || null, size_bytes: file.size,
            storage_key: "", uploaded_by: "demo", created_at: new Date().toISOString(),
          },
          URL.createObjectURL(file),
        );
        return;
      }
      /* Path carries the original name so a download does not arrive called
         "8f3a-2b1c". Prefixed with a timestamp because two people uploading
         "invoice.pdf" must not overwrite each other. */
      const safe = file.name.replace(/[^\w.\-]+/g, "_");
      const key = `${Date.now()}-${safe}`;
      const up = await supabase.storage.from("workspace-files").upload(key, file, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });
      if (up.error) throw up.error;
      const { error } = await supabase.from("files").insert({
        name: file.name, mime_type: file.type || null, size_bytes: file.size,
        storage_key: key, client_id: clientId ?? null,
      });
      if (error) throw error;
    },
    onSettled: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (f: WorkspaceFile) => {
      if (!supabase) { removeDemoFile(f.id); return; }
      // Object first: a failure here leaves the row pointing at it for a retry,
      // where the reverse orphans the object with nothing referencing it.
      if (f.storage_key) await supabase.storage.from("workspace-files").remove([f.storage_key]);
      const { error } = await supabase.from("files").delete().eq("id", f.id);
      if (error) throw error;
    },
    onSettled: invalidate,
  });

  return { upload, remove };
}

/** A signed URL to download. Private bucket, so links expire. */
export async function fileUrl(f: WorkspaceFile): Promise<string | null> {
  if (!supabase) return f.local_url ?? null;
  const { data, error } = await supabase.storage.from("workspace-files").createSignedUrl(f.storage_key, 3600);
  return error ? null : data.signedUrl;
}

export function useSaved() {
  return useQuery<SavedItem[]>({
    queryKey: ["saved_items"],
    queryFn: async () => {
      if (!supabase) return loadDemoSaved();
      const { data, error } = await supabase
        .from("saved_items")
        .select("id,kind,target_id,label,created_at")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) return [];
      return data as SavedItem[];
    },
    retry: false,
  });
}

export function useSavedMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["saved_items"] });

  const toggle = useMutation({
    mutationFn: async ({ kind, targetId, label, saved }: { kind: SavedItem["kind"]; targetId: string; label?: string; saved: boolean }) => {
      if (!supabase) {
        if (saved) removeDemoSaved(kind, targetId);
        else addDemoSaved({ id: demoId(), kind, target_id: targetId, label: label ?? null, created_at: new Date().toISOString() });
        return;
      }
      if (saved) {
        const { error } = await supabase.from("saved_items").delete().eq("kind", kind).eq("target_id", targetId);
        if (error) throw error;
        return;
      }
      const { error } = await supabase.from("saved_items").insert({ kind, target_id: targetId, label: label ?? null });
      if (error) throw error;
    },
    onSettled: invalidate,
  });

  return { toggle };
}

// ---------------- SOP recordings (migration 0028) ----------------

/**
 * Recordings, newest first. Yours only, the RLS policy says so and so does the
 * product decision behind it: a recording of an EA working shows their inbox
 * and other clients' names, and they will only record honestly if it is not
 * being watched. The SOP written from it is the shareable artifact.
 */
export function useRecordings() {
  return useQuery<Recording[]>({
    queryKey: ["recordings"],
    queryFn: async () => {
      if (!supabase) return loadDemoRecordings();
      const { data, error } = await supabase
        .from("recordings")
        .select("id,title,storage_path,duration_seconds,has_audio,sop_id,created_at,expires_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) return []; // migration not applied yet
      return data as Recording[];
    },
    retry: false,
  });
}

export function useRecordingMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["recordings"] });

  const save = useMutation({
    mutationFn: async (input: { title: string; blob: Blob; durationSeconds: number; hasAudio: boolean }) => {
      if (!supabase) {
        /* Demo mode keeps the blob in memory for this session only. Writing a
           multi-megabyte video into localStorage would blow the ~5MB quota on
           the first recording and take every other demo store down with it. */
        addDemoRecording({
          id: demoId(),
          title: input.title,
          storage_path: null,
          duration_seconds: input.durationSeconds,
          has_audio: input.hasAudio,
          sop_id: null,
          created_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 30 * 864e5).toISOString(),
          local_url: URL.createObjectURL(input.blob),
        });
        return;
      }
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) throw new Error("Not signed in.");
      // Namespaced by user id because the storage policy checks the first path
      // segment. See 0028.
      const path = `${uid}/${Date.now()}.webm`;
      const up = await supabase.storage.from("sop-recordings").upload(path, input.blob, {
        contentType: "video/webm",
        upsert: false,
      });
      if (up.error) throw up.error;
      const { error } = await supabase.from("recordings").insert({
        title: input.title,
        storage_path: path,
        duration_seconds: input.durationSeconds,
        has_audio: input.hasAudio,
      });
      if (error) throw error;
    },
    onSettled: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (r: Recording) => {
      if (!supabase) { removeDemoRecording(r.id); return; }
      // File first: if this fails the row keeps its path and a retry can still
      // find the object. Blanking the row first orphans the file forever.
      if (r.storage_path) await supabase.storage.from("sop-recordings").remove([r.storage_path]);
      const { error } = await supabase.from("recordings").delete().eq("id", r.id);
      if (error) throw error;
    },
    onSettled: invalidate,
  });

  return { save, remove };
}

/**
 * A time-limited URL for playback. The bucket is private, so there is no
 * permanent link to hand out, which is the point: a share is a decision with
 * an expiry, not a URL that outlives the reason it was sent.
 */
export async function recordingUrl(r: Recording): Promise<string | null> {
  if (!supabase) return r.local_url ?? null;
  if (!r.storage_path) return null; // purged at 30 days
  const { data, error } = await supabase.storage.from("sop-recordings").createSignedUrl(r.storage_path, 3600);
  return error ? null : data.signedUrl;
}

// ---------------- time tracking (migration 0027) ----------------

/** The EA's own local date as YYYY-MM-DD. Not toISOString(), which shifts the
 *  day for anyone west of UTC, and an EA in Manila finishing at 01:00 is still
 *  working the previous day. */
export function workDate(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** Seconds on an entry; counts up live while it is still running. */
export function entrySeconds(e: TimeEntry, now: number = Date.now()): number {
  const start = new Date(e.started_at).getTime();
  const end = e.ended_at ? new Date(e.ended_at).getTime() : now;
  return Math.max(0, Math.round((end - start) / 1000));
}

/**
 * Time entries. Yours, or everyone's for an admin, the RLS policy decides, so
 * the same query serves the EA's timesheet and HR's payroll view without the
 * client choosing which rows it is allowed to ask for.
 */
export function useTimeEntries() {
  return useQuery<TimeEntry[]>({
    queryKey: ["time_entries"],
    queryFn: async () => {
      if (!supabase) return loadDemoTime();
      const { data, error } = await supabase
        .from("time_entries")
        .select("id,owner_id,task_id,client_id,started_at,ended_at,note,work_date,tasks(title)")
        .order("started_at", { ascending: false })
        .limit(500);
      // Migration not applied yet: an empty timesheet is the honest answer, and
      // the page says so rather than showing an error where hours should be.
      if (error) return [];
      return (data as unknown as (TimeEntry & { tasks: { title: string } | null })[]).map((r) => ({
        ...r,
        task_title: r.tasks?.title ?? null,
      }));
    },
    retry: false,
  });
}

export function useTimeMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["time_entries"] });

  const start = useMutation({
    mutationFn: async (input: { task_id?: string | null; client_id?: string | null; note?: string | null }) => {
      const row = {
        task_id: input.task_id ?? null,
        client_id: input.client_id ?? null,
        note: input.note ?? null,
        started_at: new Date().toISOString(),
        work_date: workDate(),
      };
      if (!supabase) {
        // Mirror the database's one-open-timer rule, or two tabs in demo would
        // leave two running clocks and a day that adds up to more than it was.
        const open = loadDemoTime().find((e) => !e.ended_at);
        if (open) updateDemoTime(open.id, { ended_at: new Date().toISOString() });
        addDemoTime({ id: demoId(), owner_id: "demo", ended_at: null, ...row });
        return;
      }
      const { error } = await supabase.from("time_entries").insert(row);
      if (error) throw error;
    },
    onSettled: invalidate,
  });

  const stop = useMutation({
    mutationFn: async (id: string) => {
      const ended_at = new Date().toISOString();
      if (!supabase) { updateDemoTime(id, { ended_at }); return; }
      const { error } = await supabase.from("time_entries").update({ ended_at }).eq("id", id);
      if (error) throw error;
    },
    onSettled: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      if (!supabase) { removeDemoTime(id); return; }
      const { error } = await supabase.from("time_entries").delete().eq("id", id);
      if (error) throw error;
    },
    onSettled: invalidate,
  });

  return { start, stop, remove };
}

/** Submit (or correct) today's report. Upserts on person + date. */
export function useSubmitEod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (report: Omit<EodReport, "id" | "owner_id">) => {
      if (!supabase) {
        saveDemoEod({ ...report, id: demoId(), owner_id: "demo" } as EodReport);
        return;
      }
      // owner_id defaults to auth.uid(), and a BEFORE trigger (migration 0019)
      // overwrites person_name with the owner's profile name. So the value sent
      // here is only a fallback: two devices on the same account, or a stale
      // cached name, can no longer file under a second identity.
      const { error } = await supabase.from("eod_reports").upsert(
        {
          person_name: report.person,
          report_date: report.report_date,
          done: report.done,
          blockers: report.blockers,
          plans: report.plans,
          notes: report.notes ?? null,
        },
        { onConflict: "person_name,report_date" },
      );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["eod_reports"] }),
  });
}

/**
 * Delete a report. RLS decides who may: you can remove your own, and an admin
 * can remove any. Including the imported July rows, which have no owner.
 */
export function useDeleteEod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      if (!supabase) {
        removeDemoEod(id);
        return;
      }
      const { error } = await supabase.from("eod_reports").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["eod_reports"] }),
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

// ---------------- Made Ready Academy (migration 0034) ----------------
//
// Live mode reads the course from Postgres and grades through an RPC. Demo mode
// reads the same outline from src/data/academySeed.ts and grades locally, since
// there is no server to hide the answer key behind.

export function useAcademyCourse() {
  return useQuery<{ modules: AcademyModule[]; lessons: AcademyLesson[]; questions: AcademyQuestion[] }>({
    queryKey: ["academy-course"],
    staleTime: 60_000,
    queryFn: async () => {
      if (!supabase) return { modules: academy.MODULES, lessons: academy.LESSONS, questions: academy.QUESTIONS };
      const [m, l, q] = await Promise.all([
        supabase.from("academy_modules").select("id,day,title,summary,pass_pct,is_published,position").order("position"),
        supabase.from("academy_lessons").select("id,module_id,title,kind,body,video_url,minutes,position").order("position"),
        // No answer column exists to select. That is the design, not an omission.
        supabase.from("academy_questions").select("id,module_id,prompt,choices,explanation,position").order("position"),
      ]);
      // Migration not applied yet: fall back to the outline so the page explains
      // itself rather than rendering an empty screen.
      if (m.error) return { modules: academy.MODULES, lessons: academy.LESSONS, questions: academy.QUESTIONS };
      return {
        modules: (m.data ?? []) as AcademyModule[],
        lessons: (l.data ?? []) as AcademyLesson[],
        questions: (q.data ?? []) as AcademyQuestion[],
      };
    },
    retry: false,
  });
}

/** Lesson ids the signed-in user has finished. */
export function useAcademyProgress() {
  return useQuery<string[]>({
    queryKey: ["academy-progress"],
    queryFn: async () => {
      if (!supabase) return loadDemoProgress();
      const { data, error } = await supabase.from("academy_progress").select("lesson_id");
      if (error) return [];
      return (data ?? []).map((r) => r.lesson_id as string);
    },
    retry: false,
  });
}

export function useAcademyAttempts() {
  return useQuery<AcademyAttempt[]>({
    queryKey: ["academy-attempts"],
    queryFn: async () => {
      if (!supabase) return loadDemoAttempts();
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) return [];
      const { data, error } = await supabase
        .from("academy_attempts").select("id,user_id,module_id,score,passed,created_at")
        .eq("user_id", uid).order("created_at", { ascending: false });
      if (error) return [];
      return data as AcademyAttempt[];
    },
    retry: false,
  });
}

/** R-5.2.3. Admin only; see the note on the academy_status view. */
export function useAcademyRoster(enabled: boolean) {
  return useQuery<AcademyStatus[]>({
    queryKey: ["academy-roster"],
    enabled,
    queryFn: async () => {
      if (!supabase) {
        // Demo: the signed-in user is the only one with real attempts, so the
        // others are shown as not started rather than invented as complete.
        const passed = new Set(loadDemoAttempts().filter((a) => a.passed).map((a) => a.module_id));
        const total = academy.MODULES.filter((m) => m.is_published).length;
        return demoMembers().map((m) => ({
          user_id: m.user_id,
          modules_total: total,
          modules_passed: m.is_me ? passed.size : 0,
          last_passed_at: m.is_me ? (loadDemoAttempts().find((a) => a.passed)?.created_at ?? null) : null,
        }));
      }
      const { data, error } = await supabase.from("academy_status").select("*");
      if (error) return [];
      return data as AcademyStatus[];
    },
    retry: false,
  });
}

export function useAcademyMutations() {
  const qc = useQueryClient();

  const setLessonDone = useMutation({
    mutationFn: async ({ lessonId, done }: { lessonId: string; done: boolean }) => {
      if (!supabase) { setDemoProgress(lessonId, done); return; }
      if (done) {
        const { data: auth } = await supabase.auth.getUser();
        // upsert, so re-marking a finished lesson is a no-op rather than a
        // duplicate-key error the user would see as a failure.
        const { error } = await supabase
          .from("academy_progress")
          .upsert({ lesson_id: lessonId, user_id: auth.user?.id }, { onConflict: "user_id,lesson_id" });
        if (error) throw error;
      } else {
        const { error } = await supabase.from("academy_progress").delete().eq("lesson_id", lessonId);
        if (error) throw error;
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["academy-progress"] }),
  });

  const grade = useMutation({
    mutationFn: async ({ moduleId, answers }: { moduleId: string; answers: Record<string, number> }): Promise<GradeResult> => {
      if (!supabase) {
        const qs = academy.QUESTIONS.filter((q) => q.module_id === moduleId);
        const mod = academy.MODULES.find((m) => m.id === moduleId);
        const passPct = mod?.pass_pct ?? 80;
        const questions: GradeResult["questions"] = {};
        let correct = 0;
        for (const q of qs) {
          const ok = academy.demoKey(q.id) === answers[q.id];
          if (ok) correct++;
          questions[q.id] = { correct: ok, explanation: q.explanation };
        }
        const score = qs.length ? Math.floor((correct / qs.length) * 100) : 0;
        const passed = score >= passPct;
        addDemoAttempt({
          id: demoId(), user_id: DEMO_ME, module_id: moduleId,
          score, passed, created_at: new Date().toISOString(),
        });
        return { score, passed, correct, total: qs.length, pass_pct: passPct, questions };
      }
      // Live: the browser never sees the key, and never writes the attempt.
      const { data, error } = await supabase.rpc("grade_academy_attempt", {
        p_module_id: moduleId,
        p_answers: answers,
      });
      if (error) throw error;
      return data as GradeResult;
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["academy-attempts"] });
      qc.invalidateQueries({ queryKey: ["academy-roster"] });
    },
  });

  return { setLessonDone, grade };
}

// ---------------- alert routing (migration 0036) ----------------
//
// Where the app reaches out when something happens. The destination is a row
// rather than a constant, because nobody has settled where these land and
// picking a Slack channel on the team's behalf is not mine to do.

export interface AlertRoute {
  event: string;
  channel: "none" | "n8n";
  target: string | null;
  audience: "internal" | "client";
  is_active: boolean;
}

export function useAlertRoutes() {
  return useQuery<AlertRoute[]>({
    queryKey: ["alert-routes"],
    queryFn: async () => {
      // Demo mode has no server to route anything to, so it reports the honest
      // state rather than a switch that pretends to work.
      if (!supabase) return [{ event: "sla_breach", channel: "none", target: null, audience: "internal", is_active: false }];
      const { data, error } = await supabase
        .from("alert_routes").select("event,channel,target,audience,is_active");
      if (error) return []; // migration not applied yet; Settings says so
      return data as AlertRoute[];
    },
    retry: false,
  });
}

export function useAlertRouteMutations() {
  const qc = useQueryClient();
  const setRoute = useMutation({
    mutationFn: async ({ event, ...patch }: Partial<AlertRoute> & { event: string }) => {
      if (!supabase) return;
      const { error } = await supabase.from("alert_routes").update(patch).eq("event", event);
      if (error) throw error;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["alert-routes"] }),
  });
  return { setRoute };
}

/** What actually happened to the last alerts. The failure path, made visible. */
export function useAlertDeliveries(limit = 20) {
  return useQuery<{ id: string; event: string; subject_id: string; status: string; attempts: number; last_error: string | null; created_at: string }[]>({
    queryKey: ["alert-deliveries", limit],
    queryFn: async () => {
      if (!supabase) return [];
      const { data, error } = await supabase
        .from("alert_deliveries")
        .select("id,event,subject_id,status,attempts,last_error,created_at")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) return [];
      return data;
    },
    retry: false,
  });
}
