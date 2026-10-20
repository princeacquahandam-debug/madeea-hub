import { useRef, useState } from "react";
import { Upload, FileText, Trash2, Download, Bookmark, Loader2, Users, Lock, ShieldCheck } from "lucide-react";
import { Modal, PageHeader } from "@/components/ui";
import { fileUrl, useClients, useFileMutations, useFiles, useSaved, useSavedMutations } from "@/data/hooks";
import type { WorkspaceFile, KbScope } from "@/types/db";
import { cn } from "@/lib/utils";

/**
 * Shared files.
 *
 * §5.5 of the audit, §4.5 of the plan. Today the only home for a client's
 * document is a link pasted on a task, and a link dies the moment somebody
 * tidies their Drive. A file the workspace owns does not.
 */
function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function Uploads() {
  const { data: files = [], isLoading } = useFiles();
  const { data: clients = [] } = useClients();
  const { data: saved = [] } = useSaved();
  const { upload, remove } = useFileMutations();
  const { toggle } = useSavedMutations();

  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [client, setClient] = useState("");
  /* Which shelf is open, and where an upload lands. Team first because it is
     the one a covering EA can find; a personal shelf nobody else can read is
     the exception, so it is the one you choose. */
  const [scope, setScope] = useState<KbScope>("team");
  const [error, setError] = useState<string | null>(null);
  /* Files waiting for consent before they go on the team shelf (19 Oct 2026
     team meeting: consent before Knowledge Base files are shared between
     accounts). */
  const [pending, setPending] = useState<File[] | null>(null);
  const [agreed, setAgreed] = useState(false);

  const savedIds = new Set(saved.filter((s) => s.kind === "file").map((s) => s.target_id));

  const put = (files: File[], to: KbScope) => {
    for (const f of files) upload.mutate({ file: f, clientId: client || null, scope: to });
  };

  const send = (list: FileList | null) => {
    if (!list?.length) return;
    setError(null);
    const ok: File[] = [];
    for (const f of Array.from(list)) {
      // The bucket caps at 50MB; saying so up front beats a failed upload.
      if (f.size > 50 * 1024 * 1024) {
        setError(`"${f.name}" is ${humanSize(f.size)}, the limit is 50 MB.`);
        continue;
      }
      ok.push(f);
    }
    if (!ok.length) return;
    /* The team shelf is shared with every account in the workspace, and
       Madeline reads it, so it asks first. The personal shelf stays private
       and needs no prompt. */
    if (scope === "team") { setAgreed(false); setPending(ok); }
    else put(ok, "personal");
  };

  const download = async (f: WorkspaceFile) => {
    const url = await fileUrl(f);
    if (url) window.open(url, "_blank", "noopener");
  };

  /* Filtered here rather than in the query: both shelves arrive in one fetch
     (the row policies already withhold other people's personal files), so
     switching tabs is instant and does not re-hit the network. */
  const shown = files.filter((f) => (f.scope ?? "team") === scope);

  return (
    <div>
      {/* ROWENA'S FRAMING, 20:54, and close to verbatim: "the reason for the
          uploads will be the knowledge base or database for the AI Quick
          Actions. YOUR AI Quick Actions."

          The page said "Knowledge base" and did not say whose or what for.
          Uploading documents is the most sensitive thing this app asks of a
          client, and the objection on the call was not about storage -- it was
          that an unexplained upload box reads as the agency collecting
          material. Naming what it feeds, and that it feeds THEIR assistant,
          is the whole difference. */}
      <PageHeader
        title="Uploads"
        subtitle={
          scope === "team"
            ? "Files for your team and for you."
            : "Your own shelf. Nobody else can open these, administrators included."
        }
        action={
          <button className="btn-primary" onClick={() => inputRef.current?.click()} disabled={upload.isPending}>
            {upload.isPending ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
            {upload.isPending ? "Uploading…" : "Upload"}
          </button>
        }
      />

      <Modal open={!!pending} onClose={() => setPending(null)}>
        <div className="pr-8">
          <h2 className="flex items-center gap-2 text-lg font-semibold"><ShieldCheck size={18} className="text-accent" /> Share with your team?</h2>
          <p className="mt-2 text-sm text-muted">
            {pending?.length === 1 ? "This file goes" : `These ${pending?.length ?? 0} files go`} on the <b>team shelf</b>. Once shared:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
            <li><b>Everyone in this workspace</b> can open and download {pending?.length === 1 ? "it" : "them"}: EAs, managers and admins.</li>
            <li><b>Madeline can read {pending?.length === 1 ? "it" : "them"}</b> to answer questions and run AI actions for your team.</li>
            <li>Clients can't see the team shelf from their portal.</li>
          </ul>
          <ul className="mt-3 max-h-32 space-y-1 overflow-y-auto rounded-lg border border-border p-2 text-xs">
            {(pending ?? []).map((f) => <li key={f.name + f.size} className="flex justify-between gap-2"><span className="truncate">{f.name}</span><span className="shrink-0 text-faint">{humanSize(f.size)}</span></li>)}
          </ul>
          <label className="mt-3 flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[rgb(var(--c-accent))]" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
            <span>I have permission to share {pending?.length === 1 ? "this file" : "these files"} with the team, and {pending?.length === 1 ? "it doesn't" : "they don't"} contain passwords or personal information that shouldn't be passed on.</span>
          </label>
          <div className="mt-4 flex flex-wrap gap-2">
            <button className="btn-primary" disabled={!agreed} onClick={() => { put(pending ?? [], "team"); setPending(null); }}>
              <Users size={15} /> Share with the team
            </button>
            <button className="btn-ghost border border-border" onClick={() => { put(pending ?? [], "personal"); setPending(null); setScope("personal"); }}>
              <Lock size={15} /> Keep on my personal shelf
            </button>
            <button className="btn-ghost" onClick={() => setPending(null)}>Cancel</button>
          </div>
        </div>
      </Modal>

      <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => { send(e.target.files); e.target.value = ""; }} />

      {/* The two shelves. A count on each, because "is it in Team or Personal"
          is the question somebody asks when a file is not where they expected. */}
      <div className="mb-4 flex gap-1.5">
        {([
          { key: "team" as KbScope, label: "Team", icon: Users },
          { key: "personal" as KbScope, label: "Personal", icon: Lock },
        ]).map(({ key, label, icon: Icon }) => {
          const n = files.filter((f) => (f.scope ?? "team") === key).length;
          return (
            <button
              key={key}
              onClick={() => setScope(key)}
              aria-pressed={scope === key}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                scope === key
                  ? "border-accent bg-accent/15 text-accent-soft"
                  : "border-border text-muted hover:text-zinc-100",
              )}
            >
              <Icon size={13} /> {label}
              <span className="text-faint">{n}</span>
            </button>
          );
        })}
      </div>

      {/* Drop zone. Drag-and-drop is the way people actually move a file, and a
          button alone makes them hunt for it. */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); send(e.dataTransfer.files); }}
        className={cn(
          "mb-5 rounded-xl border border-dashed p-6 text-center transition-colors",
          dragging ? "border-accent bg-accent/5" : "border-border",
        )}
      >
        <Upload size={20} className="mx-auto mb-2 text-faint" />
        <p className="text-sm">Drop files here, or <button className="text-accent-soft underline" onClick={() => inputRef.current?.click()}>browse</button></p>
        <div className="mt-3 flex items-center justify-center gap-2">
          <label className="text-xs text-faint" htmlFor="upload-client">Attach to</label>
          <select id="upload-client" className="input w-auto py-1 text-xs" value={client} onChange={(e) => setClient(e.target.value)}>
            <option value="">No client</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <p className="mt-2 text-[11px] text-faint">
          Up to 50 MB each · lands on{" "}
          <span className={scope === "personal" ? "text-amber-300" : "text-zinc-300"}>
            {scope === "personal" ? "your personal shelf" : "the team shelf"}
          </span>
        </p>
      </div>

      {error && <div className="card mb-4 border-red-500/40 bg-red-500/5 p-3 text-sm text-red-300">{error}</div>}

      {isLoading && <p className="text-sm text-faint">Loading…</p>}

      {!isLoading && shown.length === 0 && (
        <div className="card p-8 text-center">
          <FileText size={24} className="mx-auto mb-3 text-faint" />
          <p className="font-medium">{scope === "team" ? "No team files yet" : "Nothing on your shelf yet"}</p>
          <p className="mt-1 text-sm text-faint">
            {scope === "team"
              ? "Contracts, briefs, brand assets. Anything the next EA will need."
              : "Drafts, notes, anything not ready to be shared."}
          </p>
        </div>
      )}

      <div className="card divide-y divide-border">
        {shown.map((f) => {
          const isSaved = savedIds.has(f.id);
          const gone = !f.storage_key && !f.local_url;
          return (
            <div key={f.id} className="group flex items-center gap-3 px-3 py-2.5">
              <FileText size={15} className="shrink-0 text-faint" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{f.name}</p>
                <p className="truncate text-xs text-faint">
                  {humanSize(f.size_bytes)}
                  {f.client_id && <> · {clients.find((c) => c.id === f.client_id)?.name ?? "Client"}</>}
                  {gone && <> · content not available after reload</>}
                </p>
              </div>

              <button
                className={cn("icon-btn shrink-0", isSaved ? "text-accent" : "reveal-on-hover text-faint hover:text-accent")}
                onClick={() => toggle.mutate({ kind: "file", targetId: f.id, label: f.name, saved: isSaved })}
                aria-label={isSaved ? `Remove ${f.name} from saved` : `Save ${f.name}`}
                title={isSaved ? "Saved" : "Save for later"}
              >
                <Bookmark size={14} fill={isSaved ? "currentColor" : "none"} />
              </button>
              <button
                className="icon-btn reveal-on-hover shrink-0 text-faint hover:text-accent disabled:opacity-30"
                onClick={() => void download(f)}
                disabled={gone}
                aria-label={`Download ${f.name}`}
              >
                <Download size={14} />
              </button>
              <button
                className="icon-btn reveal-on-hover shrink-0 text-faint hover:text-red-400"
                onClick={() => remove.mutate(f)}
                aria-label={`Delete ${f.name}`}
              >
                <Trash2 size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
