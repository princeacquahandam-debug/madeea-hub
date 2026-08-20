import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  perceptualHash, renderFrame, toJpegBlob, nextCaptureDelayMs,
} from "@/lib/imaging";

/**
 * The capture agent, as far as a browser can be one.
 *
 * ── READ THIS BEFORE TRUSTING ANY NUMBER THIS PRODUCES ────────────────────
 * A web page is not a monitoring agent and cannot be made into one. Two limits
 * are absolute, and both change what the data MEANS rather than merely how much
 * of it there is:
 *
 * 1. INPUT COUNTS COVER THIS TAB ONLY. The browser receives keyboard and mouse
 *    events for its own document and nothing else. An EA writing in Outlook, in
 *    Excel, or in a different browser tab generates exactly zero here. So a low
 *    activity score is evidence of "not typing in this tab", never of "not
 *    working", and treating it as the second would be a performance conversation
 *    built on a measurement error. Every row is stamped source='browser' so the
 *    distinction survives into the database and onto the screen.
 *
 * 2. CAPTURE IS DISCLOSED, NOT SILENT. getDisplayMedia needs a gesture and a
 *    permission prompt, shows a persistent indicator, captures ONE surface the
 *    user chooses, and can be stopped at any moment from browser chrome this
 *    code cannot reach. Multiple monitors are not available. Automatic start is
 *    not available.
 *
 * A desktop agent fixes both, and this file is written so that it can: the
 * agent posts the same activity_records and time_screenshots rows with
 * source='agent', and nothing downstream, no detector, no dashboard, no query,
 * has to change. That is the boundary the architecture is drawn around.
 *
 * ── WHAT IS DELIBERATELY NOT COLLECTED ────────────────────────────────────
 * Keydown handlers increment a counter and read nothing else. `event.key` is
 * never touched, so there is no code path in which a key could be recorded even
 * by accident. Mouse handlers likewise count events and ignore coordinates.
 * This is the spec's "no keylogging" rule expressed as an absence rather than a
 * promise.
 */

export type CaptureState =
  | "off" | "requesting" | "capturing" | "denied" | "stopped" | "unsupported";

export interface MonitoringSettings {
  screenshotMinutes: number;
  screenshotsEnabled: boolean;
  blurScreenshots: boolean;
  randomizeCapture: boolean;
}

export interface MonitoringStatus {
  state: CaptureState;
  /** What the user shared. A single tab is far weaker evidence than a monitor. */
  surface: string | null;
  shots: number;
  lastCaptureAt: Date | null;
  /** Live counters for the period in progress, so the EA can see what is recorded. */
  keystrokes: number;
  mouseEvents: number;
  idleSeconds: number;
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
}

/** No input for this long and the seconds start counting as idle. */
const IDLE_AFTER_SECONDS = 60;

