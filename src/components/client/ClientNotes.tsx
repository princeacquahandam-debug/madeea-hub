import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Pencil, Plus, StickyNote, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { clockTime, dateOnly, dayLabel, localDayKey } from "./format";

/**
 * Notes, both ways. From the 14 Sep walkthrough (19:18): the client writes a
 * note, the assistant reads it on their own Notes page, and it works in reverse
 * — "pwede rin si EA magsisend kay client."
 *
 * NOT EVERY NOTE ON THE ACCOUNT. notes.client_id has always meant "this note is
 * ABOUT them", and the overwhelming majority of those rows are the assistant's
 * private working notes on an account. 0073 adds shared_with_client, defaulting
 * to false, and only shared rows reach this pane. An assistant shares a note by
 * deciding to, which is the only version of this that is safe to ship.
 *
 * WHY NOT THE MESSAGE CHANNELS. The portal already has two. A message is a
 * thing you send to somebody; a note is a thing that stays put and gets
 * referred back to — a login hint, a preference, the way they like the weekly
 * summary written. Collapsing the two would lose the second, which is the one
 * Rowena described.
 */

interface NoteRow {
  id: string;
  title: string;
  body: string;
  author_is_client: boolean;
  created_at: string;
  updated_at: string;
}

/** member: a client's own staff (0078). They read what is shared; the notes are between the client and their EA. */
export function ClientNotes({ readOnly = false, member = false }: { readOnly?: boolean; member?: boolean }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState("");

  const { data: notes = [], isLoading } = useQuery({
    queryKey: ["client-portal", "notes"],
    // The assistant writes out of band, same as the channels.
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase!
        .from("client_notes")
        .select("id, title, body, author_is_client, created_at, updated_at")
        .order("updated_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as NoteRow[];
    },
  });

  const add = useMutation({
    mutationFn: async () => {
      const { error } = await supabase!.rpc("client_create_note", {
        p_title: title.trim() || null,
        p_body: body.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setTitle("");
      setBody("");
      qc.invalidateQueries({ queryKey: ["client-portal", "notes"] });
    },
  });

  /* Edit and delete the notes YOU wrote (QA write test WA-12, 0108). The
     assistant's shared notes stay theirs to change. */
  const [editing, setEditing] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [rowError, setRowError] = useState<{ id: string; msg: string } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["client-portal", "notes"] });
  const update = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase!.rpc("client_update_note", { p_id: id, p_title: editTitle.trim() || null, p_body: editBody.trim() });
      if (error) throw error;
    },
    onSuccess: () => { setEditing(null); refresh(); },
    onError: (e, id) => setRowError({ id, msg: e instanceof Error ? e.message : "Could not save." }),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase!.rpc("client_delete_note", { p_id: id });
      if (error) throw error;
    },
    onSuccess: refresh,
    onError: (e, id) => setRowError({ id, msg: e instanceof Error ? e.message : "Could not delete." }),
  });
  const canEdit = (n: NoteRow) => n.author_is_client && !readOnly && !member;

  async function submit() {
    if (!body.trim() || add.isPending) return;
    setError("");
    try {
      await add.mutateAsync();
    } catch (e) {
      /* The draft survives. The ceiling in 0073 explains itself, so whatever
         the database said is what gets shown. */
      setError(e instanceof Error ? e.message : "Could not save that note.");
    }
  }

  return (
    <div className="space-y-6">
      {readOnly || member ? null : (
      <section className="card p-5">
        <h2 className="mb-3 text-[15px] font-semibold">Leave a note</h2>
        <p className="text-faint mb-2 text-sm">
          Anything your assistant should keep to hand — a preference, a contact, how you
          like something done. Your assistant sees these on their own notes page.
        </p>
        <div className="space-y-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title (optional)"
            maxLength={200}
            className="input"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            placeholder="What should they know?"
            maxLength={10000}
            className="input resize-none"
          />
          <button
            onClick={() => void submit()}
            disabled={!body.trim() || add.isPending}
            className="btn-primary whitespace-nowrap"
          >
            {add.isPending ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
            Save note
          </button>
        </div>
        {error ? (
          <p className="mt-2 flex items-start gap-2 text-sm" style={{ color: "rgb(248 113 113)" }}>
            <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {error}
          </p>
        ) : null}
      </section>
      )}

      <section className="card p-5">
        <h2 className="mb-3 text-[15px] font-semibold">Shared notes</h2>
        {isLoading ? (
          <p className="text-faint text-sm">Loading…</p>
        ) : notes.length === 0 ? (
          <p className="text-faint text-sm">
            {readOnly || member
              ? "Nothing has been shared on this account yet."
              : "Nothing shared yet. Notes you leave, and notes your assistant shares with you, both appear here."}
          </p>
        ) : (
          <ul className="space-y-2">
            {notes.map((n) => (
              <li
                key={n.id}
                className="rounded-lg border border-border p-3"
              >
                <div className="flex items-start gap-3">
                  <StickyNote size={15} className="text-faint mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    {editing === n.id ? (
                      <div className="space-y-2">
                        <input className="input" aria-label="Note title" maxLength={200} value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
                        <textarea className="input resize-none" aria-label="Note" rows={3} maxLength={10000} value={editBody} onChange={(e) => setEditBody(e.target.value)} />
                        <div className="flex gap-2">
                          <button className="btn-primary" disabled={!editBody.trim() || update.isPending} onClick={() => { setRowError(null); update.mutate(n.id); }}>
                            {update.isPending ? <Loader2 size={15} className="animate-spin" /> : null} Save
                          </button>
                          <button className="btn-ghost border border-border" onClick={() => setEditing(null)}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {n.title ? <div className="break-words text-sm font-medium">{n.title}</div> : null}
                        <div className="mt-0.5 whitespace-pre-wrap break-words text-sm">{n.body}</div>
                      </>
                    )}
                    {rowError?.id === n.id ? <p className="mt-1 text-xs" style={{ color: "rgb(248 113 113)" }}>{rowError.msg}</p> : null}
                    <div className="text-faint mt-1.5 text-xs">
                      {n.author_is_client ? (member ? "The account owner" : "You") : (member ? "The account's assistant" : "Your assistant")}
                      {" · "}
                      {dayLabel(dateOnly(localDayKey(n.updated_at)))} at {clockTime(n.updated_at)}
                    </div>
                  </div>
                  {canEdit(n) && editing !== n.id ? (
                    <div className="flex shrink-0 gap-1">
                      <button className="text-faint p-1 hover:text-accent" aria-label="Edit note"
                        onClick={() => { setEditing(n.id); setEditTitle(n.title === "Note from client" ? "" : n.title); setEditBody(n.body); setRowError(null); }}>
                        <Pencil size={14} />
                      </button>
                      <button className="text-faint p-1 hover:text-red-400" aria-label="Delete note" disabled={remove.isPending}
                        onClick={() => { if (window.confirm("Delete this note? Your assistant will no longer see it.")) { setRowError(null); remove.mutate(n.id); } }}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
