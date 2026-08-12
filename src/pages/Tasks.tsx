import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  DndContext, DragOverlay, PointerSensor, KeyboardSensor, useSensor, useSensors,
  useDroppable, closestCorners, type DragEndEvent, type DragOverEvent, type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext, useSortable, sortableKeyboardCoordinates, verticalListSortingStrategy, arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus, Trash2, GripVertical, Pencil, CalendarDays, CheckSquare, Repeat, Lock, X, Copy, Link2, Columns3, List as ListIcon, Search, MessageSquare, Send, ShieldCheck, Bookmark } from "lucide-react";
import type { Task, TaskStatus, Priority, Subtask, Recurrence, TaskProgress, TaskAttachment, TaskActivity } from "@/types/db";
import { Badge, PageHeader, Modal } from "@/components/ui";
import { SkeletonCard } from "@/components/Skeleton";
import { useTasks, useTaskMutations, useClients, useTaskComments, useTaskActivity, useCommentMutations, useCommentCounts, useMyRole, useSaved, useSavedMutations } from "@/data/hooks";
import { useFollowUps } from "@/hooks/useFollowUps";
import { AssigneePicker, AssigneeAvatar } from "@/components/Assignee";
import { useWorkspaceMembers } from "@/data/hooks";
import { FollowUpRow } from "@/components/FollowUpRow";
import { TASK_TEMPLATES, type TaskTemplate } from "@/lib/taskTemplates";
import { cn } from "@/lib/utils";

/* Each column is colour-washed, the way Wing's board is: To Do, In Progress and
   Done read as three different places at a glance rather than three identical
   grey trays you have to read the headings of.

   Their board is white with pastel fills. Ours is dark, so the same idea has to
   be inverted, a low-opacity wash over the navy, and a solid dot in the header
   carrying the actual colour. The palette is untouched: these are the tones the
   app already uses for pending, in-flight and done. */
const COLUMNS: { key: TaskStatus; label: string; dot: string; wash: string; edge: string }[] = [
  { key: "todo",        label: "To Do",       dot: "bg-sky-400",     wash: "bg-sky-500/[0.06]",     edge: "border-sky-500/25" },
  { key: "in_progress", label: "In Progress", dot: "bg-amber-400",   wash: "bg-amber-500/[0.06]",   edge: "border-amber-500/25" },
  // Where work that needs sign-off waits (migration 0030, PROJECT_PLAN §5.3).
  { key: "review",      label: "Review",      dot: "bg-violet-400",  wash: "bg-violet-500/[0.06]",  edge: "border-violet-500/25" },
  { key: "done",        label: "Done",        dot: "bg-emerald-400", wash: "bg-emerald-500/[0.06]", edge: "border-emerald-500/25" },
];
const priorityLabel: Record<string, string> = { urgent: "Urgent", high: "High", normal: "Normal", low: "Low" };

const dueDisplay = (t: Task): string =>
  t.due_at
    ? new Date(t.due_at).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" })
    : t.due_label || "No date";

/**
 * A short, stable reference for a task: "T-4F2A".
 *
 * So a task can be NAMED. "Can you look at T-4F2A" works in Slack, in an EOD
 * line and out loud; "the moodboard one, the second one down" does not. Derived
 * from the uuid rather than a counter, because a counter needs a sequence, a
 * migration and a backfill to say something the id already knows.
 */
function taskRef(id: string): string {
  return `T-${id.replace(/-/g, "").slice(-4).toUpperCase()}`;
}

/**
 * "Today" / "Tomorrow" / "Yesterday" where it helps, a date where it doesn't.
 * `tone` drives the colour: overdue is the only one worth alarming about.
 */
function relativeDue(t: Task): { label: string; tone: "over" | "soon" | "plain" } | null {
  if (!t.due_at) return t.due_label ? { label: t.due_label, tone: "plain" } : null;
  const p = (n: number) => String(n).padStart(2, "0");
  const today = new Date();
  const todayIso = `${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(today.getDate())}`;
  const due = t.due_at.slice(0, 10);
  // String compare, deliberately: both are YYYY-MM-DD in the same calendar, so
  // this cannot be knocked off by a timezone the way Date maths can.
  const diffDays = Math.round(
    (Date.parse(`${due}T12:00:00Z`) - Date.parse(`${todayIso}T12:00:00Z`)) / 864e5,
  );
  if (diffDays === 0) return { label: "Today", tone: "soon" };
  if (diffDays === 1) return { label: "Tomorrow", tone: "soon" };
  if (diffDays === -1) return { label: "Yesterday", tone: "over" };
  if (diffDays < 0) return { label: `${Math.abs(diffDays)}d overdue`, tone: "over" };
  return { label: dueDisplay(t), tone: "plain" };
}

const DUE_TONE: Record<"over" | "soon" | "plain", string> = {
  over: "text-red-400",
  soon: "text-amber-400",
  plain: "text-faint",
};

type Board = Record<TaskStatus, Task[]>;
const group = (tasks: Task[]): Board => ({
  todo: tasks.filter((t) => t.status === "todo"),
  in_progress: tasks.filter((t) => t.status === "in_progress"),
  review: tasks.filter((t) => t.status === "review"),
  done: tasks.filter((t) => t.status === "done"),
});