export function useMonitoring(opts: {
  timeEntryId: string | null;
  settings: MonitoringSettings;
}): MonitoringStatus {
  const { timeEntryId, settings } = opts;
  const running = Boolean(timeEntryId);

  const [state, setState] = useState<CaptureState>("off");
  const [surface, setSurface] = useState<string | null>(null);
  const [shots, setShots] = useState(0);
  const [lastCaptureAt, setLastCaptureAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [counts, setCounts] = useState({ keystrokes: 0, mouseEvents: 0, idleSeconds: 0 });

  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const entryRef = useRef<string | null>(timeEntryId);
  entryRef.current = timeEntryId;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  /* Counters live in a ref, not state. They tick on every keypress and every
     mouse move, and re-rendering the whole tracker on mouse movement would make
     the app stutter while claiming to measure whether the user is working. The
     visible numbers are copied out on a slow interval instead. */
  const tally = useRef({ keystrokes: 0, mouseEvents: 0, lastInputAt: Date.now(), idleSeconds: 0 });
  const periodStart = useRef<Date>(new Date());

  // ── input counting ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!running) return;

    /* Counts only. `e.key` is never read: there is deliberately no expression
       in this file that could put a typed character anywhere. */
    const onKey = () => { tally.current.keystrokes++; tally.current.lastInputAt = Date.now(); };
    const onMouse = () => { tally.current.mouseEvents++; tally.current.lastInputAt = Date.now(); };

    window.addEventListener("keydown", onKey, { passive: true });
    // `mousemove` fires hundreds of times a second; throttled to once every
    // 250ms so the count measures movement rather than pointer resolution.
    let lastMove = 0;
    const onMove = (e: MouseEvent) => {
      void e;
      const now = Date.now();
      if (now - lastMove < 250) return;
      lastMove = now;
      onMouse();
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("mousedown", onMouse, { passive: true });
    window.addEventListener("wheel", onMove, { passive: true });

    const idleTick = window.setInterval(() => {
      const since = (Date.now() - tally.current.lastInputAt) / 1000;
      if (since >= IDLE_AFTER_SECONDS) tally.current.idleSeconds += 1;
      setCounts({
        keystrokes: tally.current.keystrokes,
        mouseEvents: tally.current.mouseEvents,
        idleSeconds: tally.current.idleSeconds,
      });
    }, 1000);

    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mousedown", onMouse);
      window.removeEventListener("wheel", onMove);
      window.clearInterval(idleTick);
    };
  }, [running]);

  const teardown = useCallback(() => {
    if (timerRef.current !== null) { window.clearTimeout(timerRef.current); timerRef.current = null; }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) { videoRef.current.srcObject = null; videoRef.current = null; }
  }, []);

  /**
   * One capture: frame, blur if required, hash, upload, then two rows.
   *
   * The activity record is written FIRST and the screenshot points at it. That
   * order matters: a screenshot with no activity beside it is an image with no
   * context, and a reviewer looking at it has nothing to judge except how the
   * screen looked.
   */
  const captureOnce = useCallback(async () => {
    const video = videoRef.current;
    const stream = streamRef.current;
    const entryId = entryRef.current;
    if (!video || !stream || !entryId || !supabase) return;

    if (!stream.getVideoTracks().some((t) => t.readyState === "live")) {
      teardown();
      setState("stopped");
      return;
    }
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return;

    const cfg = settingsRef.current;
    const now = new Date();

    // Close the activity period this screenshot belongs to, then start a new one.
    const period = {
      period_start: periodStart.current.toISOString(),
      period_end: now.toISOString(),
      keystrokes: tally.current.keystrokes,
      mouse_events: tally.current.mouseEvents,
      idle_seconds: tally.current.idleSeconds,
      source: "browser" as const,
    };
    periodStart.current = now;
    tally.current = { keystrokes: 0, mouseEvents: 0, lastInputAt: Date.now(), idleSeconds: 0 };

    const { data: activity, error: actErr } = await supabase
      .from("activity_records")
      .insert({ time_entry_id: entryId, ...period })
      .select("id")
      .single();
    if (actErr) { setError(`Could not record activity: ${actErr.message}`); return; }

    /* Blur is decided here and applied here. There is no second copy: the
       canvas holds blurred pixels and the blurred pixels are what get encoded,
       so no readable frame exists after this line. */
    const canvas = renderFrame(video, vw, vh, { blur: cfg.blurScreenshots, maxWidth: 1280 });
    const hash = await perceptualHash(canvas);
    const blob = await toJpegBlob(canvas, 0.6);
    if (!blob) { setError("Could not encode the screenshot."); return; }

    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id;
    if (!uid) return;

    const path = `${uid}/${now.toISOString().slice(0, 10)}/${now.getTime()}.jpg`;
    const { error: upErr } = await supabase.storage
      .from("time-screenshots")
      .upload(path, blob, { contentType: "image/jpeg", upsert: false });
    if (upErr) { setError(`Upload failed: ${upErr.message}`); return; }

    const { error: rowErr } = await supabase.from("time_screenshots").insert({
      time_entry_id: entryId,
      activity_record_id: activity.id,
      storage_path: path,
      surface: surface ?? "unknown",
      width: canvas.width,
      height: canvas.height,
      blurred: cfg.blurScreenshots,
      phash: hash,
      captured_at: now.toISOString(),
    });
    // The image is already in storage, so a failed row is a real inconsistency
    // and is surfaced rather than swallowed.
    if (rowErr) { setError(`Stored the image but not its record: ${rowErr.message}`); return; }

    setShots((n) => n + 1);
    setLastCaptureAt(now);
    setError(null);
  }, [surface, teardown]);

  /* Re-armed after each capture rather than run on setInterval, because the
     delay is different every time. A fixed interval cannot be randomised. */
  const arm = useCallback(() => {
    const cfg = settingsRef.current;
    const delay = nextCaptureDelayMs(cfg.screenshotMinutes, cfg.randomizeCapture);
    timerRef.current = window.setTimeout(async () => {
      await captureOnce();
      if (streamRef.current) arm();
    }, delay);
  }, [captureOnce]);

  const start = useCallback(async () => {
    setError(null);
    if (!navigator.mediaDevices?.getDisplayMedia) { setState("unsupported"); return; }
    setState("requesting");
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 1 },
        audio: false,
      });
      streamRef.current = stream;

      const track = stream.getVideoTracks()[0];
      const s = track?.getSettings() as { displaySurface?: string } | undefined;
      setSurface(s?.displaySurface ?? "unknown");
      // Stopping from the browser's own banner fires this, and it is the only
      // notice this code gets.
      track?.addEventListener("ended", () => { teardown(); setState("stopped"); });

      const video = document.createElement("video");
      video.srcObject = stream;
      video.muted = true;
      await video.play();
      videoRef.current = video;

      periodStart.current = new Date();
      tally.current = { keystrokes: 0, mouseEvents: 0, lastInputAt: Date.now(), idleSeconds: 0 };
      setState("capturing");

      /* One immediately, then randomised. Without the first, a shift always has
         an unmonitored window at the front equal to the whole interval, which is
         the easiest gap in the schedule to plan around. */
      void captureOnce();
      arm();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setState(/denied|not allowed|permission/i.test(msg) ? "denied" : "off");
      setError(msg);
    }
  }, [arm, captureOnce, teardown]);

  const stop = useCallback(() => { teardown(); setState("off"); }, [teardown]);

  // Capture belongs to a running session and cannot outlive it.
  useEffect(() => {
    if (!running && streamRef.current) { teardown(); setState("off"); }
  }, [running, teardown]);

  useEffect(() => () => teardown(), [teardown]);

  return {
    state, surface, shots, lastCaptureAt, error,
    keystrokes: counts.keystrokes,
    mouseEvents: counts.mouseEvents,
    idleSeconds: counts.idleSeconds,
    start, stop,
  };
}
