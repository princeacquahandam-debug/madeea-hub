import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

/**
 * Periodic screen capture while the clock is running.
 *
 * ── READ THIS BEFORE TRUSTING THE EVIDENCE ────────────────────────────────
 * A web page cannot silently screenshot a desktop, and it never will be able
 * to. Browsers require an explicit user gesture and a permission dialog for
 * getDisplayMedia, they show a persistent "sharing your screen" indicator, and
 * the user can stop sharing at any moment from browser chrome this code cannot
 * reach. That is a deliberate security boundary, not a gap to engineer around.
 *
 * What that means for Reichelle's requirement, precisely:
 *
 *   WORKS       Disclosed monitoring. The EA grants once per session and frames
 *               are captured on an interval without further prompting.
 *   WORKS       Recording WHAT was shared. An EA can choose a single browser tab
 *               instead of the whole desktop, which would make the evidence
 *               worthless if nobody noticed, so the surface type is stored on
 *               every frame and shown in review.
 *   DOES NOT    Covert capture. The EA always knows.
 *   DOES NOT    Tamper resistance. Stopping the share, or closing the tab, stops
 *               capture. This code reports that it stopped; it cannot prevent it.
 *
 * Tamper-proof capture needs a native agent (Electron/Tauri) or an existing
 * product like Hubstaff or Time Doctor. The database side built in 0041 is
 * agent-agnostic on purpose: a desktop agent posts to the same table, so
 * swapping this browser implementation for one changes nothing downstream.
 *
 * Frames are downscaled and JPEG-encoded before upload. A full-resolution PNG
 * every ten minutes is roughly a megabyte per shot, which is 48MB per EA per
 * day and buys nothing: this is evidence that someone was at their desk, not a
 * document you read.
 */

export type CaptureState = "off" | "requesting" | "capturing" | "denied" | "stopped" | "unsupported";

const MAX_WIDTH = 1280;
const JPEG_QUALITY = 0.6;

export interface ScreenCapture {
  state: CaptureState;
  /** What the EA chose to share. A single tab is much weaker evidence than a monitor. */
  surface: string | null;
  shots: number;
  lastAt: Date | null;
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
}

export function useScreenCapture(opts: {
  enabled: boolean;
  intervalMinutes: number;
  timeEntryId: string | null;
}): ScreenCapture {
  const { enabled, intervalMinutes, timeEntryId } = opts;

  const [state, setState] = useState<CaptureState>("off");
  const [surface, setSurface] = useState<string | null>(null);
  const [shots, setShots] = useState(0);
  const [lastAt, setLastAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const timerRef = useRef<number | null>(null);
  // Read inside the interval callback, which would otherwise close over a stale
  // id from the render that started capture.
  const entryRef = useRef<string | null>(timeEntryId);
  entryRef.current = timeEntryId;

  const teardown = useCallback(() => {
    if (timerRef.current !== null) { clearInterval(timerRef.current); timerRef.current = null; }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) { videoRef.current.srcObject = null; videoRef.current = null; }
  }, []);

  const captureOnce = useCallback(async () => {
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream || !supabase) return;
    // A track that ended means the EA pressed the browser's own Stop sharing.
    if (!stream.getVideoTracks().some((t) => t.readyState === "live")) {
      teardown();
      setState("stopped");
      return;
    }

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return; // first frame not decoded yet

    const scale = Math.min(1, MAX_WIDTH / vw);
    const w = Math.round(vw * scale);
    const h = Math.round(vh * scale);

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);

    const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, "image/jpeg", JPEG_QUALITY));
    if (!blob) return;

    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id;
    if (!uid) return;

    const now = new Date();
    const path = `${uid}/${now.toISOString().slice(0, 10)}/${now.getTime()}.jpg`;

    const { error: upErr } = await supabase.storage
      .from("time-screenshots")
      .upload(path, blob, { contentType: "image/jpeg", upsert: false });
    if (upErr) { setError(`Upload failed: ${upErr.message}`); return; }

    const { error: rowErr } = await supabase.from("time_screenshots").insert({
      time_entry_id: entryRef.current,
      storage_path: path,
      surface: surface ?? "unknown",
      width: w,
      height: h,
      captured_at: now.toISOString(),
    });
    // The image is already stored, so a failed row is a real inconsistency and
    // is surfaced rather than swallowed.
    if (rowErr) { setError(`Recorded the image but not the entry: ${rowErr.message}`); return; }

    setShots((n) => n + 1);
    setLastAt(now);
    setError(null);
  }, [surface, teardown]);

  const start = useCallback(async () => {
    setError(null);
    if (!navigator.mediaDevices?.getDisplayMedia) { setState("unsupported"); return; }
    setState("requesting");
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 1 },
        audio: false,
        // A hint, not a guarantee: the EA still picks, which is exactly why the
        // choice is recorded per frame.
        ...({ preferCurrentTab: false } as Record<string, unknown>),
      });
      streamRef.current = stream;

      const track = stream.getVideoTracks()[0];
      const settings = track?.getSettings() as { displaySurface?: string } | undefined;
      setSurface(settings?.displaySurface ?? "unknown");

      // Stopping from the browser's own banner fires this, and it is the only
      // notice we get.
      track?.addEventListener("ended", () => { teardown(); setState("stopped"); });

      const video = document.createElement("video");
      video.srcObject = stream;
      video.muted = true;
      await video.play();
      videoRef.current = video;

      setState("capturing");
      // One immediately, so the record starts at clock-in rather than one
      // interval later. A ten minute hole at the start of every shift is the
      // easiest window to abuse.
      void captureOnce();
      timerRef.current = window.setInterval(() => void captureOnce(), Math.max(1, intervalMinutes) * 60_000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setState(/denied|not allowed|permission/i.test(msg) ? "denied" : "off");
      setError(msg);
    }
  }, [captureOnce, intervalMinutes, teardown]);

  const stop = useCallback(() => { teardown(); setState("off"); }, [teardown]);

  // Capture belongs to a running session. When the clock stops, so does this.
  useEffect(() => {
    if (!enabled && streamRef.current) { teardown(); setState("off"); }
  }, [enabled, teardown]);

  useEffect(() => () => teardown(), [teardown]);

  return { state, surface, shots, lastAt, error, start, stop };
}