function CardBody({ task, blocked, onDelete, onEdit, onComplete, onSave, isSaved, comments = 0, overlay }: { task: Task; blocked?: boolean; onDelete?: () => void; onEdit?: () => void; onComplete?: () => void; onSave?: () => void; isSaved?: boolean; comments?: number; overlay?: boolean }) {
  const stop = (e: React.PointerEvent) => e.stopPropagation();
  const subDone = task.subtasks.filter((s) => s.done).length;
  const due = relativeDue(task);
  const links = task.attachments?.length ?? 0;
  const progress = task.progress?.length ?? 0;
  return (
    <div className={cn("rounded-lg bg-surface-2 p-3", overlay ? "shadow-xl ring-2 ring-accent/60 rotate-1" : "shadow-sm")}>
      {/* The reference, so this card can be named in a message or an EOD line. */}
      <p className="mb-1 pl-6 font-mono text-[10px] tracking-wide text-faint">{taskRef(task.id)}</p>
      <div className="flex items-start gap-2">
        <GripVertical size={14} className="mt-0.5 shrink-0 text-faint" />
        <p className="flex-1 text-sm font-medium">{task.title}</p>
        {/* Who this is for. Click to reassign, the overlay copy shown while dragging
            gets a plain avatar, since a menu inside a drag preview makes no sense. */}
        {overlay ? <AssigneeAvatar member={null} /> : <AssigneePicker task={task} />}
        {/* Saved stays lit once set, so the card shows its own state rather than
            hiding it until you hover. */}
        {onSave && (
          <button
            className={cn("icon-btn", isSaved ? "text-accent" : "reveal-on-hover text-faint hover:text-accent")}
            onPointerDown={stop}
            onClick={onSave}
            aria-label={isSaved ? "Remove from saved" : "Save this task"}
          >
            <Bookmark size={13} fill={isSaved ? "currentColor" : "none"} />
          </button>
        )}
        {onEdit && (
          <button className="icon-btn reveal-on-hover text-faint hover:text-accent" onPointerDown={stop} onClick={onEdit} aria-label="Edit task">
            <Pencil size={13} />
          </button>
        )}
        {onDelete && (
          <button className="icon-btn reveal-on-hover text-faint hover:text-red-400" onPointerDown={stop} onClick={onDelete} aria-label="Delete task">
            <Trash2 size={13} />
          </button>
        )}
      </div>
      {/* A line of the notes, so the card says what the job IS rather than only
          what it is called. Truncated to two lines; the rest is one click away. */}
      {task.notes?.trim() && (
        <p className="mt-1 line-clamp-2 pl-6 text-xs leading-snug text-muted">{task.notes}</p>
      )}

      <p className="mt-1 flex flex-wrap items-center gap-1 pl-6 text-xs text-faint">
        {task.client_name}
        {due && (
          <>
            <span>·</span>
            <CalendarDays size={11} />
            <span className={DUE_TONE[due.tone]}>{due.label}</span>
          </>
        )}
        {task.subtasks.length > 0 && <><span>·</span><CheckSquare size={11} />{subDone}/{task.subtasks.length}</>}
        {links > 0 && <><span>·</span><Link2 size={11} />{links}</>}
        {comments > 0 && <><span>·</span><MessageSquare size={11} />{comments}</>}
        {progress > 0 && <><span>·</span><ListIcon size={11} />{progress}</>}
        {task.recurrence !== "none" && <Repeat size={11} className="text-accent-soft" />}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2 pl-6">
        <Badge tone={task.priority}>{priorityLabel[task.priority]}</Badge>
        {/* Client-facing work that cannot be closed by whoever did it. */}
        {task.requires_approval && (
          <span
            className={cn("pill", task.approved_at ? "bg-emerald-500/15 text-emerald-400" : "bg-violet-500/15 text-violet-300")}
            title={task.approved_at ? "Approved" : "Needs sign-off before it can be completed"}
          >
            <ShieldCheck size={10} /> {task.approved_at ? "Approved" : "Needs approval"}
          </span>
        )}
        {/* Waiting on a dependency (derived from depends_on). */}
        {blocked && <span className="pill bg-amber-500/15 text-amber-400"><Lock size={10} /> Blocked</span>}
        {/* Someone said this is blocked and why. Feeds their EOD report. */}
        {task.blocked && (
          <span className="pill bg-red-500/15 text-red-400" title={task.blocker_note ?? undefined}>
            <Lock size={10} /> {task.blocker_note?.trim() ? task.blocker_note : "Blocked"}
          </span>
        )}
      </div>

      {/* Finishing something should not require opening it. Hidden until hover
          so a wall of cards stays readable, and absent on the drag overlay,
          where a button would be nonsense. */}
      {onComplete && task.status !== "done" && (
        <button
          onPointerDown={stop}
          onClick={onComplete}
          className="reveal-on-hover mt-2 ml-6 flex min-h-[24px] items-center gap-1.5 text-[11px] text-faint hover:text-emerald-400"
        >
          <CheckSquare size={12} /> Mark as complete
        </button>
      )}
    </div>
  );
}

