/**
 * Local-first workspace store for entities the app doesn't model server-side
 * yet (projects, notes) plus a mirror of Command-Center-created tasks/reminders.
 *
 * Why local: in demo mode the seed data is empty and the Supabase mutations are
 * no-ops, so writes would vanish. Persisting here (localStorage) keeps the
 * Command Center genuinely functional — created items are immediately visible
 * and searchable — in both the hosted demo and a real deployment. When Supabase
 * IS configured, useCommandCenter also writes tasks/reminders through the live
 * mutations; this store then acts as an instant optimistic echo.
 */
import { create } from "zustand";
import type { Project, Note, LocalTask, LocalReminder } from "@/lib/command-center/types";

const KEY = "madeea-cc-workspace";

/** Stable unique id, resilient across browsers. */
export function uid(prefix = "id"): string {
  const rnd =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `${prefix}_${rnd}`;
}

interface Persisted {
  projects: Project[];
  notes: Note[];
  tasks: LocalTask[];
  reminders: LocalReminder[];
}

const empty: Persisted = { projects: [], notes: [], tasks: [], reminders: [] };

function load(): Persisted {
  try {
    return { ...empty, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    return empty;
  }
}

interface WorkspaceState extends Persisted {
  addProject: (title: string, description?: string) => Project;
  addNote: (title: string, body: string, projectId?: string) => Note;
  addTask: (title: string) => LocalTask;
  toggleTask: (id: string) => void;
  addReminder: (label: string, remindAt: string) => LocalReminder;
}

export const useWorkspace = create<WorkspaceState>((set, get) => {
  const persist = () => {
    const { projects, notes, tasks, reminders } = get();
    localStorage.setItem(KEY, JSON.stringify({ projects, notes, tasks, reminders }));
  };

  return {
    ...load(),
    addProject: (title, description) => {
      const project: Project = { id: uid("proj"), title, description, createdAt: Date.now() };
      set((s) => ({ projects: [project, ...s.projects] }));
      persist();
      return project;
    },
    addNote: (title, body, projectId) => {
      const note: Note = { id: uid("note"), title, body, projectId, createdAt: Date.now() };
      set((s) => ({ notes: [note, ...s.notes] }));
      persist();
      return note;
    },
    addTask: (title) => {
      const task: LocalTask = { id: uid("task"), title, done: false, createdAt: Date.now() };
      set((s) => ({ tasks: [task, ...s.tasks] }));
      persist();
      return task;
    },
    toggleTask: (id) => {
      set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t)) }));
      persist();
    },
    addReminder: (label, remindAt) => {
      const reminder: LocalReminder = { id: uid("rem"), label, remindAt, createdAt: Date.now() };
      set((s) => ({ reminders: [reminder, ...s.reminders] }));
      persist();
      return reminder;
    },
  };
});
