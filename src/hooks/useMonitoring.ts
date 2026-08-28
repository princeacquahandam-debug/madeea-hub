import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  perceptualHash, renderFrame, toJpegBlob, nextCaptureDelayMs, hammingDistance,
  shouldCapture, stalledMinutes as overdueMinutes,
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
 *    code cannot reach. Automatic start is not available, and a second monitor
 *    is not available in the same share.
 *
 *    BUT the surface is now ENFORCED. The picker offers Entire Screen, a window
 *    or a tab, and nothing used to check which was chosen: pick a tab and the
 *    whole system quietly monitored one tab while looking like it monitored a
 *    computer. A share that is not a monitor is now refused, with the reason,
 *    and the user is asked again.
 *
 * 3. SCREEN CHANGE IS THE SIGNAL THAT IS NOT TAB-SCOPED. Every capture is
 *    perceptually hashed anyway, and the distance between consecutive hashes
 *    measures how much the screen changed in between. With a monitor shared
 *    that is the whole display, including every application the browser cannot
 *    see. It does not replace the input counts, because a playing video changes
 *    the screen with nobody present; it sits beside them, and both are shown.
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
  /** Set when the user shared something narrower than a monitor. */
  surfaceRefused: boolean;
  /** Latest screen-change reading, 0-100. Null until a second capture exists. */
  screenChange: number | null;
  /**
   * Why capture is not running, in words. Empty while it is.
   *
   * Capture stopping silently is how a shift ends up with two screenshots and
   * nobody noticing until someone reviews it a week later. Every path that
   * stops it now records a reason, and the screen shows it.
   */
  stoppedReason: string | null;
  /**
   * How many minutes since a screenshot last landed, once that is long enough
   * to be a fault rather than a wait. Null while the rhythm is healthy.
   *
   * Capture that is RUNNING and producing nothing is the failure this whole
   * file is about, and it is the one the UI could not previously show: every
   * failure path reports and returns, so the schedule keeps ticking and the
   * person keeps working while nothing is recorded.
   */
  stalledMinutes: number | null;
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

/**
 * How often the heartbeat asks whether a screenshot is due.
 *
 * Not how often screenshots are taken: that is screenshotMinutes, ten by
 * default. Fifteen seconds is far below any capture interval, so the schedule
 * is accurate to a few seconds, and it is cheap: a comparison of two numbers.
 */
const HEARTBEAT_MS = 15_000;

/**
 * How long one capture may take before the schedule stops waiting for it.
 *
 * THIS IS THE BUG THAT COST A SHIFT ITS SCREENSHOTS. `capturingRef` is raised
 * before a capture and lowered in a .finally(), so that two captures cannot
 * overlap and double-count a period. But .finally() runs when a promise
 * SETTLES, and the upload inside captureOnce is a fetch with no timeout on it:
 * storage-js takes no AbortSignal, so a request that neither resolves nor
 * rejects — a laptop that changed Wi-Fi mid-upload, a connection held open by a
 * captive portal — leaves that flag raised forever.
 *
 * shouldCapture() then answers "no, one is already running" on every beat for
 * the rest of the day. Capture does not stop, error, or say anything: the state
 * is still "capturing", the stream is still live, and the screenshot count
 * simply never moves again. Eight hours produced five.
 *
 * Ninety seconds is far longer than a 1280px JPEG needs on any connection worth
 * working on, and far shorter than the ten minute interval, so a timeout can
 * never eat the next capture's slot.
 */
const CAPTURE_TIMEOUT_MS = 90_000;

/**
 * The same promise, guaranteed to settle.
 *
 * Rejecting does not cancel the upload underneath — nothing can, the storage
 * client takes no signal — it releases the SCHEDULE from waiting on it. A
 * request still in flight that later succeeds is a duplicate screenshot at
 * worst; one that hangs forever used to be every remaining screenshot of the
 * shift.
 */
