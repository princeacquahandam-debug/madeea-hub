import { useMemo, useState } from "react";
import { StickyNote, Plus, Trash2, Pin, PinOff, Search, Info, Check, X, Pencil } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { useClients, useNotes, useNoteMutations } from "@/data/hooks";
import { NOTE_EXAMPLES, noteClientName, noteHeading, searchNotes, sortNotes, type Note } from "@/lib/notes";

export default function Notes() {
  const { data: notes = [] } = useNotes();
  const { data: clients = [] } = useClients();
  const { create, update, remove } = useNoteMutations();

  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState({ title: "", body: "", client_id: "" });
  const [saveError, setSaveError] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({ title: "", body: "" });

  const filtered = useMemo(() => sortNotes(searchNotes(notes, query)), [notes, query]);

  async function add() {
    if (!draft.body.trim()) return;
    setSaveError("");
    try {
      await create.mutateAsync({
        title: draft.title.trim(),
        body: draft.body.trim(),
        client_id: draft.client_id || null,
      });
      // Keep the chosen client — most people add several notes about the same one.
      setDraft({ title: "", body: "", client_id: draft.client_id });
    } catch (e) {
      // The draft is NOT cleared on failure — retyping is worse than a full box.
      setSaveError(e instanceof Error ? e.message : "Could not save that note.");
    }
  }

  function startEdit(n: Note) {
    setEditing(n.id);
    setEditDraft({ title: n.title, body: n.body });
  }

  async function saveEdit(id: string) {
    if (!editDraft.body.trim()) return;
    await update.mutateAsync({ id, title: editDraft.title.trim(), body: editDraft.body.trim() });
    setEditing(null);
  }

  return (
    <div>
      <PageHeader
        title="Notes"
        subtitle="A shared scratchpad for the team — anything that doesn't belong on a task, a client, or in the calendar yet."
      />

      {/* Honest scope: this is deliberately NOT the Memory Helper. Say so, so the two
          don't quietly compete for the same job in people's heads. */}
      <div className="card mb-5 border-accent/30 bg-accent/5 p-4">
        <div className="flex items-start gap-2">
          <Info size={15} className="mt-0.5 shrink-0 text-accent-soft" />
          <div className="text-xs leading-relaxed text-muted">
            <p className="mb-1 font-medium text-zinc-200">Notes are just for people — nothing else reads them.</p>
            The whole team shares this pad. If you want something to shape the AI's email drafts and briefings,
            record it in the <strong className="text-zinc-200">Memory Helper</strong> instead — that's the one the
            assistant reads. Notes stay a quiet place to park a thought.
          </div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[22rem_1fr]">
        {/* ---- capture ---- */}
        <div className="card h-fit p-5">
          <div className="mb-3 flex items-center gap-2">
            <Plus size={16} className="text-accent-soft" />
            <h2 className="font-semibold">Add a note</h2>
          </div>

          <div className="space-y-3">
            <div>
              <label className="field-label" htmlFor="note-title">Title <span className="text-faint">(optional)</span></label>
              <input
                className="input"
                id="note-title"
                placeholder="e.g. Office parking code"
                value={draft.title}
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
              />
            </div>

            <div>
              <label className="field-label" htmlFor="note-about">About</label>
              <select
                className="input"
                id="note-about"
                value={draft.client_id}
                onChange={(e) => setDraft((d) => ({ ...d, client_id: e.target.value }))}
              >
                <option value="">General — the whole desk</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="field-label" htmlFor="note-body">Note</label>
              <textarea
                className="input min-h-[96px]"
                id="note-body"
                placeholder={NOTE_EXAMPLES[0]}
                value={draft.body}
                onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
              />
            </div>

            {saveError && (
              <p className="rounded-lg border border-red-500/40 bg-red-500/5 p-2.5 text-xs text-red-300">
                {saveError}
              </p>
            )}

            <button className="btn-primary w-full" onClick={add} disabled={!draft.body.trim() || create.isPending}>
              <StickyNote size={15} />
              {create.isPending ? "Saving…" : "Save note"}
            </button>
          </div>

          {notes.length === 0 && (
            <div className="mt-4 border-t border-border pt-3">
              <p className="field-label">For example</p>
              <ul className="space-y-1 text-xs text-faint">
                {NOTE_EXAMPLES.map((e) => (
                  <li key={e}>• {e}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* ---- browse ---- */}
        <div>
          <div className="mb-4 relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <input
              className="input pl-9"
              aria-label="Search notes"
              placeholder="Search notes…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            {filtered.map((n) => (
              <div key={n.id} className="card p-4">
                {editing === n.id ? (
                  <div className="space-y-2">
                    <input
                      className="input"
                      aria-label="Edit note title"
                      placeholder="Title (optional)"
                      value={editDraft.title}
                      onChange={(e) => setEditDraft((d) => ({ ...d, title: e.target.value }))}
                    />
                    <textarea
                      className="input min-h-[80px]"
                      aria-label="Edit note body"
                      value={editDraft.body}
                      onChange={(e) => setEditDraft((d) => ({ ...d, body: e.target.value }))}
                    />
                    <div className="flex justify-end gap-1">
                      <button
                        className="rounded-md p-1.5 text-faint transition-colors hover:bg-surface-2 hover:text-zinc-100"
                        onClick={() => setEditing(null)}
                        aria-label="Cancel edit"
                        title="Cancel"
                      >
                        <X size={14} />
                      </button>
                      <button
                        className="rounded-md p-1.5 text-accent transition-colors hover:bg-accent/10 disabled:opacity-40"
                        onClick={() => saveEdit(n.id)}
                        disabled={!editDraft.body.trim() || update.isPending}
                        aria-label="Save edit"
                        title="Save"
                      >
                        <Check size={14} />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <span className="font-medium">{noteHeading(n)}</span>
                        <span className="text-xs text-faint">{noteClientName(clients, n.client_id)}</span>
                        {n.pinned && (
                          <span className="pill bg-accent/15 text-accent-soft">
                            <Pin size={10} /> Pinned
                          </span>
                        )}
                      </div>
                      {(n.title.trim() || n.body.trim() !== noteHeading(n)) && (
                        <p className="whitespace-pre-wrap text-sm text-muted">{n.body}</p>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button
                        className="rounded-md p-1.5 text-faint transition-colors hover:bg-surface-2 hover:text-zinc-100"
                        onClick={() => startEdit(n)}
                        title="Edit this note"
                        aria-label={`Edit ${noteHeading(n)}`}
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        className="rounded-md p-1.5 text-faint transition-colors hover:bg-accent/10 hover:text-accent"
                        onClick={() => update.mutate({ id: n.id, pinned: !n.pinned })}
                        title={n.pinned ? "Unpin" : "Pin to the top"}
                        aria-label={n.pinned ? `Unpin ${noteHeading(n)}` : `Pin ${noteHeading(n)}`}
                      >
                        {n.pinned ? <PinOff size={14} /> : <Pin size={14} />}
                      </button>
                      <button
                        className="rounded-md p-1.5 text-faint transition-colors hover:bg-red-500/10 hover:text-red-400"
                        onClick={() => remove.mutate(n.id)}
                        title="Delete this note"
                        aria-label={`Delete ${noteHeading(n)}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {filtered.length === 0 && (
              <div className="card flex flex-col items-center gap-2 py-14 text-center">
                <StickyNote size={28} className="text-faint" />
                <p className="font-medium">{notes.length ? "Nothing matches that" : "No notes yet"}</p>
                <p className="max-w-md text-sm text-faint">
                  {notes.length
                    ? "Search matches words in the title and body — try a word that actually appears in a note."
                    : "Jot down the first thing that doesn't have a home yet — a door code, a reminder to ask someone something."}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
