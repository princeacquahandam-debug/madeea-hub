import { useState } from "react";
import {
  DndContext, DragOverlay, PointerSensor, KeyboardSensor, useSensor, useSensors,
  useDraggable, useDroppable, closestCorners, type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { Plus, CheckSquare, Trash2, GripVertical } from "lucide-react";
import type { Task, TaskStatus, Priority } from "@/types/db";
import { Badge, PageHeader, Modal } from "@/components/ui";
import { useTasks, useTaskMutations } from "@/data/hooks";
import { cn } from "@/lib/utils";

const COLUMNS: { key: TaskStatus; label: string }[] = [
  { key: "todo", label: "To Do" },
  { key: "in_progress", label: "In Progress" },
  { key: "done", label: "Done" },
];
const priorityLabel: Record<string, string> = { urgent: "Urgent", high: "High", normal: "Normal", low: "Low" };

// Presentational card body (shared by the draggable card and the drag overlay)
function CardBody({ task, onDelete, dragging }: { task: Task; onDelete?: () => void; dragging?: boolean }) {
  return (
    <div className={cn("rounded-lg bg-surface-2 p-3 shadow-sm", dragging && "ring-2 ring-accent/60 shadow-lg")}>
      <div className="flex items-start gap-2">
        <GripVertical size={14} className="mt-0.5 shrink-0 text-faint" />
        <p className="flex-1 text-sm font-medium">{task.title}</p>
        {onDelete && (
          <button
            className="text-faint opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onDelete}
            aria-label="Delete task"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
      <p className="mt-1 pl-6 text-xs text-faint">{task.client_name} · {task.due_label}</p>
      <div className="mt-2 pl-6">
        <Badge tone={task.priority}>{priorityLabel[task.priority]}</Badge>
      </div>
    </div>
  );
}

function DraggableCard({ task, onDelete }: { task: Task; onDelete: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn("group cursor-grab touch-none active:cursor-grabbing", isDragging && "opacity-30")}
    >
      <CardBody task={task} onDelete={onDelete} />
    </div>
  );
}

function Column({ status, label, tasks, onDelete }: { status: TaskStatus; label: string; tasks: Task[]; onDelete: (id: string) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-sm font-semibold">{label}</h2>
        <span className="pill bg-surface-2 text-faint">{tasks.length}</span>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "min-h-[140px] space-y-2 rounded-lg transition-colors",
          isOver && "bg-accent/5 outline-dashed outline-1 outline-accent/40",
        )}
      >
        {tasks.map((t) => <DraggableCard key={t.id} task={t} onDelete={() => onDelete(t.id)} />)}
        {tasks.length === 0 && <p className="py-6 text-center text-xs text-faint">Drop here</p>}
      </div>
    </div>
  );
}

export default function Tasks() {
  const { data: tasks = [], isLoading } = useTasks();
  const { setStatus, create, remove } = useTaskMutations();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<Priority>("normal");
  const [due, setDue] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );
  const activeTask = tasks.find((t) => t.id === activeId) ?? null;

  function onDragStart(e: DragStartEvent) { setActiveId(String(e.active.id)); }
  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const over = e.over?.id as TaskStatus | undefined;
    if (!over) return;
    const task = tasks.find((t) => t.id === e.active.id);
    if (task && task.status !== over) setStatus.mutate({ id: task.id, status: over });
  }

  function submit() {
    if (!title.trim()) return;
    create.mutate({ title: title.trim(), priority, due_label: due.trim() || "—" });
    setTitle(""); setPriority("normal"); setDue(""); setAdding(false);
  }

  return (
    <div>
      <PageHeader
        title="Task Manager"
        subtitle="Drag cards between columns to update status"
        action={<button className="btn-primary" onClick={() => setAdding(true)}><Plus size={15} /> Add Task</button>}
      />

      {isLoading ? (
        <p className="text-sm text-faint">Loading tasks…</p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
          <div className="grid gap-4 lg:grid-cols-3">
            {COLUMNS.map((col) => (
              <Column
                key={col.key}
                status={col.key}
                label={col.label}
                tasks={tasks.filter((t) => t.status === col.key)}
                onDelete={(id) => remove.mutate(id)}
              />
            ))}
          </div>
          <DragOverlay>{activeTask ? <CardBody task={activeTask} dragging /> : null}</DragOverlay>
        </DndContext>
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
