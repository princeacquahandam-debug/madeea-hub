import { useState } from "react";
import { Plus, CheckSquare } from "lucide-react";
import { TASKS } from "@/data/seed";
import type { Task, TaskStatus } from "@/types/db";
import { Badge, PageHeader } from "@/components/ui";

const COLUMNS: { key: TaskStatus; label: string }[] = [
  { key: "todo", label: "To Do" },
  { key: "in_progress", label: "In Progress" },
  { key: "done", label: "Done" },
];

const priorityLabel: Record<string, string> = { urgent: "Urgent", high: "High", normal: "Normal", low: "Low" };

const NEXT: Record<TaskStatus, { to: TaskStatus; label: string }[]> = {
  todo: [{ to: "in_progress", label: "In Progress" }, { to: "done", label: "Done" }],
  in_progress: [{ to: "todo", label: "To Do" }, { to: "done", label: "Done" }],
  done: [{ to: "todo", label: "To Do" }, { to: "in_progress", label: "In Progress" }],
};

export default function Tasks() {
  const [tasks, setTasks] = useState<Task[]>(TASKS);

  function move(id: string, to: TaskStatus) {
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, status: to } : t)));
  }

  function addTask() {
    const title = window.prompt("New task title");
    if (!title) return;
    setTasks((ts) => [
      { id: `t${Date.now()}`, title, client_name: "Unassigned", due_label: "—", priority: "normal", status: "todo" },
      ...ts,
    ]);
  }

  return (
    <div>
      <PageHeader
        title="Task Manager"
        subtitle="Manage and track all client tasks"
        action={
          <button className="btn-primary" onClick={addTask}>
            <Plus size={15} /> Add Task
          </button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        {COLUMNS.map((col) => {
          const items = tasks.filter((t) => t.status === col.key);
          return (
            <div key={col.key} className="card p-4">
              <div className="mb-3 flex items-center gap-2">
                <h2 className="text-sm font-semibold">{col.label}</h2>
                <span className="pill bg-surface-2 text-faint">{items.length}</span>
              </div>
              <div className="space-y-2">
                {items.map((t) => (
                  <div key={t.id} className="rounded-lg bg-surface-2 p-3">
                    <div className="flex items-start gap-2">
                      <CheckSquare size={15} className="mt-0.5 text-faint" />
                      <p className="flex-1 text-sm font-medium">{t.title}</p>
                    </div>
                    <p className="mt-1 pl-6 text-xs text-faint">
                      {t.client_name} · {t.due_label}
                    </p>
                    <div className="mt-2 flex items-center justify-between pl-6">
                      <Badge tone={t.priority}>{priorityLabel[t.priority]}</Badge>
                      <div className="flex gap-1">
                        {NEXT[col.key].map((n) => (
                          <button
                            key={n.to}
                            className="rounded border border-border px-2 py-0.5 text-[11px] text-muted hover:border-accent/40 hover:text-zinc-100"
                            onClick={() => move(t.id, n.to)}
                          >
                            {n.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
                {items.length === 0 && <p className="py-4 text-center text-xs text-faint">No tasks</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
