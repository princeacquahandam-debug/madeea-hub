import { useMemo, useState } from "react";
import { Brain, Plus, Trash2, Pin, PinOff, Search, Info } from "lucide-react";
import { Badge, PageHeader } from "@/components/ui";
import { useClients, useMemories, useMemoryMutations } from "@/data/hooks";
import {
  KIND_HELP,
  KIND_LABEL,
  KIND_TONE,
  MEMORY_EXAMPLES,
  MEMORY_KINDS,
  clientName,
  searchMemories,
  type MemoryKind,
} from "@/lib/memory";

export default function MemoryHelper() {
  const { data: memories = [] } = useMemories();
  const { data: clients = [] } = useClients();
  const { create, update, remove } = useMemoryMutations();

  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<MemoryKind | "all">("all");
  const [draft, setDraft] = useState({
    kind: "preference" as MemoryKind,
    body: "",
    client_id: "",
    source: "",
  });

  const filtered = useMemo(() => {
    const byKind = kindFilter === "all" ? memories : memories.filter((m) => m.kind === kindFilter);
    return searchMemories(byKind, query);
  }, [memories, kindFilter, query]);

  const [saveError, setSaveError] = useState("");

  async function add() {
    if (!draft.body.trim()) return;
    setSaveError("");
    try {
      await create.mutateAsync({
        kind: draft.kind,
        body: draft.body.trim(),
        client_id: draft.client_id || null,
        source: draft.source.trim(),
      });
      setDraft({ kind: draft.kind, body: "", client_id: draft.client_id, source: "" });
    } catch (e) {
      // The entry is NOT cleared on failure — retyping something you already typed
      // is a worse outcome than seeing the box stay full with an error above it.
      setSaveError(e instanceof Error ? e.message : "Could not save that memory.");
    }
  }

  return (
    <div>
      <PageHeader
        title="Memory Helper"
        subtitle="Things the desk shouldn't have to learn twice. Recorded once, surfaced wherever they're relevant."
      />

      {/* The honest scope statement. This feature's name promises more than it does,
          and quietly letting people assume otherwise is how it becomes dangerous. */}
      <div className="card mb-5 border-accent/30 bg-accent/5 p-4">
        <div className="flex items-start gap-2">
          <Info size={15} className="mt-0.5 shrink-0 text-accent-soft" />
          <div className="text-xs leading-relaxed text-muted">
            <p className="mb-1 font-medium text-zinc-200">This is a curated memory, not an automatic one.</p>
            Nothing is remembered unless you write it here. Recall matches on{" "}
            <strong className="text-zinc-200">keywords and client</strong>, not meaning — “doesn't like
            early calls” won't be found by searching “scheduling”. Entries you add against a client
            flow into that client's email drafts automatically, and never into anyone else's.
          </div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[22rem_1fr]">
        {/* ---- capture ---- */}
        <div className="card h-fit p-5">
          <div className="mb-3 flex items-center gap-2">
            <Plus size={16} className="text-accent-soft" />
            <h2 className="font-semibold">Remember something</h2>
          </div>

          <div className="space-y-3">
            <div>
              <label className="field-label" htmlFor="mem-kind">Kind</label>
              <select
                className="input"
                id="mem-kind"
                value={draft.kind}
                onChange={(e) => setDraft((d) => ({ ...d, kind: e.target.value as MemoryKind }))}
              >
                {MEMORY_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-faint">{KIND_HELP[draft.kind]}</p>
            </div>

            <div>
              <label className="field-label" htmlFor="mem-about">About</label>
              <select
                className="input"
                id="mem-about"
                value={draft.client_id}
                onChange={(e) => setDraft((d) => ({ ...d, client_id: e.target.value }))}
              >
                <option value="">General — the whole desk</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="field-label" htmlFor="mem-body">What to remember</label>
              <textarea
                className="input min-h-[76px]"
                placeholder={MEMORY_EXAMPLES[0]}
                id="mem-body"
                value={draft.body}
                onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
              />
            </div>

            <div>
              <label className="field-label" htmlFor="mem-source">Where this came from</label>
              <input
                className="input"
                placeholder="e.g. said on the call, 12 March"
                id="mem-source"
                value={draft.source}
                onChange={(e) => setDraft((d) => ({ ...d, source: e.target.value }))}
              />
              <p className="mt-1 text-[11px] text-faint">
                A fact nobody can trace is a fact nobody will act on.
              </p>
            </div>

            {saveError && (
              <p className="rounded-lg border border-red-500/40 bg-red-500/5 p-2.5 text-xs text-red-300">
                {saveError}
              </p>
            )}

            <button className="btn-primary w-full" onClick={add} disabled={!draft.body.trim() || create.isPending}>
              <Brain size={15} />
              {create.isPending ? "Saving…" : "Remember it"}
            </button>
          </div>

          {memories.length === 0 && (
            <div className="mt-4 border-t border-border pt-3">
              <p className="field-label">Things worth recording</p>
              <ul className="space-y-1 text-xs text-faint">
                {MEMORY_EXAMPLES.map((e) => (
                  <li key={e}>• {e}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* ---- browse ---- */}
        <div>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[14rem] flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
              <input
                className="input pl-9"
                aria-label="Search what you have recorded"
                placeholder="Search what you've recorded…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="flex rounded-lg border border-border bg-surface-2 p-0.5 text-xs">
              {(["all", ...MEMORY_KINDS] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setKindFilter(k)}
                  className={`rounded-md px-2.5 py-1 transition-colors ${
                    k === kindFilter ? "bg-accent text-white" : "text-muted hover:text-zinc-100"
                  }`}
                >
                  {k === "all" ? "All" : KIND_LABEL[k]}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            {filtered.map((m) => (
              <div key={m.id} className="card flex items-start gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <Badge tone={KIND_TONE[m.kind]}>{KIND_LABEL[m.kind]}</Badge>
                    <span className="text-xs text-faint">{clientName(clients, m.client_id)}</span>
                    {m.pinned && (
                      <span className="pill bg-accent/15 text-accent-soft">
                        <Pin size={10} /> Pinned
                      </span>
                    )}
                  </div>
                  <p className="text-sm">{m.body}</p>
                  {m.source && <p className="mt-1 text-xs italic text-faint">source: {m.source}</p>}
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    className="rounded-md p-1.5 text-faint transition-colors hover:bg-accent/10 hover:text-accent"
                    onClick={() => update.mutate({ id: m.id, pinned: !m.pinned })}
                    title={m.pinned ? "Unpin" : "Pin — always surface this for this client"}
                    aria-label={m.pinned ? `Unpin ${m.body}` : `Pin ${m.body}`}
                  >
                    {m.pinned ? <PinOff size={14} /> : <Pin size={14} />}
                  </button>
                  <button
                    className="rounded-md p-1.5 text-faint transition-colors hover:bg-red-500/10 hover:text-red-400"
                    onClick={() => remove.mutate(m.id)}
                    title="Forget this"
                    aria-label={`Forget ${m.body}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}

            {filtered.length === 0 && (
              <div className="card flex flex-col items-center gap-2 py-14 text-center">
                <Brain size={28} className="text-faint" />
                <p className="font-medium">
                  {memories.length ? "Nothing matches that" : "Nothing recorded yet"}
                </p>
                <p className="max-w-md text-sm text-faint">
                  {memories.length
                    ? "Search matches words, not meaning — try a word that actually appears in the entry."
                    : "Start with one client preference. It'll show up in their next email draft."}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
