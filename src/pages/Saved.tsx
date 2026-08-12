import { useNavigate } from "react-router-dom";
import { Bookmark, CheckSquare, Video, FileText, ClipboardCheck, StickyNote, ClipboardList, X } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { useSaved, useSavedMutations, useTasks, useRecordings, useFiles } from "@/data/hooks";
import type { SavedItem } from "@/types/db";

/**
 * Things worth finding again.
 *
 * An EA reads something on Monday they need on Thursday. Without this the only
 * way back is remembering where it was.
 *
 * Every row is a POINTER, resolved live. A saved task shows its current title
 * and status, not the copy taken when it was saved, a stale bookmark is worse
 * than none, because it is confidently wrong.
 */
const KIND_META: Record<SavedItem["kind"], { icon: typeof CheckSquare; label: string; to: (id: string) => string }> = {
  task:      { icon: CheckSquare,    label: "Task",      to: (id) => `/tasks?task=${id}` },
  recording: { icon: Video,          label: "Recording", to: () => "/videos" },
  file:      { icon: FileText,       label: "File",      to: () => "/uploads" },
  sop:       { icon: ClipboardCheck, label: "Workflow",  to: () => "/sops" },
  note:      { icon: StickyNote,     label: "Note",      to: () => "/notes" },
  eod:       { icon: ClipboardList,  label: "EOD",       to: () => "/eod" },
};

export default function Saved() {
  const nav = useNavigate();
  const { data: saved = [], isLoading } = useSaved();
  const { toggle } = useSavedMutations();
  const { data: tasks = [] } = useTasks();
  const { data: recordings = [] } = useRecordings();
  const { data: files = [] } = useFiles();

  /** Resolve the pointer to whatever it points at, right now. */
  const resolve = (s: SavedItem): { title: string; sub?: string; missing?: boolean } => {
    if (s.kind === "task") {
      const t = tasks.find((x) => x.id === s.target_id);
      return t
        ? { title: t.title, sub: `${t.client_name} · ${t.status.replace("_", " ")}` }
        : { title: s.label ?? "Task", sub: "no longer exists", missing: true };
    }
    if (s.kind === "recording") {
      const r = recordings.find((x) => x.id === s.target_id);
      return r ? { title: r.title } : { title: s.label ?? "Recording", sub: "no longer exists", missing: true };
    }
    if (s.kind === "file") {
      const f = files.find((x) => x.id === s.target_id);
      return f ? { title: f.name } : { title: s.label ?? "File", sub: "no longer exists", missing: true };
    }
    return { title: s.label ?? KIND_META[s.kind].label };
  };

  return (
    <div>
      <PageHeader title="Saved" subtitle="Anything you bookmarked, kept live rather than copied." />

      {isLoading && <p className="text-sm text-faint">Loading…</p>}

      {!isLoading && saved.length === 0 && (
        <div className="card p-8 text-center">
          <Bookmark size={24} className="mx-auto mb-3 text-faint" />
          <p className="font-medium">Nothing saved yet</p>
          <p className="mt-1 text-sm text-faint">
            Use the bookmark icon on a task, recording or file and it turns up here.
          </p>
        </div>
      )}

      <div className="card divide-y divide-border">
        {saved.map((s) => {
          const meta = KIND_META[s.kind] ?? KIND_META.task;
          const Icon = meta.icon;
          const r = resolve(s);
          return (
            <div key={s.id} className="group flex items-center gap-3 px-3 py-2.5">
              <Icon size={15} className="shrink-0 text-faint" />
              <button
                className="min-w-0 flex-1 text-left disabled:cursor-default"
                onClick={() => nav(meta.to(s.target_id))}
                disabled={r.missing}
              >
                <p className={`truncate text-sm font-medium ${r.missing ? "text-faint line-through" : ""}`}>{r.title}</p>
                <p className="truncate text-xs text-faint">{meta.label}{r.sub ? ` · ${r.sub}` : ""}</p>
              </button>
              <button
                className="icon-btn reveal-on-hover shrink-0 text-faint hover:text-red-400"
                onClick={() => toggle.mutate({ kind: s.kind, targetId: s.target_id, saved: true })}
                aria-label={`Remove ${r.title} from saved`}
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
