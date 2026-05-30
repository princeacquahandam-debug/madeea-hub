import { useState } from "react";
import { Plus, CheckSquare, Trash2 } from "lucide-react";
import type { Task, TaskStatus, Priority } from "@/types/db";
import { Badge, PageHeader, Modal } from "@/components/ui";
import { useTasks, useTaskMutations } from "@/data/hooks";

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
  const { data: tasks = [], isLoading } = useTasks();
  const { setStatus, create, remove } = useTaskMutations();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<Priority>("normal");
  const [due, setDue] = useState("");

  function submit() {
    if (!title.trim()) return;
    create.mutate({ title: title.trim(), priority, due_label: due.trim() || "—" });
    setTitle(""); setPriority("normal"); setDue(""); setAdding(false);
  }

  return (
    <div>
      <PageHeader
        title="Task Manager"
        subtitle="Manage and track all client tasks"
        action={<button className="btn-primary" onClick={() => setAdding(true)}><Plus size={15} /> Add Task</button>}
      />

      {isLoading ? (
        <p className="text-sm text-faint">Loading tasks…</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {COLUMNS.map((col) => {
            const items = tasks.filter((t: Task) => t.status === col.key);
            return (
              <div key={col.key} className="card p-4">
                <div className="mb-3 flex items-center gap-2">
                  <h2 className="text-sm font-semibold">{col.label}</h2>
                  <span className="pill bg-surface-2 text-faint">{items.length}</span>
                </div>
                <div className="space-y-2">
                  {items.map((t) => (
                    <div key={t.id} className="group rounded-lg bg-surface-2 p-3">
                      <div className="flex items-start gap-2">
                        <CheckSquare size={15} className="mt-0.5 text-faint" />
                        <p className="flex-1 text-sm font-medium">{t.title}</p>
                        <button
                          className="text-faint opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
                          onClick={() => remove.mutate(t.id)}
                          aria-label="Delete task"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                      <p className="mt-1 pl-6 text-xs text-faint">{t.client_name} · {t.due_label}</p>
                      <div className="mt-2 flex items-center justify-between pl-6">
                        <Badge tone={t.priority}>{priorityLabel[t.priority]}</Badge>
                        <div className="flex gap-1">
                          {NEXT[col.key].map((n) => (
                            <button
                              key={n.to}
                              className="rounded border border-border px-2 py-0.5 text-[11px] text-muted hover:border-accent/40 hover:text-zinc-100"
                              onClick={() => setStatus.mutate({ id: t.id, status: n.to })}
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
      )}

      <Modal open={adding} onClose={() => setAdding(false)}>
        <h2 className="mb-4 text-lg font-semibold">Add Task</h2>
        <div className="space-y-3">
          <div>
            <label className="field-label">Title</label>
            <input className="input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Draft investor update" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="field-label">Priority</label>
              <select className="input" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
                <option value="urgent">Urgent</option>
                <option value="high">High</option>
                <option value="normal">Normal</option>
                <option value="low">Low</option>
              </select>
            </div>
            <div>
              <label className="field-label">Due</label>
              <input className="input" value={due} onChange={(e) => setDue(e.target.value)} placeholder="e.g. Friday" />
            </div>
          </div>
          <button className="btn-primary w-full" onClick={submit} disabled={!title.trim() || create.isPending}>
            {create.isPending ? "Adding…" : "Add Task"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
