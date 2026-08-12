import { useCallback, useEffect, useRef, useState } from "react";
import { Video, Square, Loader2, Trash2, Mic, MicOff } from "lucide-react";
import { Modal } from "@/components/ui";

/**
 * Record a browser tab, optionally with your voice, and hand back the result.
 *
 * §4.6 / R-4.6.1. The constraints are the 09 Aug direction's, not invented
 * here: browser tab only, mic optional, ten minute cap.
 *
 * Tab-only is a privacy decision as much as a scope one. getDisplayMedia can
 * offer whole-screen and window capture, and an EA recording "how I do the
 * Monday report" should not be one misclick away from filming their desktop,
 * their personal email or another client's data. preferCurrentTab plus
 * monitorTypeSurfaces:"exclude" asks the browser to keep the picker to tabs;
 * where a browser ignores the hint we check what was actually shared and
 * refuse anything else, because a hint is not a guarantee.
 *
 * Everything here is local. Nothing uploads until the person has watched it
 * back and chosen to keep it.
 */

const MAX_SECONDS = 600;

export interface RecordingResult {
  blob: Blob;
  durationSeconds: number;
  hasAudio: boolean;
  url: string;
}

type Phase = "idle" | "recording" | "review";

export function ScreenRecorder({
  open,
  onClose,
  onSave,
  saving,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (r: RecordingResult) => void;
  saving?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [withMic, setWithMic] = useState(true);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RecordingResult | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamsRef = useRef<MediaStream[]>([]);
  const tickRef = useRef<number | null>(null);
  /** Elapsed seconds. A ref as well as state because the interval closure reads
   *  it on every tick, where the state value would be stale. */
  const secondsRef = useRef(0);

  const supported =
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getDisplayMedia === "function" &&
    typeof window.MediaRecorder !== "undefined";

  /** Stop every track we opened. Without this the browser keeps showing the
   *  "sharing this tab" bar long after the modal has gone. */
  const releaseStreams = useCallback(() => {
    for (const s of streamsRef.current) for (const t of s.getTracks()) t.stop();
    streamsRef.current = [];
    if (tickRef.current !== null) { window.clearInterval(tickRef.current); tickRef.current = null; }
  }, []);

  const stop = useCallback(() => {
    recorderRef.current?.state === "recording" && recorderRef.current.stop();
  }, []);

  const startRecording = useCallback(async () => {
    setError(null);
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 15 },
        audio: false,
        // Non-standard but widely honoured; typed loosely because the DOM lib
        // does not know them.
        ...({ preferCurrentTab: true, monitorTypeSurfaces: "exclude" } as object),
      });
      streamsRef.current.push(display);

      const surface = (display.getVideoTracks()[0]?.getSettings() as { displaySurface?: string })?.displaySurface;
      if (surface && surface !== "browser") {
        releaseStreams();
        setError("Please share a browser tab rather than a window or your whole screen — a recording of your desktop can expose other clients' information.");
        return;
      }

      const tracks = [...display.getVideoTracks()];
      let hasAudio = false;
      if (withMic) {
        try {
          const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
          streamsRef.current.push(mic);
          tracks.push(...mic.getAudioTracks());
          hasAudio = true;
        } catch {
          // Refusing the mic is not a failure — narration is optional, and
          // losing the whole recording over it would be absurd.
          hasAudio = false;
        }
      }

      const mixed = new MediaStream(tracks);
      const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
        ? "video/webm;codecs=vp9,opus"
        : "video/webm";
      const rec = new MediaRecorder(mixed, { mimeType: mime });
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "video/webm" });
        releaseStreams();
        setResult({ blob, durationSeconds: secondsRef.current, hasAudio, url: URL.createObjectURL(blob) });
        setPhase("review");
      };

      // Ending the share from the browser's own "Stop sharing" bar must end the
      // recording too, or it silently keeps writing a frozen frame.
      display.getVideoTracks()[0]?.addEventListener("ended", () => stop());

      rec.start(1000);
      recorderRef.current = rec;
      setSeconds(0); secondsRef.current = 0;
      setPhase("recording");
      tickRef.current = window.setInterval(() => {
        secondsRef.current += 1;
        setSeconds(secondsRef.current);
        if (secondsRef.current >= MAX_SECONDS) stop();
      }, 1000);
    } catch (e) {
      releaseStreams();
      // Cancelling the picker throws too, and that is not an error worth showing.
      const msg = e instanceof Error ? e.message : String(e);
      if (!/permission denied|dismissed|abort/i.test(msg)) setError(msg);
    }
  }, [withMic, releaseStreams, stop]);

  const discard = useCallback(() => {
    if (result) URL.revokeObjectURL(result.url);
    setResult(null); setPhase("idle"); setSeconds(0); secondsRef.current = 0;
  }, [result]);

  // Never leave a tab being captured because someone closed the dialog.
  useEffect(() => () => releaseStreams(), [releaseStreams]);
  useEffect(() => { if (!open) { releaseStreams(); } }, [open, releaseStreams]);

  const mmss = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  const remaining = MAX_SECONDS - seconds;

  return (
    <Modal open={open} onClose={() => { if (phase !== "recording") { discard(); onClose(); } }}>
      <h2 className="mb-1 text-lg font-semibold">Record how you do it</h2>
      <p className="mb-4 text-sm text-muted">
        Records this browser tab. Talk through what you are doing and it becomes an SOP —
        the written steps are what the next person follows.
      </p>

      {!supported && (
        <div className="card border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          This browser cannot record a tab. Chrome, Edge or Safari on desktop can.
        </div>
      )}

      {error && <div className="card mb-3 border-red-500/40 bg-red-500/5 p-3 text-sm text-red-300">{error}</div>}

      {phase === "idle" && supported && (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setWithMic((v) => !v)}
            className="flex w-full items-center gap-2 rounded-lg bg-surface-2 px-3 py-2.5 text-left text-sm"
          >
            {withMic ? <Mic size={15} className="text-accent" /> : <MicOff size={15} className="text-faint" />}
            <span className="flex-1">{withMic ? "Narrate with your microphone" : "No narration"}</span>
            <span className="text-xs text-faint">{withMic ? "on" : "off"}</span>
          </button>
          <p className="text-xs text-faint">
            Ten minutes maximum. The recording is private to you and is deleted after 30 days —
            the SOP you write from it is what lasts.
          </p>
          <button className="btn-primary w-full" onClick={() => void startRecording()}>
            <Video size={15} /> Choose a tab and start
          </button>
        </div>
      )}

      {phase === "recording" && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 rounded-lg bg-surface-2 p-4">
            <span className="h-3 w-3 shrink-0 animate-pulse rounded-full bg-red-500" />
            <span className="text-2xl font-bold tabular-nums">{mmss}</span>
            <span className="ml-auto text-xs text-faint">
              {remaining <= 60 ? `${remaining}s left` : `${Math.floor(remaining / 60)} min left`}
            </span>
          </div>
          <button className="btn-primary w-full" onClick={stop}>
            <Square size={15} /> Stop recording
          </button>
        </div>
      )}

      {phase === "review" && result && (
        <div className="space-y-3">
          {/* Watch it back before anything is uploaded. */}
          <video src={result.url} controls className="w-full rounded-lg bg-black" />
          <p className="text-xs text-faint">
            {mmss} · {result.hasAudio ? "with narration" : "no audio"}
          </p>
          <div className="flex gap-2">
            <button className="btn-ghost flex-1" onClick={discard} disabled={saving}>
              <Trash2 size={15} /> Discard
            </button>
            <button className="btn-primary flex-1" onClick={() => onSave(result)} disabled={saving}>
              {saving ? <><Loader2 size={15} className="animate-spin" /> Saving…</> : <>Keep and write the SOP</>}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
