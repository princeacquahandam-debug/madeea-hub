/**
 * Create-family tools. Each writes through the WorkspaceApi (local-first, with
 * live Supabase write-through wired in useCommandCenter) and returns a
 * `created` result the UI renders as a success card with a jump link.
 */
import { FolderPlus, CheckSquare, StickyNote, BellPlus } from "lucide-react";
import type { Tool } from "../types";

export const CreateProjectTool: Tool = {
  name: "Create Project",
  intent: "create_project",
  category: "create",
  description: "Create a new project in your workspace.",
  icon: FolderPlus,
  permissions: "safe",
  validate: (ctx) => (ctx.params.title?.trim() ? null : "What should the project be called?"),
  execute: async (ctx) => {
    const project = ctx.workspace.createProject(ctx.params.title.trim(), ctx.params.description);
    return { kind: "created", title: `Project “${project.title}” created`, detail: "Added to your workspace.", path: "/" };
  },
};

export const CreateTaskTool: Tool = {
  name: "Create Task",
  intent: "create_task",
  category: "create",
  description: "Add a task to your task list.",
  icon: CheckSquare,
  permissions: "safe",
  validate: (ctx) => (ctx.params.title?.trim() ? null : "What's the task?"),
  execute: async (ctx) => {
    const task = await ctx.workspace.createTask(ctx.params.title.trim());
    return { kind: "created", title: `Task added`, detail: task.title, path: "/tasks" };
  },
};

export const CreateNoteTool: Tool = {
  name: "Create Note",
  intent: "create_note",
  category: "create",
  description: "Capture a quick note.",
  icon: StickyNote,
  permissions: "safe",
  validate: (ctx) => (ctx.params.body?.trim() || ctx.params.title?.trim() ? null : "What should the note say?"),
  execute: async (ctx) => {
    const title = ctx.params.title?.trim() || "New note";
    const body = ctx.params.body?.trim() || title;
    const note = ctx.workspace.createNote(title, body);
    return { kind: "created", title: `Note saved`, detail: note.title, path: "/" };
  },
};

export const ReminderTool: Tool = {
  name: "Set Reminder",
  intent: "create_reminder",
  category: "create",
  description: "Schedule a reminder for later.",
  icon: BellPlus,
  permissions: "safe",
  validate: (ctx) => (ctx.params.label?.trim() ? null : "What should I remind you about?"),
  execute: async (ctx) => {
    const when = ctx.params.when?.trim() || "tomorrow";
    const reminder = await ctx.workspace.createReminder(ctx.params.label.trim(), when);
    return { kind: "created", title: `Reminder set for ${when}`, detail: reminder.label, path: "/tasks" };
  },
};
