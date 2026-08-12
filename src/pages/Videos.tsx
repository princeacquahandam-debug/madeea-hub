import { useState } from "react";
import { Video, Trash2, Clock, Play } from "lucide-react";
import { PageHeader, Modal, Badge } from "@/components/ui";
import { ScreenRecorder } from "@/components/ScreenRecorder";
import { recordingUrl, useRecordingMutations, useRecordings } from "@/data/hooks";
import type { Recording } from "@/types/db";

/**
 * The recording library.
 *
 * Its own page rather than a strip inside SOPs, which is where it started and
 * where nobody found it. A recording is not a sub-feature of a checklist: it is
 * how a process gets out of somebody's head in the first place, and the SOP is
 * what it becomes afterwards.
 */
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const daysLeft = (iso: string) => Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 864e5));

export default function Videos() {
  const { data: recordings = [], isLoading } = useRecordings();
  const { save, remove } = useRecordingMutations();
  const [recording, setRecording] = useState(false);
  const [playing, setPlaying] = useState<{ title: string; url: string } | null>(null);

  const play = async (r: Recording) => {
    const url = await recordingUrl(r);
    if (url) setPlaying({ title: r.title, url });
  };

  return (
    <div>
      <PageHeader
        title="Videos"
        subtitle="Record how you do something once. The SOP written from it is what outlasts the video."
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
            deleted after 30 days — long enough to write the SOP, short enough not to become an
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
