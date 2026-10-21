import { useState } from "react";
import { Loader2, RotateCcw, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui";
import type { Task } from "@/types/db";
import { useWorkspaceMembers } from "@/data/hooks";
import { TRASH_DAYS, useTaskTrash, useTaskTrashMutations, type TrashedTask } from "@/data/taskTrash";

/**
 * Delete asks first (Reich's testing, 20 Oct 2026: one click deleted a task
 * with no warning, checklist progress and all). It says what would be lost and
 * where the task goes, so the decision is an informed one.
 */
export function DeleteTaskDialog({ task, pending, onCancel, onConfirm }: { task: Task | null; pending: boolean; onCancel: () => void; onConfirm: () => void }) {
  const done = task?.subtasks.filter((s) => s.done).length ?? 0;
  const total = task?.subtasks.length ?? 0;
  return (
    <Modal open={!!task} onClose={onCancel}>
      {task && (
        <div role="alertdialog" aria-labelledby="del-task-h" aria-describedby="del-task-p">
          <h2 id="del-task-h" className="mb-2 flex items-center gap-2 text-lg font-semibold">
            <Trash2 size={17} className="text-red-500" /> Delete this task?
          </h2>
          <p className="mb-1 text-sm font-medium">{task.title}</p>
          <p id="del-task-p" className="mb-4 text-sm text-muted">
            {total > 0 ? `Its checklist (${done} of ${total} done), notes and comments go with it. ` : ""}
            It moves to <b>Recently deleted</b>, where anyone on the team can restore it for {TRASH_DAYS} days.
          </p>
          <div className="flex justify-end gap-2">
            <button className="btn-ghost border border-border" onClick={onCancel} autoFocus>Cancel</button>
            <button className="btn-primary bg-red-600 hover:bg-red-700" onClick={onConfirm} disabled={pending}>
              {pending ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Delete
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function daysLeft(deletedAt: string): number {
  const left = TRASH_DAYS - Math.floor((Date.now() - new Date(deletedAt).getTime()) / 864e5);
  return Math.max(0, left);
}

/** Recently deleted: restore, or delete for good. */
export function RecentlyDeleted({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: rows = [], isLoading, isError } = useTaskTrash(open);
  const { data: members = [] } = useWorkspaceMembers();
  const { restore, purge } = useTaskTrashMutations();
  const [forever, setForever] = useState<string | null>(null);
  const [error, setError] = useState("");
  const nameOf = (id: string | null) => members.find((m) => m.user_id === id)?.name ?? "Someone";

  const run = (p: Promise<unknown>) => { setError(""); p.catch((e) => setError(e instanceof Error ? e.message : "That didn't work. Please try again.")); };

  return (
    <Modal open={open} onClose={onClose}>
      <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold"><Trash2 size={17} /> Recently deleted</h2>
      <p className="mb-4 text-sm text-muted">Deleted tasks stay here for {TRASH_DAYS} days with their checklist, notes and comments. Restore puts one back on the board.</p>
      {error && <p role="alert" className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">{error}</p>}
      {isLoading ? (
        <p className="py-6 text-center text-sm text-faint">Loading…</p>
      ) : isError ? (
        <p className="py-6 text-center text-sm text-faint">Couldn't load deleted tasks. Try again in a moment.</p>
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-faint">Nothing deleted in the last {TRASH_DAYS} days.</p>
      ) : (
        <ul className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
          {rows.map((r: TrashedTask) => {
            const subs = r.task.subtasks ?? [];
            return (
              <li key={r.id} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{r.title}</p>
                    <p className="text-xs text-faint">
                      Deleted by {nameOf(r.deleted_by)} · {new Date(r.deleted_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                      {subs.length > 0 && ` · checklist ${subs.filter((s) => s.done).length}/${subs.length}`}
                      {` · ${daysLeft(r.deleted_at)} days left`}
                    </p>
                  </div>
                  {forever === r.id ? (
                    <span className="flex items-center gap-1.5">
                      <span className="text-xs text-muted">Delete for good?</span>
                      <button className="rounded-md bg-red-500/15 px-2 py-1 text-xs font-medium text-red-500 hover:bg-red-500/25" disabled={purge.isPending}
                        onClick={() => run(purge.mutateAsync(r.id).finally(() => setForever(null)))}>Yes, delete</button>
                      <button className="px-1.5 py-1 text-xs text-faint hover:text-text" onClick={() => setForever(null)}>Cancel</button>
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5">
                      <button className="btn-ghost border border-border px-2.5 py-1 text-xs" disabled={restore.isPending}
                        onClick={() => run(restore.mutateAsync(r.id))}>
                        <RotateCcw size={13} /> Restore
                      </button>
                      <button className="icon-btn text-faint hover:text-red-500" onClick={() => setForever(r.id)} aria-label={`Delete "${r.title}" for good`} title="Delete for good">
                        <Trash2 size={14} />
                      </button>
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
