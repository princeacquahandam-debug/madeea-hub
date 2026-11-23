import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, MessageSquare, Send } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { clockTime, dateOnly, dayLabel, localDayKey } from "./format";

/**
 * The comments on one task, as the client may see them (QA write test WA-11,
 * 0108). Task cards in the portal never opened, so a client could not ask about
 * a task or read the assistant's answer.
 *
 * Only comments marked visible to the client come back (client_task_comments):
 * everything the client writes, and what the agency chose to share. The
 * agency's own thread on the same task stays theirs.
 */

interface CommentRow {
  id: string;
  task_id: string;
  body: string;
  created_at: string;
  mine: boolean;
  from_client: boolean;
  author_name: string;
}

export const clientCommentsKey = (taskId: string) => ["client-portal", "task-comments", taskId] as const;

export function ClientTaskComments({ taskId, readOnly = false }: { taskId: string; readOnly?: boolean }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");

  const { data: comments = [], isLoading, error: loadError } = useQuery({
    queryKey: clientCommentsKey(taskId),
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase!
        .from("client_task_comments")
        .select("id, task_id, body, created_at, mine, from_client, author_name")
        .eq("task_id", taskId)
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as CommentRow[];
    },
  });

  const add = useMutation({
    mutationFn: async () => {
      const { error } = await supabase!.rpc("client_add_task_comment", { p_task_id: taskId, p_body: draft.trim() });
      if (error) throw error;
    },
    onSuccess: () => {
      setDraft("");
      qc.invalidateQueries({ queryKey: clientCommentsKey(taskId) });
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Could not post that comment."),
  });

  return (
    <section aria-label="Comments" className="mt-4">
      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
        <MessageSquare size={14} /> Comments
      </h3>
      {isLoading ? (
        <p className="text-faint text-sm">Loading…</p>
      ) : loadError ? (
        <p className="text-faint text-sm">Comments couldn't be loaded. Try again in a moment.</p>
      ) : comments.length === 0 ? (
        <p className="text-faint text-sm">No comments yet.{readOnly ? "" : " Ask a question or add a detail, and your assistant will see it on this task."}</p>
      ) : (
        <ul className="max-h-72 space-y-2 overflow-y-auto">
          {comments.map((c) => (
            <li key={c.id} className="rounded-lg border border-border p-2.5">
              <p className="text-faint text-xs">
                {c.mine ? "You" : c.author_name}
                {!c.mine && !c.from_client ? " (assistant)" : ""} · {dayLabel(dateOnly(localDayKey(c.created_at)))} at {clockTime(c.created_at)}
              </p>
              <p className="mt-0.5 whitespace-pre-wrap break-words text-sm">{c.body}</p>
            </li>
          ))}
        </ul>
      )}

      {readOnly ? null : (
        <form
          className="mt-3 flex items-end gap-2"
          onSubmit={(e) => { e.preventDefault(); if (draft.trim() && !add.isPending) { setError(""); add.mutate(); } }}
        >
          <label htmlFor={`cmt-${taskId}`} className="sr-only">Add a comment</label>
          <textarea
            id={`cmt-${taskId}`}
            className="input min-w-0 flex-1 resize-none"
            rows={2}
            maxLength={4000}
            placeholder="Add a comment…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button type="submit" className="btn-primary h-10" disabled={!draft.trim() || add.isPending} aria-label="Post comment">
            {add.isPending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
          </button>
        </form>
      )}
      {error ? (
        <p className="mt-2 flex items-start gap-2 text-sm" style={{ color: "rgb(248 113 113)" }}>
          <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {error}
        </p>
      ) : null}
    </section>
  );
}