function SortableCard({ task, blocked, onDelete, onEdit, onComplete, onSave, isSaved, comments, focused, justDropped }: { task: Task; blocked: boolean; onDelete: () => void; onEdit: () => void; onComplete: () => void; onSave: () => void; isSaved: boolean; comments?: number; focused?: boolean; justDropped?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  return (
    // data-task-id is the scroll anchor for the /tasks?task=<id> deep link from the
    // client activity timeline.
    <div ref={setNodeRef} data-task-id={task.id} style={{ transform: CSS.Transform.toString(transform), transition }} {...attributes} {...listeners}
      className={cn(
        "group touch-none cursor-grab rounded-lg active:cursor-grabbing",
        isDragging && "opacity-40",
        justDropped && "card-drop",
        focused && "ring-2 ring-accent ring-offset-2 ring-offset-bg",
      )}>
      <CardBody task={task} blocked={blocked} onDelete={onDelete} onEdit={onEdit} onComplete={onComplete} onSave={onSave} isSaved={isSaved} comments={comments} />
    </div>
  );
}

function Column({ status, label, dot, wash, edge, items, blockedIds, onDelete, onEdit, onComplete, onAdd, onSave, savedIds, commentCounts, focusId, justDroppedId, dropActive }: { status: TaskStatus; label: string; dot: string; wash: string; edge: string; items: Task[]; blockedIds: Set<string>; onDelete: (id: string) => void; onEdit: (t: Task) => void; onComplete: (id: string) => void; onAdd: (status: TaskStatus) => void; onSave: (t: Task) => void; savedIds: Set<string>; commentCounts: Record<string, number>; focusId?: string | null; justDroppedId?: string | null; dropActive?: boolean }) {
  /* useDroppable, not useSortable. A column is a container you drop INTO; it is
     never itself dragged. useSortable additionally registered each column as a
     draggable and, because it reads the nearest SortableContext above it. Of
     which there is none. Resolved its own index to -1.

     The highlight is driven by `dropActive` from the parent rather than this
     hook's own `isOver`. With closestCorners, hovering a column that already has
     cards resolves `over` to the nearest CARD, so the column's own isOver stays
     false and col-drop-active never applied, the class was effectively dead.
     The parent already computes the destination column, so it is the honest
     source for "where will this land". */
  const { setNodeRef } = useDroppable({ id: status, data: { type: "column" } });
  return (
    <div className={cn("flex flex-col overflow-hidden rounded-xl border transition-colors", edge, wash, dropActive && "col-drop-active")}>
      {/* Header carries the colour, and its own Add. You add a task WHERE it
          belongs rather than adding to To Do and dragging it across. */}
      <div className="flex items-center gap-2 border-b border-inherit px-3.5 py-2.5">
        <span className={cn("h-2 w-2 shrink-0 rounded-full", dot)} />
        <h2 className="text-[14px] font-bold">{label}</h2>
        <span className="pill bg-black/20 text-faint">{items.length}</span>
        <button
          onClick={() => onAdd(status)}
          className="ml-auto flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-faint transition-colors hover:bg-black/20 hover:text-zinc-100"
          aria-label={`Add a task to ${label}`}
        >
          <Plus size={12} /> Add Task
        </button>
      </div>
      <SortableContext id={status} items={items.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className="min-h-[180px] flex-1 space-y-2 p-3">
          {items.map((t) => <SortableCard key={t.id} task={t} blocked={blockedIds.has(t.id)} onDelete={() => onDelete(t.id)} onEdit={() => onEdit(t)} onComplete={() => onComplete(t.id)} onSave={() => onSave(t)} isSaved={savedIds.has(t.id)} comments={commentCounts[t.id] ?? 0} focused={focusId === t.id} justDropped={justDroppedId === t.id} />)}
          {items.length === 0 && (
            <p className="rounded-lg border border-dashed border-current/15 py-8 text-center text-xs text-faint">Drop here</p>
          )}
        </div>
      </SortableContext>
    </div>
  );
}

/* Reference links and files on a task (R-4.7.2).
 *
 * Links only for now, and the field says so rather than showing an upload
 * control that does nothing. P-1: a half-feature is worse than an absent one.
 * File upload needs a Supabase Storage bucket and a retention decision, which
 * is a deliberate choice rather than something to slip in. The stored shape
 * already carries kind:"file", so uploads drop in without a migration. */
function AttachmentsField({ items, onChange }: { items: TaskAttachment[]; onChange: (a: TaskAttachment[]) => void }) {
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");

  function add() {
    const u = url.trim();
    if (!u) return;
    // Bare domains are the common paste; without a scheme the anchor resolves
    // relative to the app and the link 404s inside the dashboard.
    const href = /^https?:\/\//i.test(u) ? u : `https://${u}`;
    onChange([...items, { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, kind: "link", label: label.trim() || href, url: href }]);
    setLabel(""); setUrl("");
  }

  return (
    <div>
      <label className="field-label">Links &amp; attachments (optional)</label>
      {items.length > 0 && (
        <div className="mb-2 space-y-1.5">
          {items.map((a) => (
            <div key={a.id} className="flex items-center gap-2 rounded-lg bg-surface-2 px-2.5 py-1.5">
              <Link2 size={13} className="shrink-0 text-faint" />
              <a href={a.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-[13px] text-accent-soft hover:underline">
                {a.label}
              </a>
              <button
                type="button"
                onClick={() => onChange(items.filter((x) => x.id !== a.id))}
                className="shrink-0 text-faint hover:text-red-400"
                aria-label={`Remove ${a.label}`}
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input className="input flex-1" placeholder="Label. E.g. Final deck" value={label} onChange={(e) => setLabel(e.target.value)} />
        <input
          className="input flex-[1.4]"
          placeholder="Paste a link (Google Doc, Drive, anything)"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
        />
        <button type="button" className="btn-ghost shrink-0" onClick={add} disabled={!url.trim()}>Add</button>
      </div>
    </div>
  );
}

/* Day-stamped progress on a multi-day task (R-4.7.4).
 *
 * Append-only. The point is remembering where you left off on day three, and
 * an editable log you can quietly rewrite is not a record of that. */
function ProgressField({ items, onAdd }: { items: TaskProgress[]; onAdd: (body: string) => void }) {
  const [body, setBody] = useState("");
  const commit = () => { const b = body.trim(); if (b) { onAdd(b); setBody(""); } };

  return (
    <div>
      <label className="field-label" htmlFor="task-progress">Progress log (optional)</label>
      {items.length > 0 && (
        <div className="mb-2 max-h-40 space-y-1.5 overflow-y-auto">
          {items.map((p, i) => (
            <div key={`${p.at}-${i}`} className="rounded-lg bg-surface-2 px-2.5 py-1.5">
              <p className="text-[11px] text-faint">{new Date(p.at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</p>
              <p className="text-[13px]">{p.body}</p>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input
          id="task-progress"
          className="input flex-1"
          placeholder="What moved today?"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } }}
        />
        <button type="button" className="btn-ghost shrink-0" onClick={commit} disabled={!body.trim()}>Log</button>
      </div>
      <p className="mt-1 text-[11px] text-faint">Stamped with today's date so a task spanning days shows where you left off.</p>
    </div>
  );
}

const VIEW_KEY = "madeea-tasks-view";

/** "3m" / "2h" / "5d", a thread is read by recency, not by date. */
function ago(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const VERB_TEXT: Record<string, (a: TaskActivity) => string> = {
  created: () => "created this task",
  status: (a) => `moved it from ${a.from_value ?? "?"} to ${a.to_value ?? "?"}`,
  priority: (a) => `changed priority to ${a.to_value ?? "?"}`,
  due: (a) => (a.to_value ? `set the due date to ${a.to_value.slice(0, 10)}` : "cleared the due date"),
  blocked: (a) => (a.to_value ? `flagged it blocked: ${a.to_value}` : "flagged it blocked"),
  unblocked: () => "unblocked it",
  commented: () => "commented",
};

/**
 * The conversation on this task, plus what happened to it.
 *
 * One panel rather than two tabs: "Bryan asked a question" and "Bryan moved it
 * to Done" are the same story, and splitting them makes you read it twice.
 */
function TaskThread({ taskId }: { taskId: string }) {
  const { data: comments = [] } = useTaskComments(taskId);
  const { data: activity = [] } = useTaskActivity(taskId);
  const { data: members = [] } = useWorkspaceMembers();
  const { add, remove } = useCommentMutations();
  const [body, setBody] = useState("");

  const nameOf = (id: string | null) =>
    members.find((m) => m.user_id === id)?.name ?? (id === "demo" ? "You" : "Someone");

  const send = () => {
    const b = body.trim();
    if (!b) return;
    add.mutate({ taskId, body: b });
    setBody("");
  };

  return (
    <div className="border-t border-border pt-3">
      <p className="eyebrow mb-2">Comments &amp; activity</p>

      <div className="mb-2 max-h-56 space-y-2 overflow-y-auto pr-1">
        {comments.map((c) => (
          <div key={c.id} className="group rounded-lg bg-surface-2 px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="text-[12px] font-semibold">{c.author_name ?? nameOf(c.author_id)}</span>
              <span className="text-[10.5px] text-faint">{ago(c.created_at)}</span>
              <button
                className="ml-auto icon-btn reveal-on-hover text-faint hover:text-red-400"
                onClick={() => remove.mutate({ id: c.id, taskId })}
                aria-label="Delete comment"
              >
                <Trash2 size={12} />
              </button>
            </div>
            <p className="mt-0.5 whitespace-pre-wrap text-[13px] leading-snug">{c.body}</p>
          </div>
        ))}

        {/* Activity is quieter than conversation on purpose, it is context for
            the thread, not the point of it. */}
        {activity.filter((a) => a.verb !== "commented").slice(0, 12).map((a) => (
          <p key={a.id} className="px-1 text-[11px] text-faint">
            <span className="text-muted">{a.actor_name ?? nameOf(a.actor_id)}</span>{" "}
            {(VERB_TEXT[a.verb] ?? (() => a.verb))(a)} · {ago(a.created_at)}
          </p>
        ))}

        {comments.length === 0 && activity.length === 0 && (
          <p className="px-1 text-xs text-faint">
            Nothing yet. Ask a question here and it stays attached to the work.
          </p>
        )}
      </div>

      <div className="flex gap-2">
        <input
          className="input flex-1"
          placeholder="Write a comment…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
        />
        <button type="button" className="btn-ghost shrink-0" onClick={send} disabled={!body.trim() || add.isPending}>
          <Send size={14} /> Send
        </button>
      </div>
    </div>
  );
}

/**
 * Every task in one column, soonest due first.
 *
 * The board answers "what is moving"; this answers "where is that one thing".
 * Status is a dropdown here rather than a drag, because dragging a row up a
 * flat list to change its state is a gesture nobody guesses.
 */
function TaskList({
  tasks, blockedIds, onEdit, onDelete, onStatus, focusId,
}: {
  tasks: Task[];
  blockedIds: Set<string>;
  onEdit: (t: Task) => void;
  onDelete: (id: string) => void;
  onStatus: (id: string, status: TaskStatus) => void;
  focusId?: string | null;
}) {
  const rows = [...tasks].sort((a, b) => {
    // Undated tasks last: a task with a date is a commitment, one without is a
    // wish, and sorting empty strings first would bury the commitments.
    if (!a.due_at && !b.due_at) return 0;
    if (!a.due_at) return 1;
    if (!b.due_at) return -1;
    return a.due_at.localeCompare(b.due_at);
  });

  if (rows.length === 0) return <p className="card p-6 text-center text-sm text-faint">Nothing here yet.</p>;

  return (
    <div className="card divide-y divide-border">
      {rows.map((t) => (
        <div
          key={t.id}
          data-task-id={t.id}
          className={cn(
            "group flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-surface-2/60",
            focusId === t.id && "bg-accent/5",
          )}
        >
          <select
            className="shrink-0 rounded-md border border-border bg-surface-2 px-1.5 py-1 text-xs"
            value={t.status}
            onChange={(e) => onStatus(t.id, e.target.value as TaskStatus)}
            aria-label={`Status of ${t.title}`}
          >
            {COLUMNS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>

          <button className="min-w-0 flex-1 text-left" onClick={() => onEdit(t)}>
            <span className={cn("block truncate text-sm font-medium", t.status === "done" && "text-faint line-through")}>
              {t.title}
            </span>
            <span className="block truncate text-xs text-faint">
              {t.client_name}
              {t.due_at && <> · {dueDisplay(t)}</>}
              {t.notes?.trim() && <> · has notes</>}
              {(t.attachments?.length ?? 0) > 0 && <> · {t.attachments!.length} link{t.attachments!.length === 1 ? "" : "s"}</>}
            </span>
          </button>

          {blockedIds.has(t.id) && <span className="pill shrink-0 bg-amber-500/15 text-amber-400"><Lock size={10} /> Blocked</span>}
          {t.blocked && <span className="pill shrink-0 bg-red-500/15 text-red-400"><Lock size={10} /> Blocked</span>}
          <Badge tone={t.priority}>{priorityLabel[t.priority]}</Badge>

          <button
            className="shrink-0 icon-btn reveal-on-hover text-faint hover:text-red-400"
            onClick={() => onDelete(t.id)}
            aria-label={`Delete ${t.title}`}
          >
            <Trash2 size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

const BLANK = {
  title: "", priority: "normal" as Priority, due: "", subtasks: [] as Subtask[],
  recurrence: "none" as Recurrence, dependsOn: "", clientId: "", assigneeId: "", blockerNote: "",
  notes: "", progress: [] as TaskProgress[], attachments: [] as TaskAttachment[],
  status: "todo" as TaskStatus,
  requiresApproval: false,
};
const EMPTY_TASKS: Task[] = [];

export default function Tasks() {
  const { data, isLoading } = useTasks();
  const tasks = data ?? EMPTY_TASKS;
  const { setStatus, create, update, remove, approve } = useTaskMutations();
  const { data: clients = [] } = useClients();
  const { flags } = useFollowUps();
  const { data: members = [] } = useWorkspaceMembers();
  // "mine" | "all" | a specific member id
  const [who, setWho] = useState<string>("all");
  // Deep link from the client activity timeline: /tasks?task=<id>
  const [params, setParams] = useSearchParams();
  const focusId = params.get("task");
  const staleTasks = flags.filter((f) => f.kind === "stale_task");
  const [board, setBoard] = useState<Board>(group([]));
  const [activeId, setActiveId] = useState<string | null>(null);
  // Which column the card would land in right now. Drives the drop highlight.
  const [overCol, setOverCol] = useState<TaskStatus | null>(null);
  /* Board vs list. Read from localStorage on first render rather than in an
     effect, so the preferred view is the first thing painted instead of the
     board flashing for a frame on every load. */
  const { data: commentCounts = {} } = useCommentCounts();
  const { data: savedRows = [] } = useSaved();
  const { toggle: saveToggle } = useSavedMutations();
  const savedIds = new Set(savedRows.filter((s) => s.kind === "task").map((s) => s.target_id));
  const { data: myRole } = useMyRole();
  const isAdmin = myRole === "admin";
  const [q, setQ] = useState("");
  const [view, setView] = useState<"board" | "list">(() => {
    try { return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "board"; } catch { return "board"; }
  });
  useEffect(() => { try { localStorage.setItem(VIEW_KEY, view); } catch { /* storage blocked */ } }, [view]);
  // Drives the drop-bounce animation on the card that was just released.
  const [justDroppedId, setJustDroppedId] = useState<string | null>(null);
  const [modal, setModal] = useState(false);
  const [templates, setTemplates] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK);

  const me = members.find((m) => m.is_me);
  // MUST be memoised: this feeds a useEffect that calls setBoard. A fresh array on
  // every render meant the effect re-ran on every render, setting state, re-rendering,
  // rebuilding the array, an infinite loop ("Maximum update depth exceeded").
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return tasks.filter((t) => {
      if (who === "unassigned" && t.assignee_id) return false;
      if (who === "mine" && t.assignee_id !== me?.user_id) return false;
      if (who !== "all" && who !== "mine" && who !== "unassigned" && t.assignee_id !== who) return false;
      if (!needle) return true;
      /* Searches everything you might remember it by, including the reference
         and the notes: "the one about the printer" only finds it if the notes
         are searched, and they are where that sentence actually lives. */
      return [t.title, t.client_name, t.notes ?? "", t.blocker_note ?? "", taskRef(t.id)]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [tasks, who, q, me?.user_id]);

  useEffect(() => { if (!activeId) setBoard(group(visible)); }, [visible, activeId]);

  // Scroll the linked card into view and let the highlight fade, rather than
  // dumping the user on a board and making them hunt for the row.
  useEffect(() => {
    if (!focusId || isLoading) return;
    const el = document.querySelector(`[data-task-id="${focusId}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    const t = setTimeout(() => setParams({}, { replace: true }), 2500);
    return () => clearTimeout(t);
  }, [focusId, isLoading, setParams]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const byId = new Map(tasks.map((t) => [t.id, t]));
  const blockedIds = new Set(
    tasks.filter((t) => t.depends_on && byId.get(t.depends_on) && byId.get(t.depends_on)!.status !== "done").map((t) => t.id),
  );

  const columnOf = (id: string): TaskStatus | null => {
    if (id in board) return id as TaskStatus;
    return (Object.keys(board) as TaskStatus[]).find((k) => board[k].some((t) => t.id === id)) ?? null;
  };
  const activeTask = activeId ? Object.values(board).flat().find((t) => t.id === activeId) ?? null : null;

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
    setOverCol(columnOf(String(e.active.id)));
  }
  function onDragOver(e: DragOverEvent) {
    const { active, over } = e;
    if (!over) { setOverCol(null); return; }
    const from = columnOf(String(active.id));
    const to = columnOf(String(over.id));
    // Track the destination even when it has not changed, so the highlight
    // follows the pointer for the whole drag rather than only on the frame the
    // card crosses a boundary.
    setOverCol(to);
    if (!from || !to || from === to) return;
    setBoard((b) => {
      const moving = b[from].find((t) => t.id === active.id);
      if (!moving) return b;
      const overIdx = b[to].findIndex((t) => t.id === over.id);
      const insertAt = overIdx >= 0 ? overIdx : b[to].length;
      return {
        ...b,
        [from]: b[from].filter((t) => t.id !== active.id),
        [to]: [...b[to].slice(0, insertAt), { ...moving, status: to }, ...b[to].slice(insertAt)],
      };
    });
  }
  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    setActiveId(null);
    setOverCol(null);
    // Trigger the drop bounce on the released card, then clear it.
    const droppedId = String(active.id);
    setJustDroppedId(droppedId);
    window.setTimeout(() => setJustDroppedId((cur) => (cur === droppedId ? null : cur)), 450);
    if (!over) return;
    const col = columnOf(String(active.id));
    if (col) {
      setBoard((b) => {
        const oldIdx = b[col].findIndex((t) => t.id === active.id);
        const newIdx = b[col].findIndex((t) => t.id === over.id);
        if (oldIdx >= 0 && newIdx >= 0 && oldIdx !== newIdx) return { ...b, [col]: arrayMove(b[col], oldIdx, newIdx) };
        return b;
      });
    }
    const serverTask = tasks.find((t) => t.id === active.id);
    if (serverTask && col && serverTask.status !== col) setStatus.mutate({ id: serverTask.id, status: col });
  }

  /* `status` comes from whichever column's Add was clicked, so a task created
     in In Progress starts there instead of appearing in To Do to be dragged. */
  function startCreate(status: TaskStatus = "todo") { setForm({ ...BLANK, status }); setEditingId(null); setModal(true); }
  function startEdit(t: Task) {
    setForm({ title: t.title, priority: t.priority, due: t.due_at ? t.due_at.slice(0, 10) : "", subtasks: t.subtasks ?? [], recurrence: t.recurrence ?? "none", dependsOn: t.depends_on ?? "", clientId: clients.find((c) => c.name === t.client_name)?.id ?? "", assigneeId: t.assignee_id ?? "", blockerNote: t.blocker_note ?? "", notes: t.notes ?? "", progress: t.progress ?? [], attachments: t.attachments ?? [], status: t.status, requiresApproval: t.requires_approval ?? false });
    setEditingId(t.id); setModal(true);
  }
  function fromTemplate(t: TaskTemplate) {
    setForm({ title: t.title, priority: t.priority, due: "", recurrence: "none", dependsOn: "", clientId: "", assigneeId: "", blockerNote: "", notes: "", progress: [], attachments: [], status: "todo", requiresApproval: false, subtasks: t.subtasks.map((l, i) => ({ id: `${Date.now()}-${i}`, label: l, done: false })) });
    setEditingId(null); setTemplates(false); setModal(true);
  }
  function submit() {
    if (!form.title.trim()) return;
    const payload = {
      title: form.title.trim(), priority: form.priority, due_at: form.due || null,
      subtasks: form.subtasks.filter((s) => s.label.trim()), recurrence: form.recurrence, depends_on: form.dependsOn || null,
      client_id: form.clientId || null,
      assignee_id: form.assigneeId || null,
      status: form.status,
      requires_approval: form.requiresApproval,
      // A reason means it's blocked; clearing the reason unblocks it. One field
      // rather than a checkbox you can leave contradicting the note.
      blocked: Boolean(form.blockerNote.trim()),
      blocker_note: form.blockerNote.trim() || null,
      notes: form.notes.trim() || null,
      progress: form.progress,
      attachments: form.attachments,
    };
    if (editingId) update.mutate({ id: editingId, ...payload });
    else create.mutate(payload);
    setForm(BLANK); setEditingId(null); setModal(false);
  }
  const saving = create.isPending || update.isPending;

  const addSub = () => setForm((f) => ({ ...f, subtasks: [...f.subtasks, { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, label: "", done: false }] }));
  const setSub = (id: string, patch: Partial<Subtask>) => setForm((f) => ({ ...f, subtasks: f.subtasks.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));
  const delSub = (id: string) => setForm((f) => ({ ...f, subtasks: f.subtasks.filter((s) => s.id !== id) }));

  return (
    <div>
      <PageHeader
        title="Task Manager"
        // The instruction has to match the view you are actually looking at,
        // there is nothing to drag in the list.
        subtitle={view === "list" ? "Every task, soonest first. Change status from the dropdown." : "Drag cards between columns to update status"}
        action={
          <div className="flex gap-2">
            <button className="btn-ghost border border-border" onClick={() => setTemplates(true)}><Copy size={15} /> Templates</button>
            {/* Wrapped, not passed directly: startCreate's first argument is the
                column to create in, and onClick would hand it a MouseEvent. */}
            <button className="btn-primary" onClick={() => startCreate()}><Plus size={15} /> Add Task</button>
          </div>
        }
      />

      {staleTasks.length > 0 && (
        <section className="card mb-4 p-4">
          <div className="mb-2.5 flex items-center gap-2">
            <h2 className="text-sm font-semibold">Needs Follow-up</h2>
            <span className="pill bg-amber-500/15 text-amber-400">{staleTasks.length}</span>
            <span className="ml-auto text-xs text-faint">Untouched long enough to be forgotten</span>
          </div>
          <div className="space-y-2">
            {staleTasks.map((f) => <FollowUpRow key={f.id} flag={f} />)}
          </div>
        </section>
      )}

      {/* Find the one you half-remember. Above the filters because it beats all
          of them: on a board of forty, typing three letters is faster than
          working out whose it was. */}
      <div className="relative mb-3">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
        <input
          className="input pl-9"
          placeholder="Search tasks. Title, client, notes, or reference…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search tasks"
        />
        {q && (
          <button
            className="absolute right-3 top-1/2 -translate-y-1/2 text-faint hover:text-zinc-100"
            onClick={() => setQ("")}
            aria-label="Clear search"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Who am I looking at? */}
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {[
          { id: "all", label: "All Tasks" },
          { id: "mine", label: "My Tasks" },
          { id: "unassigned", label: "Unassigned" },
        ].map((f) => (
          <button
            key={f.id}
            onClick={() => setWho(f.id)}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
              who === f.id ? "bg-accent text-white" : "bg-surface-2 text-muted hover:text-zinc-100"
            }`}
          >
            {f.label}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-border" />
        {members.map((m) => (
          <button
            key={m.user_id}
            onClick={() => setWho(who === m.user_id ? "all" : m.user_id)}
            title={m.name}
            className={`flex items-center gap-1.5 rounded-lg py-1 pl-1 pr-2 text-xs font-medium transition-colors ${
              who === m.user_id ? "bg-accent text-white" : "bg-surface-2 text-muted hover:text-zinc-100"
            }`}
          >
            <AssigneeAvatar member={m} />
            {m.name.split(" ")[0]}
          </button>
        ))}
        {/* Board or list. A kanban is the right shape for moving work along and
            the wrong one for scanning forty tasks for the one you half-remember
            the list sorts by due date and shows every task in one column.
            Stored, because whichever you prefer you prefer every day. */}
        <span className="ml-auto flex items-center gap-1 rounded-lg bg-surface-2 p-0.5">
          {([["board", "Board", Columns3], ["list", "List", ListIcon]] as const).map(([id, label, Icon]) => (
            <button
              key={id}
              onClick={() => setView(id)}
              title={`${label} view`}
              aria-pressed={view === id}
              className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                view === id ? "bg-accent text-white" : "text-muted hover:text-zinc-100"
              }`}
            >
              <Icon size={13} /> {label}
            </button>
          ))}
        </span>
        <span className="text-xs text-faint">
          {visible.length} of {tasks.length} task{tasks.length === 1 ? "" : "s"}
        </span>
      </div>

      {isLoading ? (
        <div className="grid gap-4 lg:grid-cols-3">
          {COLUMNS.map((col) => (
            <div key={col.key} className="space-y-3">
              <SkeletonCard lines={2} />
              <SkeletonCard lines={3} />
            </div>
          ))}
        </div>
      ) : view === "list" ? (
        <TaskList
          tasks={visible}
          blockedIds={blockedIds}
          onEdit={startEdit}
          onDelete={(id) => remove.mutate(id)}
          onStatus={(id, status) => setStatus.mutate({ id, status })}
          focusId={focusId}
        />
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={() => { setActiveId(null); setOverCol(null); }}>
          <div className="grid gap-4 lg:grid-cols-3">
            {COLUMNS.map((col) => (
              <Column key={col.key} status={col.key} label={col.label} dot={col.dot} wash={col.wash} edge={col.edge} items={board[col.key]} blockedIds={blockedIds} onDelete={(id) => remove.mutate(id)} onEdit={startEdit} onComplete={(id) => setStatus.mutate({ id, status: "done" })} onAdd={startCreate} onSave={(t) => saveToggle.mutate({ kind: "task", targetId: t.id, label: t.title, saved: savedIds.has(t.id) })} savedIds={savedIds} commentCounts={commentCounts} focusId={focusId} justDroppedId={justDroppedId} dropActive={activeId !== null && overCol === col.key} />
            ))}
          </div>
          <DragOverlay dropAnimation={{ duration: 200, easing: "cubic-bezier(0.18, 0.67, 0.6, 1.22)" }}>
            {activeTask ? (
              <div className="card-dragging rounded-lg">
                <CardBody task={activeTask} blocked={blockedIds.has(activeTask.id)} overlay />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {/* Add / Edit */}
      <Modal open={modal} onClose={() => { setModal(false); setEditingId(null); }}>
        <h2 className="mb-4 text-lg font-semibold">{editingId ? "Edit Task" : "Add Task"}</h2>
        <div className="space-y-3">
          <div>
            <label className="field-label">Title</label>
            <input className="input" autoFocus value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. Draft investor update" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            {/* Status was only changeable by dragging, which meant no way to move
                a task from the detail view at all, and no way at all on a phone. */}
            <div>
              <label className="field-label" htmlFor="task-status">Status</label>
              <select id="task-status" className="input" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as TaskStatus }))}>
                {COLUMNS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="field-label">Priority</label>
              <select className="input" value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as Priority }))}>
                <option value="urgent">Urgent</option><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option>
              </select>
            </div>
            <div>
              <label className="field-label">Due date</label>
              <input type="date" className="input" value={form.due} onChange={(e) => setForm((f) => ({ ...f, due: e.target.value }))} />
            </div>
          </div>

          <div>
            <label className="field-label">Checklist</label>
            <div className="space-y-1.5">
              {form.subtasks.map((st) => (
                <div key={st.id} className="flex items-center gap-2">
                  <input type="checkbox" className="h-4 w-4 accent-[#fd5812]" checked={st.done} onChange={(e) => setSub(st.id, { done: e.target.checked })} />
                  <input className="input flex-1 py-1.5 text-sm" value={st.label} onChange={(e) => setSub(st.id, { label: e.target.value })} placeholder="Checklist item" />
                  <button className="text-faint hover:text-red-400" onClick={() => delSub(st.id)} aria-label="Remove item"><X size={14} /></button>
                </div>
              ))}
              <button className="text-xs text-accent-soft hover:underline" onClick={addSub}>+ Add checklist item</button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="field-label">Repeat</label>
              <select className="input" value={form.recurrence} onChange={(e) => setForm((f) => ({ ...f, recurrence: e.target.value as Recurrence }))}>
                <option value="none">Don't repeat</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option>
              </select>
            </div>
            <div>
              <label className="field-label">Blocked by</label>
              <select className="input" value={form.dependsOn} onChange={(e) => setForm((f) => ({ ...f, dependsOn: e.target.value }))}>
                <option value="">None</option>
                {tasks.filter((t) => t.id !== editingId).map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
              </select>
            </div>
          </div>

          {/* §5.3, the trust dial: an EA can be given more rope over time by
              leaving this off, without the agency losing the ability to catch
              something before the client sees it. */}
          <label className="flex cursor-pointer items-start gap-2.5 rounded-lg bg-surface-2 px-3 py-2.5">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={form.requiresApproval}
              onChange={(e) => setForm((f) => ({ ...f, requiresApproval: e.target.checked }))}
            />
            <span className="flex-1">
              <span className="block text-[13px] font-medium">Needs approval before it can be completed</span>
              <span className="block text-[11px] text-faint">
                For work a client sees, an email to their customer, a published post, an invoice.
                It waits in Review until an admin signs it off.
              </span>
            </span>
          </label>

          <div>
            <label className="field-label" htmlFor="task-blocker">What's blocking this? (optional)</label>
            <input
              id="task-blocker"
              className="input"
              placeholder="e.g. Waiting on Jordan's copy and enriched list"
              value={form.blockerNote}
              onChange={(e) => setForm((f) => ({ ...f, blockerNote: e.target.value }))}
            />
            <p className="mt-1 text-[11px] text-faint">Fill this in and the task shows as blocked, and it lands in your EOD report by itself.</p>
          </div>

          {/* R-4.7.3. Kept apart from the blocker field above on purpose: that
              one means blocked-and-why and feeds the EOD's blockers list, so
              "spoke to the printer" must not end up in it. */}
          <div>
            <label className="field-label" htmlFor="task-notes">Notes (optional)</label>
            <textarea
              id="task-notes"
              className="input min-h-[84px] resize-y"
              placeholder="Anything worth remembering about this task. Context, a phone number, what you tried."
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </div>

          {/* R-4.7.2. A research or deliverable task produces an output, and the
              output belongs on the task rather than in someone's inbox. */}
          <AttachmentsField
            items={form.attachments}
            onChange={(attachments) => setForm((f) => ({ ...f, attachments }))}
          />

          {/* R-4.7.4. Only on an existing task: progress is a log of what
              happened, and nothing has happened yet on one being created. */}
          {editingId && (
            <ProgressField
              items={form.progress}
              onAdd={(body) =>
                setForm((f) => ({ ...f, progress: [{ at: new Date().toISOString(), body }, ...f.progress] }))
              }
            />
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="field-label">Client</label>
              <select className="input" value={form.clientId} onChange={(e) => setForm((f) => ({ ...f, clientId: e.target.value }))}>
                <option value="">No client</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="field-label">Assignee</label>
              <select className="input" value={form.assigneeId} onChange={(e) => setForm((f) => ({ ...f, assigneeId: e.target.value }))}>
                <option value="">Unassigned</option>
                {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.name}{m.is_me ? " (you)" : ""}</option>)}
              </select>
            </div>
          </div>

          <button className="btn-primary w-full" onClick={submit} disabled={!form.title.trim() || saving}>
            {saving ? "Saving…" : editingId ? "Save changes" : "Add Task"}
          </button>

          {/* Sign-off is separate from saving, and separate from completing.
              Approving and closing in one click would make "approved" mean
              somebody pressed a button, not that somebody read the work. */}
          {editingId && form.requiresApproval && (() => {
            const t = tasks.find((x) => x.id === editingId);
            if (t?.approved_at) {
              return (
                <p className="flex items-center gap-1.5 rounded-lg bg-emerald-500/10 px-3 py-2 text-[12px] text-emerald-400">
                  <ShieldCheck size={13} /> Approved, this can now be completed.
                </p>
              );
            }
            return isAdmin ? (
              <button className="btn-ghost w-full border border-violet-500/40 text-violet-300" onClick={() => approve.mutate(editingId)} disabled={approve.isPending}>
                <ShieldCheck size={15} /> {approve.isPending ? "Approving…" : "Approve this work"}
              </button>
            ) : (
              <p className="rounded-lg bg-violet-500/10 px-3 py-2 text-[12px] text-violet-300">
                Waiting on an admin to sign this off before it can be completed.
              </p>
            );
          })()}

          {/* Only on a task that exists. There is nothing to comment on, and no
              id to hang a comment from, until it has been created. */}
          {editingId && <TaskThread taskId={editingId} />}
        </div>
      </Modal>

      {/* Templates */}
      <Modal open={templates} onClose={() => setTemplates(false)}>
        <h2 className="mb-1 text-lg font-semibold">Start from a template</h2>
        <p className="mb-4 text-sm text-muted">Common EA workflows. Creates a task with its checklist ready to tweak.</p>
        <div className="space-y-2">
          {TASK_TEMPLATES.map((t) => (
            <button key={t.name} onClick={() => fromTemplate(t)} className="flex w-full flex-col rounded-lg border border-border p-3 text-left transition-colors hover:border-accent/40">
              <span className="text-sm font-medium">{t.title}</span>
              <span className="mt-0.5 text-xs text-faint">{t.subtasks.length} steps · {priorityLabel[t.priority]}</span>
            </button>
          ))}
        </div>
      </Modal>
    </div>
  );
}
