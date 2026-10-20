import { useState } from "react";
import { Link2, Loader2, Plus, Trash2, Video } from "lucide-react";
import { atLeast, useLearnVideoMutations, useLearnVideos, useMyRole } from "@/data/hooks";
import { loomEmbedUrl, loomId, loomShareUrl, useLoomRecorder } from "@/lib/loom";
import { LoomMark } from "@/components/LoomCard";

/**
 * Loom videos in Learn (19 Oct 2026 team meeting): training videos in the
 * Training Center, and a walkthrough on an SOP. They play right here.
 *
 * Everyone can watch. Managers and admins add them, by pasting a Loom link,
 * or by recording one in the app once Loom is set up (VITE_LOOM_APP_ID).
 * The database enforces the same (0089).
 */
export function LoomVideos({ sopId, title, empty }: { sopId: string | null; title: string; empty: string }) {
  const { data: videos = [] } = useLearnVideos(sopId);
  const { add, remove } = useLearnVideoMutations();
  const { data: role } = useMyRole();
  const canManage = atLeast(role, "manager");
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [link, setLink] = useState("");
  const [err, setErr] = useState("");
  const rec = useLoomRecorder((v) => {
    const id = loomId(v.url);
    if (id) add.mutate({ title: v.title, url: loomShareUrl(id), sop_id: sopId });
  });

  function save() {
    const id = loomId(link);
    if (!id) { setErr("That isn't a Loom link. It should look like https://www.loom.com/share/…"); return; }
    if (!name.trim()) { setErr("Give it a title."); return; }
    add.mutate({ title: name.trim(), url: loomShareUrl(id), sop_id: sopId }, {
      onSuccess: () => { setName(""); setLink(""); setErr(""); setAdding(false); },
      onError: (e) => setErr(e instanceof Error ? e.message : "Couldn't add that video."),
    });
  }

  return (
    <section aria-label={title} className="mt-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <LoomMark size={16} />
        <h3 className="text-[15px] font-semibold">{title}</h3>
        {canManage && (
          <div className="ml-auto flex gap-1.5">
            {rec.available && (
              <button ref={rec.buttonRef} onClick={() => { if (rec.state !== "ready") void rec.prepare(); }} disabled={rec.state === "loading"}
                className="btn-ghost border border-border px-2.5 py-1 text-xs">
                {rec.state === "loading" ? <Loader2 size={13} className="animate-spin" /> : <Video size={13} />} Record a Loom
              </button>
            )}
            <button onClick={() => setAdding((v) => !v)} className="btn-ghost border border-border px-2.5 py-1 text-xs">
              <Plus size={13} /> Add a Loom link
            </button>
          </div>
        )}
      </div>

      {rec.error && <p className="mb-2 text-xs text-red-500">{rec.error}</p>}

      {adding && (
        <div className="mb-3 space-y-2 rounded-lg border border-border p-3">
          <input className="input text-sm" placeholder="Title, e.g. How to triage the inbox" value={name} onChange={(e) => setName(e.target.value)} aria-label="Video title" />
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Link2 size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
              <input className="input pl-8 text-sm" placeholder="https://www.loom.com/share/…" value={link} onChange={(e) => setLink(e.target.value)} aria-label="Loom link" />
            </div>
            <button className="btn-primary shrink-0" onClick={save} disabled={add.isPending}>Add</button>
          </div>
          {err && <p className="text-xs text-red-500">{err}</p>}
        </div>
      )}

      {videos.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-5 text-center text-sm text-faint">{empty}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {videos.map((v) => {
            const id = loomId(v.url);
            return (
              <figure key={v.id} className="m-0 overflow-hidden rounded-lg border border-border bg-surface">
                {id && (
                  <div className="relative aspect-video bg-black">
                    <iframe src={loomEmbedUrl(id)} title={v.title} allowFullScreen loading="lazy" className="absolute inset-0 h-full w-full" />
                  </div>
                )}
                <figcaption className="flex items-center gap-2 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate font-medium" title={v.title}>{v.title}</span>
                  {canManage && (
                    <button onClick={() => remove.mutate(v.id)} className="icon-btn text-faint hover:text-red-500" aria-label={`Remove ${v.title}`}><Trash2 size={13} /></button>
                  )}
                </figcaption>
              </figure>
            );
          })}
        </div>
      )}
    </section>
  );
}
