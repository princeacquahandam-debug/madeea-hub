import { useState } from "react";
import { Video, Trash2, Clock, Play, Bookmark, Lock } from "lucide-react";
import { PageHeader, Modal, Badge } from "@/components/ui";
import { cn } from "@/lib/utils";
import { ScreenRecorder } from "@/components/ScreenRecorder";
import {
  atLeast, recordingUrl, useMyRole, useRecordingMutations, useRecordings, useSaved, useSavedMutations,
} from "@/data/hooks";
import type { Recording } from "@/types/db";

/**
 * The recording library.
 *
 * Its own page rather than a strip inside SOPs, which is where it started and
 * where nobody found it. A recording is not a sub-feature of a checklist: it is
 * how a process gets out of somebody's head in the first place, and the SOP is
 * what it becomes afterwards.
 *
 * ═══ ADMINS ONLY, ON COST ════════════════════════════════════════════════
 *
 * Rowena, 14 Sep (24:06): "huwag mong ipapakita yan." Transcribing video is by
 * some distance the most expensive thing in this app, and the team had already
 * watched a $100 OpenAI balance go in a couple of days. The balance is shared
 * across the workspace, so whoever spends it does not just lose this page —
 * they take the quick actions, the EOD drafts and the assistant down with it
 * for everyone, and the first anyone knows is a feature quietly failing.
 *
 * The constants.ts entry hides the link. This is the half that matters: a link
 * is not a lock, and anybody who used this page before it was gated still has
 * the URL. Agreed on the call as a future upsell, so nothing is deleted.
 *
 * Not a security boundary. Recordings are still governed by workspace RLS, and
 * an employee reaching the API directly is refused there rather than here.
 * This is a spending control, which is a different thing and is allowed to
 * live in the UI.
 */
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const daysLeft = (iso: string) => Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 864e5));

export default function Videos() {
  const { data: role, isLoading: roleLoading } = useMyRole();
  const { data: recordings = [], isLoading } = useRecordings();
  const { save, remove } = useRecordingMutations();
  const { data: saved = [] } = useSaved();
  const { toggle } = useSavedMutations();
  const savedIds = new Set(saved.filter((s) => s.kind === "recording").map((s) => s.target_id));
  const [recording, setRecording] = useState(false);
  const [playing, setPlaying] = useState<{ title: string; url: string } | null>(null);

  const play = async (r: Recording) => {
    const url = await recordingUrl(r);
    if (url) setPlaying({ title: r.title, url });
  };

  /* Nothing at all while the role resolves. Rendering the library first and
     snatching it back a moment later would show the page to exactly the person
     it is being kept from, and useMyRole throws rather than assuming the lowest
     role, so this settles either way. */
  if (roleLoading) return null;

  if (!atLeast(role, "admin")) {
    return (
      <div>
        <PageHeader
          title="Video Instruction"
          subtitle="Recording is limited to workspace admins."
        />
        <div className="card mt-4 flex items-start gap-3 p-4">
          <Lock size={16} className="mt-0.5 shrink-0 text-faint" />
          <div className="text-sm text-muted">
            <p>
              Screen recording and transcription run up the workspace AI balance
              faster than anything else in the app, and that balance is shared —
              so it is kept with the admins who can see what it costs.
            </p>
            <p className="mt-2">
              If you need a process captured, ask an admin to record it, or write
              it up in <span className="text-text">Workflows</span> instead.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Video Instruction"
        subtitle="Record how a job is done once, so the next person watches it instead of asking."
        action={
          <button className="btn-primary" onClick={() => setRecording(true)}>
            <Video size={15} /> Record
          </button>
        }
      />

      <ScreenRecorder
        open={recording}
        onClose={() => setRecording(false)}
        saving={save.isPending}
        onSave={(r) =>
          save.mutate(
            { title: `Recording ${new Date().toLocaleDateString()}`, blob: r.blob, durationSeconds: r.durationSeconds, hasAudio: r.hasAudio },
            { onSuccess: () => setRecording(false) },
          )
        }
      />

      {isLoading && <p className="text-sm text-faint">Loading…</p>}

      {!isLoading && recordings.length === 0 && (
        <div className="card p-8 text-center">
          <Video size={26} className="mx-auto mb-3 text-faint" />
          <p className="font-medium">No recordings yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-faint">
            Record a browser tab while you talk through a task. It stays private to you and is
            deleted after 30 days. Long enough to write the SOP, short enough not to become an
            archive of your screen.
          </p>
          <button className="btn-primary mt-4" onClick={() => setRecording(true)}>
            <Video size={15} /> Record your first one
          </button>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {recordings.map((r) => {
          const alive = Boolean(r.storage_path || r.local_url);
          return (
            <div key={r.id} className="card group flex flex-col p-4">
              <div className="mb-2 flex items-start gap-2">
                <Video size={15} className="mt-0.5 shrink-0 text-accent" />
                <p className="min-w-0 flex-1 truncate text-sm font-medium">{r.title}</p>
                <button
                  className={cn("icon-btn shrink-0", savedIds.has(r.id) ? "text-accent" : "reveal-on-hover text-faint hover:text-accent")}
                  onClick={() => toggle.mutate({ kind: "recording", targetId: r.id, label: r.title, saved: savedIds.has(r.id) })}
                  aria-label={savedIds.has(r.id) ? `Remove ${r.title} from saved` : `Save ${r.title}`}
                >
                  <Bookmark size={13} fill={savedIds.has(r.id) ? "currentColor" : "none"} />
                </button>
                <button
                  className="icon-btn reveal-on-hover shrink-0 text-faint hover:text-red-400"
                  onClick={() => remove.mutate(r)}
                  aria-label={`Delete ${r.title}`}
                >
                  <Trash2 size={13} />
                </button>
              </div>

              <p className="mb-3 flex items-center gap-2 text-xs text-faint">
                <Clock size={11} /> {mmss(r.duration_seconds)}
                {r.has_audio && <>· narrated</>}
                {/* Retention is stated on every card, not buried in a policy
                    page. The EA should know the video goes and the SOP stays. */}
                <span className="ml-auto">{alive ? `${daysLeft(r.expires_at)}d left` : "expired"}</span>
              </p>

              <div className="mt-auto flex items-center gap-2">
                <button className="btn-ghost flex-1" onClick={() => void play(r)} disabled={!alive}>
                  <Play size={14} /> {alive ? "Play" : "Gone"}
                </button>
                {r.sop_id && <Badge tone="done">SOP written</Badge>}
              </div>
            </div>
          );
        })}
      </div>

      <Modal open={!!playing} onClose={() => setPlaying(null)}>
        {playing && (
          <>
            <h2 className="mb-2 text-lg font-semibold">{playing.title}</h2>
            <video src={playing.url} controls autoPlay className="w-full rounded-lg bg-black" />
          </>
        )}
      </Modal>
    </div>
  );
}
