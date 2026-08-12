import { useRef, useState } from "react";
import { Upload, FileText, Trash2, Download, Bookmark, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { fileUrl, useClients, useFileMutations, useFiles, useSaved, useSavedMutations } from "@/data/hooks";
import type { WorkspaceFile } from "@/types/db";
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
  const [error, setError] = useState<string | null>(null);

  const savedIds = new Set(saved.filter((s) => s.kind === "file").map((s) => s.target_id));

  const send = (list: FileList | null) => {
    if (!list?.length) return;
    setError(null);
    for (const f of Array.from(list)) {
      // The bucket caps at 50MB; saying so up front beats a failed upload.
      if (f.size > 50 * 1024 * 1024) {
        setError(`"${f.name}" is ${humanSize(f.size)} — the limit is 50 MB.`);
        continue;
      }
      upload.mutate({ file: f, clientId: client || null });
    }
  };

  const download = async (f: WorkspaceFile) => {
    const url = await fileUrl(f);
    if (url) window.open(url, "_blank", "noopener");
  };

  return (
    <div>
      <PageHeader
        title="Uploads"
        subtitle="Documents the whole team can find — not a link in someone's inbox."
        action={
          <button className="btn-primary" onClick={() => inputRef.current?.click()} disabled={upload.isPending}>
            {upload.isPending ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
            {upload.isPending ? "Uploading…" : "Upload"}
          </button>
        }
      />

      <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => { send(e.target.files); e.target.value = ""; }} />

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
        <p className="mt-2 text-[11px] text-faint">Up to 50 MB each.</p>
      </div>

      {error && <div className="card mb-4 border-red-500/40 bg-red-500/5 p-3 text-sm text-red-300">{error}</div>}

      {isLoading && <p className="text-sm text-faint">Loading…</p>}

      {!isLoading && files.length === 0 && (
        <div className="card p-8 text-center">
          <FileText size={24} className="mx-auto mb-3 text-faint" />
          <p className="font-medium">No files yet</p>
          <p className="mt-1 text-sm text-faint">Contracts, briefs, brand assets — anything the next EA will need.</p>
        </div>
      )}

      <div className="card divide-y divide-border">
        {files.map((f) => {
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
