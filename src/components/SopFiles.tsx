import { useRef, useState } from "react";
import { Download, FileText, Loader2, Paperclip, Trash2 } from "lucide-react";
import { atLeast, fileUrl, useFileMutations, useMyRole, useSopFiles } from "@/data/hooks";
import { useAuth } from "@/hooks/useAuth";
import type { WorkspaceFile } from "@/types/db";

/**
 * Files on an SOP: a template, a checklist, an example to copy.
 *
 * From the 19 Oct 2026 team meeting: SOPs could take a Loom recording, and
 * "a feature where they can upload files" was promised next. Files land on
 * the team shelf, so they also show in Notes & Files and Madeline's team
 * knowledge, the same as any shared upload. Managers and admins attach;
 * everyone can open them. The uploader or an admin can remove one, which
 * is what the files policies (0067) already allow.
 */
export function SopFiles({ sopId }: { sopId: string }) {
  const { data: files = [] } = useSopFiles(sopId);
  const { upload, remove } = useFileMutations();
  const { data: role } = useMyRole();
  const { user } = useAuth();
  const canManage = atLeast(role, "manager");
  const isAdmin = atLeast(role, "admin");
  const input = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState("");

  function pick(list: FileList | null) {
    const file = list?.[0];
    if (!file) return;
    setErr("");
    upload.mutate(
      { file, sopId, scope: "team" },
      { onError: (e) => setErr(e instanceof Error ? e.message : "Couldn't upload that file.") },
    );
    if (input.current) input.current.value = "";
  }

  async function open(f: WorkspaceFile) {
    const url = await fileUrl(f);
    if (url) window.open(url, "_blank", "noopener");
    else setErr("Couldn't open that file. Try again.");
  }

  return (
    <section aria-label="Files" className="mt-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Paperclip size={15} className="text-faint" />
        <h3 className="text-[15px] font-semibold">Files</h3>
        {canManage && (
          <>
            <button
              onClick={() => input.current?.click()}
              disabled={upload.isPending}
              className="btn-ghost ml-auto border border-border px-2.5 py-1 text-xs"
            >
              {upload.isPending ? <Loader2 size={13} className="animate-spin" /> : <Paperclip size={13} />} Attach a file
            </button>
            <input ref={input} type="file" className="hidden" onChange={(e) => pick(e.target.files)} aria-label="Attach a file to this SOP" />
          </>
        )}
      </div>

      {err && <p className="mb-2 text-xs text-red-500">{err}</p>}

      {files.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-faint">
          No files yet.{canManage ? " Attach a template, checklist or example for this procedure." : ""}
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-2 px-3 py-2 text-sm">
              <FileText size={15} className="shrink-0 text-faint" />
              <button onClick={() => void open(f)} className="min-w-0 flex-1 truncate text-left hover:underline">
                {f.name}
              </button>
              <span className="shrink-0 text-xs text-faint">{Math.max(1, Math.round(f.size_bytes / 1024))} KB</span>
              <button onClick={() => void open(f)} className="btn-ghost p-1" aria-label={`Open ${f.name}`}>
                <Download size={14} />
              </button>
              {(f.uploaded_by === user?.id || isAdmin) && (
                <button
                  onClick={() => { if (confirm(`Remove ${f.name} from this SOP?`)) remove.mutate(f); }}
                  className="btn-ghost p-1 text-faint hover:text-red-500"
                  aria-label={`Remove ${f.name}`}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
