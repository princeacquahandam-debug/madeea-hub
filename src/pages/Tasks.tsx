import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  DndContext, DragOverlay, PointerSensor, KeyboardSensor, useSensor, useSensors,
  useDroppable, closestCorners, type DragEndEvent, type DragOverEvent, type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext, useSortable, sortableKeyboardCoordinates, verticalListSortingStrategy, arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus, Trash2, Pencil, CalendarDays, CheckSquare, Repeat, Lock, X, Copy, Link2, List as ListIcon, Search, MessageSquare, Send, ShieldCheck, Bookmark, Check, Sparkles, Loader2 } from "lucide-react";
import type { Task, TaskStatus, Priority, Subtask, Recurrence, TaskProgress, TaskAttachment, TaskActivity } from "@/types/db";
import { Badge, PageHeader, Modal } from "@/components/ui";
import { useClientContext } from "@/store/clientContext";
import { ClientScopeBanner } from "@/components/ClientSwitcher";
import { SkeletonCard } from "@/components/Skeleton";
import { atLeast, useTasks, useTaskMutations, useClients, useTaskComments, useTaskActivity, useCommentMutations, useCommentCounts, useMyRole, useSaved, useSavedMutations } from "@/data/hooks";
import { AssigneePicker, AssigneeAvatar } from "@/components/Assignee";
import { useWorkspaceMembers } from "@/data/hooks";
import { TASK_TEMPLATES, type TaskTemplate } from "@/lib/taskTemplates";
import { cn } from "@/lib/utils";
import { useMadelineContext } from "@/hooks/useMadeline";
import { taskItem } from "@/lib/madelineItems";
import { prioritize, findStuck, type PrioritizeResult, type RankedRow, type StuckRow } from "@/lib/taskInsights";
import { breakDownTask, type Step } from "@/lib/taskBreakdown";
import { PrioritizePanel } from "@/components/tasks/PrioritizePanel";
import { StuckCard } from "@/components/tasks/StuckCard";
import { UndoToast } from "@/components/tasks/UndoToast";
import { useMadeline } from "@/store/madeline";
import { useAuth } from "@/hooks/useAuth";
import { isMine, sortTasks } from "@/lib/taskSort";
import { DeleteTaskDialog, RecentlyDeleted } from "@/components/tasks/TaskTrash";

/* Each column is colour-washed, the way Wing's board is: To Do, In Progress and
   Done read as three different places at a glance rather than three identical
   grey trays you have to read the headings of.

   Their board is white with pastel fills. Ours is dark, so the same idea has to
   be inverted, a low-opacity wash over the navy, and a solid dot in the header
   carrying the actual colour. The palette is untouched: these are the tones the
   app already uses for pending, in-flight and done. */