function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error(`${label} did not finish within ${Math.round(ms / 1000)}s and was abandoned. The next one is still scheduled.`)),
      ms,
    );
    work.then(resolve, reject).finally(() => window.clearTimeout(timer));
  });
}

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
  /* Minutes since the last screenshot actually landed, once that is long enough to
     be a fault rather than a wait. Null while the rhythm is healthy. */
  const [stalledMinutes, setStalled] = useState<number | null>(null);
  const [surfaceRefused, setSurfaceRefused] = useState(false);
  const [screenChange, setScreenChange] = useState<number | null>(null);
  const [stoppedReason, setStoppedReason] = useState<string | null>(null);
  const [counts, setCounts] = useState({ keystrokes: 0, mouseEvents: 0, idleSeconds: 0 });

  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
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
  /* The previous capture's hash, so screen change can be measured. Kept in a
     ref rather than read back from the database: a network round trip per
     capture to fetch a 16-character string we just computed would be absurd. */
  const lastHash = useRef<string | null>(null);
  /* A ref as well as state. The first capture fires immediately after the share
     is granted, in the same tick as setSurface, so the closure inside
     captureOnce still held the OLD value and wrote capture_surface='unknown'
     onto a share that was verified to be a monitor. The state drives the UI;
     the ref is what the capture reads. */
  const surfaceRef = useRef<string | null>(null);

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
    /* No timer to clear any more: the heartbeat is an effect, and it stops
       when the state leaves "capturing". Its guard checks streamRef, which
       this nulls, so a beat landing mid-teardown does nothing. */
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
  /* `closePeriod` is false for the very first capture of a session.
     That capture happens the instant sharing starts, so the period it would
     close is zero seconds long: activity_percent divides by its duration, and a
     zero-second row is not a small measurement, it is a meaningless one that
     would sit in the timeline looking like evidence. The screenshot is still
     taken, because the point of capturing immediately is to close the
     unmonitored window at the start of a shift. */
  const captureOnce = useCallback(async (closePeriod = true) => {
    const video = videoRef.current;
    const stream = streamRef.current;
    const entryId = entryRef.current;
    if (!video || !stream || !entryId || !supabase) return;

    if (!stream.getVideoTracks().some((t) => t.readyState === "live")) {
      teardown();
      setState("stopped");
      setStoppedReason("You stopped sharing from your browser's sharing bar.");
      return;
    }
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return;

    const cfg = settingsRef.current;
    const now = new Date();

    let activityId: string | null = null;

    /* Blur is decided here and applied here. There is no second copy. */
    const canvas = renderFrame(video, vw, vh, { blur: cfg.blurScreenshots, maxWidth: 1280 });
    const hash = await perceptualHash(canvas);

    /* THE SIGNAL THAT IS NOT TAB-SCOPED.
       Distance between this hash and the last, as a percentage of the 64 bits.
       With a monitor shared this covers the whole display, so it sees Outlook,
       Excel and everything else the browser is blind to. Null on the first
       capture, because there is nothing to compare against and 0 would read as
       "the screen did not change" rather than "not measured yet". */
    const change = lastHash.current === null
      ? null
      : Math.round((hammingDistance(lastHash.current, hash) / 64) * 100);
    lastHash.current = hash;
    setScreenChange(change);

    if (closePeriod) {
      // Close the period this screenshot belongs to, then start the next one.
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
        .insert({
          time_entry_id: entryId,
          ...period,
          screen_change_percent: change,
          capture_surface: surfaceRef.current ?? "unknown",
        })
        .select("id")
        .single();
      /* NOT a return. This used to abandon the whole capture, which meant one
         rejected activity row — a constraint, a policy, a dropped connection —
         cost the screenshot as well, every ten minutes, for the rest of the
         shift. The screenshot is the part somebody is relying on, and it does
         not need its activity row to be worth keeping: the column is nullable
         precisely so an image can exist without one.

         The failure is still reported, and the image is still stored. Losing
         the keystroke counts for one period is a smaller loss than losing the
         evidence that the period happened at all. */
      if (actErr) {
        console.error("activity record failed", actErr.message);
        setError(`Could not record activity for this period: ${actErr.message}`);
      } else {
        activityId = activity?.id ?? null;
      }
    }

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
      activity_record_id: activityId,
      storage_path: path,
      surface: surfaceRef.current ?? "unknown",
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
    lastOkRef.current = Date.now();
    setStalled(null);
    setError(null);
  }, [teardown]);

  /**
   * WHEN THE NEXT SCREENSHOT IS DUE, and why this is a deadline rather than a
   * timer that re-arms itself.
   *
   * The previous version chained setTimeout: capture, then schedule the next
   * one. Three things broke a ten-minute schedule, and all three failed
   * silently while the UI still said "capturing".
   *
   *   1. ONE FAILURE ENDED THE SHIFT. The callback was
   *      `await captureOnce(); if (streamRef.current) arm();`, so anything that
   *      threw inside a capture — an upload timing out, storage returning 500,
   *      getUser() rejecting on a dropped connection — skipped the re-arm. No
   *      screenshot was ever taken again, and nothing said so: the counter just
   *      stopped moving. A monitoring tool that quietly stops monitoring is
   *      worse than one that never started, because the gap looks like idleness
   *      in the record.
   *
   *   2. A SLEEPING LAPTOP LOST ITS PLACE. A timer set for ten minutes on a
   *      machine that suspends fires late by however long it slept, and the
   *      chain drifted further with every cycle.
   *
   *   3. BACKGROUND TABS ARE THROTTLED. Chrome slows timers in hidden tabs,
   *      which is exactly where this runs: nobody sits watching the tracker
   *      while they work.
   *
   * A due time and a short heartbeat survive all three. Waking up late does not
   * matter, because what is checked is the clock rather than the timer, and the
   * capture fires as soon as anybody looks.
   */
  const nextDueRef = useRef<number>(0);
  const capturingRef = useRef(false);
  /* When a screenshot last actually landed, as a number rather than the Date in
     state: the watchdog reads it on every beat and must not re-render anything
     to do so. */
  const lastOkRef = useRef<number>(0);

  const scheduleNext = useCallback(() => {
    const cfg = settingsRef.current;
    nextDueRef.current = Date.now() + nextCaptureDelayMs(cfg.screenshotMinutes, cfg.randomizeCapture);
  }, []);

  const start = useCallback(async () => {
    setError(null);
    /* screenshotsEnabled was declared in the settings type and read by nothing.
       An admin turning screenshots off got a switch that moved and changed
       nothing: capture kept running and kept uploading. A privacy control that
       does not control anything is worse than not offering one, because
       somebody relies on it. */
    if (!settingsRef.current.screenshotsEnabled) {
      setState("off");
      setError("Screenshots are switched off for this account, so there is nothing to capture.");
      return;
    }
    if (!navigator.mediaDevices?.getDisplayMedia) { setState("unsupported"); return; }
    setState("requesting");
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        // A hint only: Chrome pre-selects the Entire Screen tab of the picker,
        // but the user still chooses, which is why the result is checked below.
        video: { frameRate: 1, displaySurface: "monitor" },
        audio: false,
        ...({ monitorTypeSurfaces: "include", selfBrowserSurface: "exclude" } as Record<string, unknown>),
      } as DisplayMediaStreamOptions);
      streamRef.current = stream;

      const track = stream.getVideoTracks()[0];
      const s = track?.getSettings() as { displaySurface?: string } | undefined;
      const chosen = s?.displaySurface ?? "unknown";

      /* REFUSE ANYTHING NARROWER THAN A MONITOR.
         The picker offers Entire Screen, a window, or a tab, and nothing used to
         check which was chosen. Sharing a tab produced screenshots of one tab
         and a screen-change figure covering one tab, while the dashboard
         presented both as if they described a computer. Silently accepting the
         weakest option and labelling it the same as the strongest is how a
         monitoring system ends up reporting something untrue.
         The stream is stopped rather than kept, so no partial capture happens
         while the user decides. */
      if (chosen !== "monitor") {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        setSurfaceRefused(true);
        setState("off");
        setError(
          chosen === "browser"
            ? "You shared a browser tab. Screenshots would show only that tab, so this would monitor one page rather than your work. Choose Entire Screen instead."
            : "You shared a single window. Screenshots would show only that app. Choose Entire Screen instead.",
        );
        return;
      }
      setSurfaceRefused(false);
      setStoppedReason(null);
      surfaceRef.current = chosen;
      setSurface(chosen);
      // Stopping from the browser's own banner fires this, and it is the only
      // notice this code gets.
      track?.addEventListener("ended", () => {
        teardown();
        setState("stopped");
        setStoppedReason("You stopped sharing from your browser's sharing bar.");
      });

      const video = document.createElement("video");
      video.srcObject = stream;
      video.muted = true;
      await video.play();
      videoRef.current = video;

      periodStart.current = new Date();
      lastOkRef.current = Date.now();
      setStalled(null);
      lastHash.current = null;
      tally.current = { keystrokes: 0, mouseEvents: 0, lastInputAt: Date.now(), idleSeconds: 0 };
      setState("capturing");

      /* The deadline starts at the share, not at the first screenshot: if the
         opening capture fails, the ten minute rhythm still runs. The opening
         capture itself is fired by the effect below rather than from here. */
      scheduleNext();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setState(/denied|not allowed|permission/i.test(msg) ? "denied" : "off");
      setError(msg);
    }
  }, [captureOnce, scheduleNext, teardown]);

  /**
   * The opening screenshot, fired when there is both a share AND a session.
   *
   * Without one at the front, every shift starts with an unmonitored window the
   * full length of the interval, which is the easiest gap in a schedule to plan
   * around. This used to sit inside start(), which was right while capture could
   * only be authorised from the Time page, mid-shift, with the session already
   * open.
   *
   * Clocking in now asks for the share on the same click, because the browser
   * grants getDisplayMedia only during a real gesture: it is either that click
   * or a second one people forget to make. At that instant the session row does
   * not exist yet — entryRef is still null — and captureOnce would return
   * silently with nothing to attach a screenshot to, opening every shift with a
   * ten minute hole.
   *
   * So the opening capture waits for the id rather than for the click. Once per
   * share, both ways round: authorising mid-shift fires it immediately, because
   * the id is already there.
   */
  const openingRef = useRef(false);
  useEffect(() => {
    if (state !== "capturing") { openingRef.current = false; return; }
    if (openingRef.current || !timeEntryId) return;
    openingRef.current = true;
    void withTimeout(captureOnce(false), CAPTURE_TIMEOUT_MS, "The first screenshot").catch((e) => {
      console.error("first capture failed", e);
      setError(e instanceof Error ? e.message : String(e));
    });
  }, [state, timeEntryId, captureOnce]);

  /**
   * The heartbeat. Fires often, captures rarely.
   *
   * Every fifteen seconds it asks one question: is a screenshot due? That is
   * cheap enough to run all shift and frequent enough that a throttled or
   * suspended tab is at most a few seconds late rather than a whole interval.
   *
   * THE ORDER INSIDE IS LOAD-BEARING. The next deadline is set BEFORE the
   * capture is attempted, so a capture that throws still leaves a schedule
   * behind it. That single line is the difference between a shift that misses
   * one screenshot and a shift that misses every remaining one.
   */
  useEffect(() => {
    if (state !== "capturing") return;

    const tick = () => {
      const now = Date.now();
      /* The decision lives in lib/imaging, where it can be tested: this exact
         rule has been wrong twice, and both times only a real shift would have
         shown it. The switch is read every beat rather than at start, so an
         admin turning screenshots off stops the NEXT capture. */
      if (!shouldCapture(now, nextDueRef.current, {
        busy: capturingRef.current,
        enabled: settingsRef.current.screenshotsEnabled,
        hasStream: Boolean(streamRef.current),
      })) return;

      /**
       * THE WATCHDOG. A capture that has not landed in well over an interval
       * means something is wrong that nothing else will say out loud.
       *
       * Every failure path in captureOnce reports and returns, so the schedule
       * keeps ticking and the person keeps working while nothing is recorded.
       * That is the state this whole file exists to prevent: a shift that looks
       * monitored and is not. 1.8 intervals is late enough that a slow upload
       * or one skipped beat cannot trigger it, and early enough to catch the
       * problem inside a second cycle rather than at the end of the day.
       */
      const overdue = overdueMinutes(now, lastOkRef.current, settingsRef.current.screenshotMinutes);
      if (overdue !== null) setStalled(overdue);

      /* Before, not after. See above. */
      scheduleNext();
      capturingRef.current = true;
      /* Timed out, because .finally() is what lowers the flag and a promise that
         never settles never reaches one. See CAPTURE_TIMEOUT_MS: without this,
         a single hung upload silently ended capture for the rest of the shift. */
      void withTimeout(captureOnce(), CAPTURE_TIMEOUT_MS, "A screenshot")
        .catch((e) => {
          /* A capture that throws is reported and forgotten. The schedule is
             already set, so the next one goes ahead: an upload failing at
             10:00 must not mean nothing is recorded at 10:10. */
          console.error("capture failed", e);
          setError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => { capturingRef.current = false; });
    };

    const id = window.setInterval(tick, HEARTBEAT_MS);
    /* Coming back to the tab is the moment a throttled timer would have been
       furthest behind, so check then too rather than waiting for the next
       beat. */
    const onVisible = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [state, captureOnce, scheduleNext]);

  const stop = useCallback(() => {
    teardown();
    setState("off");
    setStoppedReason("You turned capture off.");
  }, [teardown]);

  // Capture belongs to a running session and cannot outlive it.
  useEffect(() => {
    if (!running && streamRef.current) {
      teardown();
      setState("off");
      setStoppedReason("The tracked session ended, so capture stopped with it.");
    }
  }, [running, teardown]);

  useEffect(() => () => teardown(), [teardown]);

  return {
    state, surface, shots, lastCaptureAt, error, surfaceRefused, screenChange, stoppedReason,
    stalledMinutes,
    keystrokes: counts.keystrokes,
    mouseEvents: counts.mouseEvents,
    idleSeconds: counts.idleSeconds,
    start, stop,
  };
}
