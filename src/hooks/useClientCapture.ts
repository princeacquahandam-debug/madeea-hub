import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

/**
 * Periodic screen capture for a client's own team member, while they are on the
 * clock.
 *
 * WHY NOT useMonitoring. That hook is the agency one: it writes activity_records
 * and time_screenshots, both gated on `workspace_id = my_workspace()`, and a
 * client account's workspace is NULL by construction. It would fail on every
 * insert. This writes the 0078 tables instead, which are scoped by client_id.
 *
 * WHAT THE BROWSER WILL AND WILL NOT GIVE US. getDisplayMedia cannot be started
 * without a user gesture and cannot be silently restarted, so consent is a real
 * click and stopping the share really does stop the capture -- there is no way
 * to take that back from the page. That is a property worth keeping rather than
 * working around: a monitoring tool the monitored person cannot switch off is a
 * different product, and a legally distinct one in several of the places these
 * people work.
 *
 * `surface` records what they actually shared -- a whole monitor, one window, or
 * one tab. A capture of a single tab is not proof of a working day, and the
 * difference has to be visible to whoever reads it later rather than implied by
 * a thumbnail.
 */

const INTERVAL_MS = 10 * 60_000;   // ten minutes
const MAX_EDGE = 1280;             // cap the long side; this is evidence, not a photo

export interface CaptureState {
  sharing: boolean;
  error: string;
  lastAt: Date | null;
  count: number;
  surface: string | null;
}

export function useClientCapture(entryId: string | null, clientId: string | null) {
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const [state, setState] = useState<CaptureState>({
    sharing: false, error: "", lastAt: null, count: 0, surface: null,
  });

  const stop = useCallback(() => {
    if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setState((s) => ({ ...s, sharing: false, surface: null }));
  }, []);

  const grab = useCallback(async () => {
    const stream = streamRef.current;
    if (!stream || !entryId || !clientId || !supabase) return;

    const track = stream.getVideoTracks()[0];
    if (!track || track.readyState !== "live") { stop(); return; }

    try {
      /* ImageCapture is not in every browser, so go through a video element and
         a canvas, which is. */
      const video = document.createElement("video");
      video.srcObject = new MediaStream([track]);
      video.muted = true;
      await video.play();
      await new Promise((r) => setTimeout(r, 180)); // let a frame actually arrive

      const scale = Math.min(1, MAX_EDGE / Math.max(video.videoWidth, video.videoHeight || 1));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
      video.pause();
      (video.srcObject as MediaStream | null) = null;

      const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.7));
      if (!blob) return;

      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) return;

      const now = new Date();
      /* The uploader's own id is the first path segment, because the storage
         policy in 0078 checks exactly that. Change the shape here and uploads
         start failing with a permissions error that says nothing about paths. */
      const path = `${uid}/${now.toISOString().slice(0, 10)}/${now.getTime()}.jpg`;

      const { error: upErr } = await supabase.storage
        .from("client-screenshots")
        .upload(path, blob, { contentType: "image/jpeg", upsert: false });
      if (upErr) { setState((s) => ({ ...s, error: `Upload failed: ${upErr.message}` })); return; }

      const surface = (track.getSettings() as { displaySurface?: string }).displaySurface ?? "unknown";
      const { error: rowErr } = await supabase.from("client_time_screenshots").insert({
        client_id: clientId,
        entry_id: entryId,
        storage_path: path,
        surface: ["monitor", "window", "browser"].includes(surface) ? surface : "unknown",
        width: canvas.width,
        height: canvas.height,
        captured_at: now.toISOString(),
      });
      /* The image is already in storage, so a failed row is a real
         inconsistency rather than a retryable hiccup, and is surfaced. */
      if (rowErr) { setState((s) => ({ ...s, error: `Stored the image but not its record: ${rowErr.message}` })); return; }

      setState((s) => ({ ...s, error: "", lastAt: now, count: s.count + 1, surface }));
    } catch (e) {
      setState((s) => ({ ...s, error: e instanceof Error ? e.message : "Capture failed." }));
    }
  }, [entryId, clientId, stop]);

  const start = useCallback(async () => {
    setState((s) => ({ ...s, error: "" }));
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 1 },
        audio: false,
      });
      streamRef.current = stream;
      // They can stop the share from the browser's own bar, and that must end
      // the capture rather than leave a timer firing into a dead track.
      stream.getVideoTracks()[0]?.addEventListener("ended", stop);
      setState((s) => ({ ...s, sharing: true }));
      await grab();
      timerRef.current = window.setInterval(() => void grab(), INTERVAL_MS);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not start sharing.";
      setState((s) => ({
        ...s,
        error: /denied|dismiss|abort/i.test(msg) ? "Screen sharing was not allowed." : msg,
      }));
    }
  }, [grab, stop]);

  // Clocking out ends the shift, so it ends the capture with it.
  useEffect(() => { if (!entryId) stop(); }, [entryId, stop]);
  useEffect(() => stop, [stop]);

  return { ...state, start, stop, intervalMinutes: INTERVAL_MS / 60_000 };
}
