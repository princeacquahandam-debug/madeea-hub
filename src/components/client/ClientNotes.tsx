import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Plus, StickyNote } from "lucide-react";
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

export function ClientNotes({ readOnly = false }: { readOnly?: boolean }) {
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
    <div className="space-y-6 px-6 py-4">
      {readOnly ? null : (
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider">Leave a note</h2>
        <p className="text-faint mb-2 text-sm">
          Anything your assistant should keep to hand — a preference, a contact, how you
          like something done. Your assistant sees these on their own notes page.
        </p>
        <div className="space-y-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title (optional)"
            className="w-full rounded-xl px-4 py-2.5 text-sm"
            style={{ background: "var(--glass)", border: "1px solid var(--c-border)" }}
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            placeholder="What should they know?"
            className="w-full resize-none rounded-xl px-4 py-3 text-sm"
            style={{ background: "var(--glass)", border: "1px solid var(--c-border)" }}
          />
          <button
            onClick={() => void submit()}
            disabled={!body.trim() || add.isPending}
            className="flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium disabled:opacity-40"
            style={{ background: "var(--c-accent)", color: "#fff" }}
          >
            {add.isPending ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
            Save note
          </button>
        </div>
        {error ? (
          <p className="mt-2 flex items-start gap-2 text-sm" style={{ color: "var(--c-danger)" }}>
            <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {error}
          </p>
        ) : null}
      </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider">Shared notes</h2>
        {isLoading ? (
          <p className="text-faint text-sm">Loading…</p>
        ) : notes.length === 0 ? (
          <p className="text-faint text-sm">
            {readOnly
              ? "Nothing has been shared on this account yet."
              : "Nothing shared yet. Notes you leave, and notes your assistant shares with you, both appear here."}
          </p>
        ) : (
          <ul className="space-y-2">
            {notes.map((n) => (
              <li
                key={n.id}
                className="rounded-xl px-4 py-3"
                style={{ background: "var(--glass)", border: "1px solid var(--c-border)" }}
              >
                <div className="flex items-start gap-3">
                  <StickyNote size={15} className="text-faint mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    {n.title ? <div className="text-sm font-medium">{n.title}</div> : null}
                    <div className="mt-0.5 whitespace-pre-wrap break-words text-sm">{n.body}</div>
                    <div className="text-faint mt-1.5 text-xs">
                      {n.author_is_client ? "You" : "Your assistant"}
                      {" · "}
                      {dayLabel(dateOnly(localDayKey(n.updated_at)))} at {clockTime(n.updated_at)}
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