const COLUMNS: { key: TaskStatus; label: string; dot: string; wash: string; edge: string }[] = [
  /* Flat grey columns, colour only in the dot (12 Oct 2026, UI review deck slide 5). */
  { key: "todo", label: "To do", dot: "bg-sky-400", wash: "", edge: "" },
  { key: "in_progress", label: "In progress", dot: "bg-amber-400", wash: "", edge: "" },
  // Waiting on someone else: a reply, a file, a decision (28 Sep audit, 0081).
  { key: "follow_up", label: "Waiting", dot: "bg-rose-400", wash: "", edge: "" },
  // Where work that needs sign-off waits (migration 0030, PROJECT_PLAN §5.3).
  { key: "review", label: "Review", dot: "bg-violet-400", wash: "", edge: "" },
  { key: "done", label: "Done", dot: "bg-emerald-400", wash: "", edge: "" },
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
function todayIso(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

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
// Every column sorted by due date, then priority (Reich's testing, 20 Oct 2026).
const group = (tasks: Task[]): Board => {
  const sorted = sortTasks(tasks);
  return {
    todo: sorted.filter((t) => t.status === "todo"),
    in_progress: sorted.filter((t) => t.status === "in_progress"),
    follow_up: sorted.filter((t) => t.status === "follow_up"),
    review: sorted.filter((t) => t.status === "review"),
    done: sorted.filter((t) => t.status === "done"),
  };
};

/** How many checklist items a card shows before "+N more". */
const CARD_CHECKLIST_MAX = 5;

function CardBody({ task, blocked, onDelete, onEdit, onComplete, onSave, onToggleSub, isSaved, comments = 0, overlay }: { task: Task; blocked?: boolean; onDelete?: () => void; onEdit?: () => void; onComplete?: () => void; onSave?: () => void; onToggleSub?: (subId: string) => void; isSaved?: boolean; comments?: number; overlay?: boolean }) {
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const subDone = task.subtasks.filter((s) => s.done).length;
  const due = relativeDue(task);
  const links = task.attachments?.length ?? 0;
  const progress = task.progress?.length ?? 0;
  return (
    <div className={cn("relative rounded-lg border border-border bg-surface p-3", overlay && "shadow-xl ring-2 ring-accent/60 rotate-1")}>
      {/* The reference, so this card can be named in a message or an EOD line.
          Saved stays lit once set, so the card shows its own state. */}
      <p className="mb-1 flex items-center gap-1 font-mono text-[10px] tracking-wide text-faint">
        {taskRef(task.id)}
        {isSaved && <Bookmark size={10} className="text-accent" fill="currentColor" aria-label="Saved" />}
      </p>
      {/* Card actions on hover only (12 Oct 2026, UI review deck slide 5),
          floated over the corner so they take no width from the title. */}
      {!overlay && (onSave || onComplete || onEdit || onDelete) && (
        <div className="reveal-on-hover absolute right-1.5 top-1.5 flex items-center rounded-md border border-border bg-surface shadow-sm">
          {onComplete && task.status !== "done" && (
            <button className="icon-btn text-faint hover:text-emerald-500" onPointerDown={stop} onClick={onComplete} aria-label="Mark as complete" title="Mark as complete">
              <Check size={13} />
            </button>
          )}
          {onSave && (
            <button className={cn("icon-btn", isSaved ? "text-accent" : "text-faint hover:text-accent")} onPointerDown={stop} onClick={onSave} aria-label={isSaved ? "Remove from saved" : "Save this task"} title={isSaved ? "Remove from saved" : "Save"}>
              <Bookmark size={13} fill={isSaved ? "currentColor" : "none"} />
            </button>
          )}
          {onEdit && (
            <button className="icon-btn text-faint hover:text-accent" onPointerDown={stop} onClick={onEdit} aria-label="Edit task" title="Edit">
              <Pencil size={13} />
            </button>
          )}
          {onDelete && (
            <button className="icon-btn text-faint hover:text-red-500" onPointerDown={stop} onClick={onDelete} aria-label="Delete task" title="Delete">
              <Trash2 size={13} />
            </button>
          )}
        </div>
      )}
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-sm font-medium">{task.title}</p>
        {/* Who this is for. Click to reassign; the drag preview gets a plain
            avatar, since a menu inside a drag preview makes no sense. */}
        {overlay ? <AssigneeAvatar member={null} /> : <AssigneePicker task={task} />}
      </div>
      {/* A line of the notes, so the card says what the job IS rather than only
          what it is called. Truncated to two lines; the rest is one click away. */}
      {task.notes?.trim() && (
        <p className="mt-1 line-clamp-2 text-xs leading-snug text-muted">{task.notes}</p>
      )}

      {/* The checklist on the card, so pending and done items show at a glance
          without opening the task (Reich's testing, 20 Oct 2026). Ticking one
          here saves it; the events stop at the checkbox so it never starts a drag. */}
      {task.subtasks.length > 0 && (
        <ul className="mt-1.5 space-y-0.5" aria-label="Checklist">
          {task.subtasks.slice(0, CARD_CHECKLIST_MAX).map((s) => (
            <li key={s.id} className="flex items-start gap-1.5 text-[11.5px] leading-snug">
              <input
                type="checkbox"
                className="mt-[2px] h-3 w-3 shrink-0 cursor-pointer accent-[#fd5812]"
                checked={s.done}
                disabled={!onToggleSub}
                onPointerDown={stop}
                onKeyDown={stop}
                onClick={stop}
                onChange={() => onToggleSub?.(s.id)}
                aria-label={s.label}
              />
              <span className={cn("min-w-0 flex-1", s.done ? "text-faint line-through" : "text-muted")}>{s.label}</span>
            </li>
          ))}
          {task.subtasks.length > CARD_CHECKLIST_MAX && (
            <li className="pl-[18px] text-[11px] text-faint">+{task.subtasks.length - CARD_CHECKLIST_MAX} more</li>
          )}
        </ul>
      )}

      <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-faint">
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
      <div className="mt-2 flex flex-wrap items-center gap-2">
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
        {blocked && <span className="pill bg-amber-500/15 text-amber-400"><Lock size={10} /> Waiting on task</span>}
        {/* Someone said this is blocked and why. Feeds their EOD report. */}
        {task.blocked && (
          <span className="pill bg-red-500/15 text-red-400" title={task.blocker_note ?? undefined}>
            <Lock size={10} /> {task.blocker_note?.trim() ? task.blocker_note : "Blocked"}
          </span>
        )}
      </div>

    </div>
  );
}

/* The Tasks quick actions' state, shared with every card without threading it
   through the columns: which card is selected, which are stuck (outlined),
   whether "Break down a task" is waiting for a card to be picked, and the
   step preview shown in place on a card. */
interface BoardAi {
  selectedId: string | null;
  stuckIds: Set<string>;
  picking: boolean;
  onCardClick: (t: Task) => void;
  preview: (t: Task) => React.ReactNode;
}
const BoardAiContext = createContext<BoardAi | null>(null);

function SortableCard({ task, blocked, onDelete, onEdit, onComplete, onSave, onToggleSub, isSaved, comments, focused, justDropped }: { task: Task; blocked: boolean; onDelete: () => void; onEdit: () => void; onComplete: () => void; onSave: () => void; onToggleSub: (subId: string) => void; isSaved: boolean; comments?: number; focused?: boolean; justDropped?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  const ai = useContext(BoardAiContext);
  return (
    // data-task-id is the scroll anchor for the /tasks?task=<id> deep link from the
    // client activity timeline.
    <div ref={setNodeRef} data-task-id={task.id} style={{ transform: CSS.Transform.toString(transform), transition }} {...attributes} {...listeners}
      onClick={() => ai?.onCardClick(task)}
      className={cn(
        "group touch-none cursor-grab rounded-lg active:cursor-grabbing",
        isDragging && "opacity-40",
        justDropped && "card-drop",
        // Find stuck tasks outlines the stuck cards on the board.
        ai?.stuckIds.has(task.id) && "ring-2 ring-red-400/70",
        (focused || ai?.selectedId === task.id) && "ring-2 ring-accent ring-offset-2 ring-offset-bg",
        ai?.picking && task.status !== "done" && "cursor-pointer hover:ring-2 hover:ring-accent/60",
      )}>
      <CardBody task={task} blocked={blocked} onDelete={onDelete} onEdit={onEdit} onComplete={onComplete} onSave={onSave} onToggleSub={onToggleSub} isSaved={isSaved} comments={comments} />
      {ai?.preview(task)}
    </div>
  );
}

function Column({ status, label, dot, wash, edge, items, blockedIds, onDelete, onEdit, onComplete, onAdd, onSave, onToggleSub, savedIds, commentCounts, focusId, justDroppedId, dropActive }: { status: TaskStatus; label: string; dot: string; wash: string; edge: string; items: Task[]; blockedIds: Set<string>; onDelete: (t: Task) => void; onEdit: (t: Task) => void; onComplete: (id: string) => void; onAdd: (status: TaskStatus) => void; onSave: (t: Task) => void; onToggleSub: (t: Task, subId: string) => void; savedIds: Set<string>; commentCounts: Record<string, number>; focusId?: string | null; justDroppedId?: string | null; dropActive?: boolean }) {
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
    <div className={cn("flex min-w-0 flex-col overflow-hidden rounded-xl bg-[var(--board-col)] transition-colors", edge, wash, dropActive && "col-drop-active")}>
      {/* Header carries the colour, and its own Add. You add a task WHERE it
          belongs rather than adding to To Do and dragging it across. */}
      <div className="flex items-center gap-2 px-3 pb-1 pt-3">
        <span className={cn("h-2 w-2 shrink-0 rounded-full", dot)} />
        <h2 className="text-[13px] font-semibold">{label}</h2>
        <span className="text-xs tabular-nums text-faint">{items.length}</span>
        <button
          onClick={() => onAdd(status)}
          className="icon-btn ml-auto text-faint hover:text-text"
          aria-label={`Add a task to ${label}`}
          title="New task"
        >
          <Plus size={14} />
        </button>
      </div>
      <SortableContext id={status} items={items.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className="min-h-[180px] flex-1 space-y-2 p-2">
          {items.map((t) => <SortableCard key={t.id} task={t} blocked={blockedIds.has(t.id)} onDelete={() => onDelete(t)} onEdit={() => onEdit(t)} onComplete={() => onComplete(t.id)} onSave={() => onSave(t)} onToggleSub={(subId) => onToggleSub(t, subId)} isSaved={savedIds.has(t.id)} comments={commentCounts[t.id] ?? 0} focused={focusId === t.id} justDropped={justDroppedId === t.id} />)}
          {items.length === 0 && (
            <p className="rounded-lg border border-dashed border-border py-8 text-center text-xs text-faint">No tasks</p>
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

/** "3m" / "2h" / "5d", a thread is read by recency, not by date. */
function ago(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const columnLabel = (key: string | null | undefined) => (key ? COLUMNS.find((c) => c.key === key)?.label ?? key : "?");

const VERB_TEXT: Record<string, (a: TaskActivity) => string> = {
  created: () => "created this task",
  status: (a) => `moved it from ${columnLabel(a.from_value)} to ${columnLabel(a.to_value)}`,
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

const BLANK = {
  title: "", priority: "normal" as Priority, due: "", subtasks: [] as Subtask[],
  recurrence: "none" as Recurrence, dependsOn: "", clientId: "", assigneeId: "", blockerNote: "", clientBlocker: "",
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
  const { clientId: scopeId } = useClientContext();
  const { data: members = [] } = useWorkspaceMembers();
  const { user } = useAuth();
  /* The filters are remembered per person until they change them (Reich's
     testing, 20 Oct 2026: "My tasks" reset to everyone's on every visit). */
  const filterKey = `madeea-task-filters-${user?.id ?? "anon"}`;
  const saved = useMemo(() => {
    try { return JSON.parse(localStorage.getItem(filterKey) ?? "{}") as Partial<Record<"who" | "client" | "prio" | "due", string>>; } catch { return {}; }
  }, [filterKey]);
  // Deep link from the client activity timeline: /tasks?task=<id>
  const [params, setParams] = useSearchParams();
  // "mine" | "all" | "unassigned" | a specific member id. ?who=mine comes from the Dashboard's count.
  const [who, setWho] = useState<string>(() => params.get("who") ?? saved.who ?? "all");
  const focusId = params.get("task");
  const [board, setBoard] = useState<Board>(group([]));
  const [activeId, setActiveId] = useState<string | null>(null);
  // Which column the card would land in right now. Drives the drop highlight.
  const [overCol, setOverCol] = useState<TaskStatus | null>(null);
  const { data: commentCounts = {} } = useCommentCounts();
  const { data: savedRows = [] } = useSaved();
  const { toggle: saveToggle } = useSavedMutations();
  const savedIds = new Set(savedRows.filter((s) => s.kind === "task").map((s) => s.target_id));
  const { data: myRole } = useMyRole();
  const isAdmin = atLeast(myRole, "admin");
  const { add: addComment } = useCommentMutations();

  /* ── AI quick actions (Abder's answer spec, 14 Oct 2026) ── */
  const [panel, setPanel] = useState<{ result: PrioritizeResult; at: Date } | null>(null);
  const [stuckOpen, setStuckOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [bd, setBd] = useState<{ taskId: string; state: "loading" | "steps" | "question" | "error"; steps?: Step[]; question?: string; error?: string } | null>(null);
  const [bdAnswer, setBdAnswer] = useState("");
  const [toast, setToast] = useState<{ message: string; undo: () => void } | null>(null);
  const [tried, setTried] = useState(() => { try { return localStorage.getItem("madeea-ai-actions-tried") === "1"; } catch { return true; } });
  const markTried = () => { try { localStorage.setItem("madeea-ai-actions-tried", "1"); } catch { /* storage blocked */ } setTried(true); };
  const [q, setQ] = useState("");
  // Deck slide 5: Assignee, Client, Priority and Due date beside search.
  const [clientF, setClientF] = useState(saved.client ?? "all");
  const [prioF, setPrioF] = useState(saved.prio ?? "all");
  const [dueF, setDueF] = useState(saved.due ?? "all");
  useEffect(() => {
    try { localStorage.setItem(filterKey, JSON.stringify({ who, client: clientF, prio: prioF, due: dueF })); } catch { /* storage blocked */ }
  }, [filterKey, who, clientF, prioF, dueF]);
  // A remembered client or teammate that no longer exists falls back to everyone.
  useEffect(() => {
    if (clients.length && clientF !== "all" && !clients.some((c) => c.id === clientF)) setClientF("all");
  }, [clients, clientF]);
  useEffect(() => {
    if (members.length && !["all", "mine", "unassigned"].includes(who) && !members.some((m) => m.user_id === who)) setWho("all");
  }, [members, who]);
  // Delete asks first and goes to Recently deleted (Reich's testing, 20 Oct 2026).
  const [confirmDel, setConfirmDel] = useState<Task | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);
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
      /* The client context, applied before anything else. A task with no
         client is deliberately excluded while scoped: internal work
         (recruiting, training) is not this client's work, and showing it under
         their name would misrepresent what they are being billed for. */
      if (scopeId && t.client_id !== scopeId) return false;
      if (who === "unassigned" && t.assignee_id) return false;
      if (who === "mine" && !isMine(t, me?.user_id ?? user?.id)) return false;
      if (who !== "all" && who !== "mine" && who !== "unassigned" && t.assignee_id !== who) return false;
      if (clientF !== "all" && t.client_id !== clientF) return false;
      if (prioF !== "all" && t.priority !== prioF) return false;
      if (dueF !== "all") {
        const day = t.due_at?.slice(0, 10);
        const diff = day ? Math.round((Date.parse(`${day}T12:00:00Z`) - Date.parse(`${todayIso()}T12:00:00Z`)) / 864e5) : null;
        if (dueF === "none" ? diff !== null : diff === null) return false;
        if (dueF === "overdue" && !(diff! < 0 && t.status !== "done")) return false;
        if (dueF === "today" && diff !== 0) return false;
        if (dueF === "week" && !(diff! >= 0 && diff! <= 7)) return false;
      }
      if (!needle) return true;
      /* Searches everything you might remember it by, including the reference
         and the notes: "the one about the printer" only finds it if the notes
         are searched, and they are where that sentence actually lives. */
      return [t.title, t.client_name, t.notes ?? "", t.blocker_note ?? "", taskRef(t.id)]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [tasks, who, q, me?.user_id, user?.id, scopeId, clientF, prioF, dueF]);

  useEffect(() => { if (!activeId) setBoard(group(visible)); }, [visible, activeId]);

  // Prioritize board: worked out from the board in view (it follows the filters).
  const runPrioritize = () => {
    markTried();
    setPanel({ result: prioritize(visible, { now: new Date(), members, clients }), at: new Date() });
  };
  // Find stuck tasks: same board, updated live as the board changes.
  const stuck = useMemo(() => (stuckOpen ? findStuck(visible, new Date()) : null), [stuckOpen, visible]);
  const stuckIds = useMemo(() => new Set(stuck?.rows.map((r) => r.task.id) ?? []), [stuck]);

  /** Write the checked changes; Undo puts every one back for ten seconds. */
  function applyChanges(rows: RankedRow[]) {
    const write = (id: string, patch: Partial<Task>) =>
      patch.status ? setStatus.mutate({ id, status: patch.status }) : update.mutate({ id, ...patch } as Parameters<typeof update.mutate>[0]);
    for (const r of rows) if (r.change) write(r.task.id, r.change.patch);
    setPanel(null);
    setToast({
      message: `Applied ${rows.length} ${rows.length === 1 ? "change" : "changes"}`,
      undo: () => { for (const r of rows) if (r.change) write(r.task.id, r.change.undo); },
    });
  }

  function continueInChat() {
    if (!panel) return;
    const lines = panel.result.rows.map((r) =>
      `${r.rank ?? "-"}. ${r.task.title}: ${r.reason}${r.change ? ` Suggested: ${r.change.label} ${r.change.field === "assignee" ? "" : `${r.change.from} → `}${r.change.to}.` : ""}`);
    setPanel(null);
    useMadeline.getState().ask(`Here are the suggested priorities for my task board:\n${panel.result.summary}\n${lines.join("\n")}\n\nLet's talk them through.`, { send: true });
  }

  /* Break down a task: the selected card, or ask for one ("Pick a task first."). */
  async function runBreakdown(t: Task, answer?: string) {
    setPicking(false);
    setSelectedId(t.id);
    setBd({ taskId: t.id, state: "loading" });
    try {
      const r = await breakDownTask(t, t.client_name || null, answer);
      setBd("steps" in r ? { taskId: t.id, state: "steps", steps: r.steps } : { taskId: t.id, state: "question", question: r.question });
      setBdAnswer("");
    } catch (e) {
      setBd({ taskId: t.id, state: "error", error: e instanceof Error ? e.message : "Couldn't break this task down." });
    }
  }
  function startBreakdown() {
    markTried();
    const t = visible.find((x) => x.id === selectedId && x.status !== "done");
    if (t) void runBreakdown(t);
    else setPicking(true);
  }
  function keepSteps(t: Task, steps: Step[]) {
    const before = t.subtasks ?? [];
    const added = steps.map((s, i) => ({ id: `${Date.now()}-${i}`, label: s.minutes ? `${s.text} (~${s.minutes} min)` : s.text, done: false }));
    update.mutate({ id: t.id, subtasks: [...before, ...added] } as Parameters<typeof update.mutate>[0]);
    setBd(null);
    setToast({ message: `Added ${added.length} steps to "${t.title}"`, undo: () => update.mutate({ id: t.id, subtasks: before } as Parameters<typeof update.mutate>[0]) });
  }

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const boardAi: BoardAi = {
    selectedId,
    stuckIds,
    picking,
    onCardClick: (t) => {
      if (picking) { if (t.status !== "done") void runBreakdown(t); return; }
      setSelectedId((cur) => (cur === t.id ? null : t.id));
    },
    // The steps, filled in place on the task, with Keep all / Undo.
    preview: (t) => {
      if (bd?.taskId !== t.id) return null;
      return (
        <div onPointerDown={stop} onClick={stop} className="mt-1.5 cursor-default rounded-lg border border-accent/40 bg-[var(--nav-active-bg)] p-2.5 text-xs">
          <p className="mb-1.5 flex items-center gap-1 font-semibold text-[color:var(--nav-active-text)]"><Sparkles size={12} /> Break down</p>
          {bd.state === "loading" && <p className="flex items-center gap-1.5 text-muted"><Loader2 size={12} className="animate-spin" /> Breaking this down…</p>}
          {bd.state === "error" && (
            <div className="space-y-1.5">
              <p className="text-red-500">{bd.error}</p>
              <div className="flex gap-1.5">
                <button className="btn-ghost border border-border px-2 py-1 text-xs" onClick={() => void runBreakdown(t)}>Try again</button>
                <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setBd(null)}>Close</button>
              </div>
            </div>
          )}
          {bd.state === "question" && (
            <form className="space-y-1.5" onSubmit={(e) => { e.preventDefault(); if (bdAnswer.trim()) void runBreakdown(t, bdAnswer.trim()); }}>
              <p className="text-text">{bd.question}</p>
              <input className="input h-8 py-0 text-xs" autoFocus value={bdAnswer} onChange={(e) => setBdAnswer(e.target.value)} placeholder="Your answer" aria-label="Answer Madeline's question" />
              <div className="flex gap-1.5">
                <button type="submit" className="btn-primary px-2.5 py-1 text-xs" disabled={!bdAnswer.trim()}>Break down</button>
                <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setBd(null)}>Cancel</button>
              </div>
            </form>
          )}
          {bd.state === "steps" && bd.steps && (
            <>
              <ol className="mb-2 space-y-1">
                {bd.steps.map((s, i) => (
                  <li key={i} className="flex gap-1.5 text-text">
                    <span className="mt-[3px] h-3 w-3 shrink-0 rounded-sm border border-border bg-surface" aria-hidden="true" />
                    <span className="min-w-0 flex-1">{s.text}</span>
                    {s.minutes && <span className="shrink-0 text-faint">~{s.minutes} min</span>}
                  </li>
                ))}
              </ol>
              <div className="flex gap-1.5">
                <button className="btn-primary px-2.5 py-1 text-xs" onClick={() => keepSteps(t, bd.steps!)}>Keep all</button>
                <button className="btn-ghost border border-border px-2.5 py-1 text-xs" onClick={() => setBd(null)}>Undo</button>
              </div>
            </>
          )}
        </div>
      );
    },
  };

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

  // With a task open, Madeline knows which one "this task" is.
  const openTask = modal && editingId ? tasks.find((t) => t.id === editingId) ?? null : null;
  useMadelineContext(
    openTask ? taskItem(openTask, members.find((m) => m.user_id === openTask.assignee_id)?.name) : null,
  );

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
    setForm({ title: t.title, priority: t.priority, due: t.due_at ? t.due_at.slice(0, 10) : "", subtasks: t.subtasks ?? [], recurrence: t.recurrence ?? "none", dependsOn: t.depends_on ?? "", clientId: clients.find((c) => c.name === t.client_name)?.id ?? "", assigneeId: t.assignee_id ?? "", blockerNote: t.blocker_note ?? "", clientBlocker: t.client_visible_blocker ?? "", notes: t.notes ?? "", progress: t.progress ?? [], attachments: t.attachments ?? [], status: t.status, requiresApproval: t.requires_approval ?? false });
    setEditingId(t.id); setModal(true);
  }
  function fromTemplate(t: TaskTemplate) {
    setForm({ title: t.title, priority: t.priority, due: "", recurrence: "none", dependsOn: "", clientId: "", assigneeId: "", blockerNote: "", clientBlocker: "", notes: "", progress: [], attachments: [], status: "todo", requiresApproval: false, subtasks: t.subtasks.map((l, i) => ({ id: `${Date.now()}-${i}`, label: l, done: false })) });
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
      client_visible_blocker: form.clientBlocker.trim() || null,
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
      <ClientScopeBanner note="Tasks with no client attached are hidden." />
      <PageHeader
        title="Tasks"
        titleAside={
          <div className="flex flex-wrap items-center gap-1.5" aria-label="AI actions">
            {([
              ["Prioritize board", runPrioritize],
              ["Break down a task", startBreakdown],
              ["Find stuck tasks", () => { markTried(); setStuckOpen(true); }],
            ] as const).map(([label, run]) => (
              <button
                key={label}
                type="button"
                onClick={run}
                disabled={!visible.some((t) => t.status !== "done")}
                className={cn(
                  "flex h-8 items-center gap-1.5 rounded-full border border-accent/50 bg-[var(--nav-active-bg)] px-3 text-xs font-semibold text-[color:var(--nav-active-text)] transition-colors hover:border-accent hover:bg-accent hover:text-white disabled:pointer-events-none disabled:opacity-40",
                  !tried && "ai-attention",
                )}
              >
                <Sparkles size={12} /> {label}
              </button>
            ))}
          </div>
        }
        action={
          <div className="flex gap-2">
            <button className="btn-ghost border border-border" onClick={() => setTrashOpen(true)} title="Deleted tasks, kept for 30 days"><Trash2 size={15} /> <span className="hidden sm:inline">Recently deleted</span></button>
            <button className="btn-ghost border border-border" onClick={() => setTemplates(true)}><Copy size={15} /> Templates</button>
            {/* Wrapped, not passed directly: startCreate's first argument is the
                column to create in, and onClick would hand it a MouseEvent. */}
            <button className="btn-primary" onClick={() => startCreate()}><Plus size={15} /> New task</button>
          </div>
        }
      />

      {picking && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-accent/40 bg-[var(--nav-active-bg)] px-3 py-2 text-sm text-[color:var(--nav-active-text)]">
          <Sparkles size={14} /> Pick a task first: click the card you want broken down.
          <button className="ml-auto text-xs font-semibold hover:underline" onClick={() => setPicking(false)}>Cancel</button>
        </div>
      )}

      {/* One row of filters (28 Sep audit: the old two rows, three chips plus one
          per teammate plus a view switch, read as clutter). Search first,
          because on a board of forty typing three letters beats working out
          whose it was; then whose tasks, as one dropdown that holds everyone. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1 sm:max-w-xs">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input
            className="input pl-9"
            placeholder="Search tasks"
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
        <select
          className="input w-auto"
          value={who}
          onChange={(e) => setWho(e.target.value)}
          aria-label="Whose tasks"
        >
          <option value="all">Assignee: Anyone</option>
          <option value="mine">My tasks</option>
          <option value="unassigned">Unassigned</option>
          {members.length > 0 && (
            <optgroup label="Assigned to">
              {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.name}</option>)}
            </optgroup>
          )}
        </select>
        {!scopeId && (
          <select className="input w-auto" value={clientF} onChange={(e) => setClientF(e.target.value)} aria-label="Client">
            <option value="all">Client: All</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        <select className="input w-auto" value={prioF} onChange={(e) => setPrioF(e.target.value)} aria-label="Priority">
          <option value="all">Priority: All</option>
          {Object.entries(priorityLabel).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select className="input w-auto" value={dueF} onChange={(e) => setDueF(e.target.value)} aria-label="Due date">
          <option value="all">Due date: Any</option>
          <option value="overdue">Overdue</option>
          <option value="today">Due today</option>
          <option value="week">Next 7 days</option>
          <option value="none">No due date</option>
        </select>
      </div>

      {stuck && (
        <StuckCard
          rows={stuck.rows}
          checked={stuck.checked}
          onClose={() => setStuckOpen(false)}
          onOpen={(r: StuckRow) => startEdit(r.task)}
          onSetDate={(r: StuckRow, day: string) => {
            const before = r.task.due_at;
            update.mutate({ id: r.task.id, due_at: day } as Parameters<typeof update.mutate>[0]);
            setToast({ message: `New due date for "${r.task.title}"`, undo: () => update.mutate({ id: r.task.id, due_at: before } as Parameters<typeof update.mutate>[0]) });
          }}
          onNudge={(r: StuckRow) => addComment.mutate({ taskId: r.task.id, body: "Nudge: any update on this one? It hasn't moved in a while." })}
        />
      )}

      <BoardAiContext.Provider value={boardAi}>
      {isLoading ? (
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
          {COLUMNS.map((col) => (
            <div key={col.key} className="space-y-3">
              <SkeletonCard lines={2} />
              <SkeletonCard lines={3} />
            </div>
          ))}
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={() => { setActiveId(null); setOverCol(null); }}>
          {/* One row of five on wide screens (deck slide 5). */}
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
            {COLUMNS.map((col) => (
              <Column key={col.key} status={col.key} label={col.label} dot={col.dot} wash={col.wash} edge={col.edge} items={board[col.key]} blockedIds={blockedIds} onDelete={(t) => setConfirmDel(t)} onToggleSub={(t, subId) => update.mutate({ id: t.id, subtasks: t.subtasks.map((s) => (s.id === subId ? { ...s, done: !s.done } : s)) } as Parameters<typeof update.mutate>[0])} onEdit={startEdit} onComplete={(id) => setStatus.mutate({ id, status: "done" })} onAdd={startCreate} onSave={(t) => saveToggle.mutate({ kind: "task", targetId: t.id, label: t.title, saved: savedIds.has(t.id) })} savedIds={savedIds} commentCounts={commentCounts} focusId={focusId} justDroppedId={justDroppedId} dropActive={activeId !== null && overCol === col.key} />
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

      </BoardAiContext.Provider>

      {panel && (
        <PrioritizePanel
          result={panel.result}
          generatedAt={panel.at}
          onClose={() => setPanel(null)}
          onRefresh={runPrioritize}
          onOpenTask={(r) => setParams({ task: r.task.id })}
          onApply={applyChanges}
          onContinueInChat={continueInChat}
        />
      )}
      {toast && <UndoToast message={toast.message} onUndo={toast.undo} onDone={() => setToast(null)} />}

      <DeleteTaskDialog
        task={confirmDel}
        pending={remove.isPending}
        onCancel={() => setConfirmDel(null)}
        onConfirm={() => {
          const t = confirmDel;
          if (!t) return;
          remove.mutate(t.id, { onSuccess: () => setConfirmDel(null) });
        }}
      />
      <RecentlyDeleted open={trashOpen} onClose={() => setTrashOpen(false)} />
      {remove.isError && (
        <p role="alert" className="fixed bottom-4 left-1/2 z-[80] -translate-x-1/2 rounded-lg bg-red-600 px-3 py-2 text-sm text-white shadow-lg">
          Couldn't delete the task: {remove.error instanceof Error ? remove.error.message : "please try again."}
        </p>
      )}

      {/* Add / Edit */}
      <Modal open={modal} onClose={() => { setModal(false); setEditingId(null); }}>
        <h2 className="mb-4 text-lg font-semibold">{editingId ? "Edit task" : "New task"}</h2>
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
              <label className="field-label">Waiting on task</label>
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
              placeholder="e.g. Waiting on the client's signed contract"
              value={form.blockerNote}
              onChange={(e) => setForm((f) => ({ ...f, blockerNote: e.target.value }))}
            />
            <p className="mt-1 text-[11px] text-faint">Fill this in and the task shows as blocked, and it lands in your EOD report by itself.</p>
          </div>

          {/* The client reads THIS one and never the field above. 0072 keeps
              blocker_note unpublished because it is written to yourself and to
              your EOD; but the most common blocker on an assistant task is the
              client themselves, and "1 blocked" with no reason is how a task
              sits for a week over a login nobody asked for. */}
          <div>
            <label className="field-label" htmlFor="task-client-blocker">What do you need from the client? (optional)</label>
            <input
              id="task-client-blocker"
              className="input"
              placeholder="e.g. Access to the bank portal"
              value={form.clientBlocker}
              onChange={(e) => setForm((f) => ({ ...f, clientBlocker: e.target.value }))}
            />
            <p className="mt-1 text-[11px] text-faint">Shown to the client in their portal, in these exact words. Leave it empty and they see only that the task is blocked.</p>
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
        <p className="mb-4 text-sm text-muted">Common EA tasks. Creates a task with its checklist ready to tweak.</p>
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
