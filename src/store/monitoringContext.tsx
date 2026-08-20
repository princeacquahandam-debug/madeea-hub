import { createContext, useContext, useRef, type ReactNode } from "react";
import { useMonitoring, type MonitoringStatus } from "@/hooks/useMonitoring";
import { useTimeEntries, useEffectiveTimeSettings } from "@/data/hooks";

/**
 * Screen capture, owned above the router.
 *
 * WHY THIS EXISTS AT ALL. useMonitoring used to be called inside the Time
 * Tracker page. React Router unmounts a page when you navigate away, the hook's
 * cleanup ran, and the stream was stopped: opening Tasks, or the Inbox, or
 * anything else silently ended the recording. Reproduced before fixing, by
 * counting live MediaStreamTracks rather than trusting the UI: 1 live track on
 * the Time page, 0 immediately after clicking through to Tasks, and the browser's
 * own sharing indicator gone with it.
 *
 * That is the worst possible failure for a monitoring product. The session
 * stayed open, the timer kept counting, the timesheet kept filling in, and the
 * evidence simply stopped without anyone being told. An employee would look like
 * they had worked four hours with two screenshots.
 *
 * A monitored session belongs to the session, not to whichever page happens to
 * be mounted. This provider sits in the app shell, above the Outlet, so it
 * survives every navigation. The Time Tracker page is now one consumer of it
 * rather than its owner.
 *
 * WHAT THIS DOES NOT FIX, and cannot. A browser tab that is backgrounded has its
 * timers throttled to roughly once a minute, so a capture can be a little late
 * while you work in another tab. It is not stopped, and the interval is minutes
 * rather than seconds, so the drift is small. Closing the tab, or the browser,
 * does end the capture, and no web page can prevent that.
 */

const Ctx = createContext<MonitoringStatus | null>(null);

export function MonitoringProvider({ children }: { children: ReactNode }) {
  const { data: entries, isSuccess } = useTimeEntries();
  const { data: effective } = useEffectiveTimeSettings();

  /* THE SESSION IS LATCHED, and this is the second half of the same bug.
     Capture used to stop the instant the session list looked empty. The list
     can look empty for reasons that have nothing to do with the shift ending:
     a refetch in flight, a dropped request, an expired token being refreshed.
     refetchOnWindowFocus is on by default, so simply returning to the tab was
     enough to trigger one, and a recording would end mid-shift.
     So capture stops only when the session is POSITIVELY known to be over:
     a successful load that either shows the entry closed or no longer lists it.
     An unknown state holds the previous answer instead of guessing the
     destructive one. */
  const latched = useRef<string | null>(null);
  const running = entries?.find((e) => !e.ended_at) ?? null;

  if (running) {
    latched.current = running.id;
  } else if (isSuccess && entries) {
    // A load that succeeded and shows nothing open is real evidence the shift
    // ended. Only this clears the latch.
    latched.current = null;
  }
  const sessionId = latched.current;

  const monitoring = useMonitoring({
    timeEntryId: sessionId,
    settings: {
      screenshotMinutes: effective?.screenshotMinutes ?? 10,
      screenshotsEnabled: effective?.screenshotsEnabled ?? true,
      blurScreenshots: effective?.blurScreenshots ?? false,
      randomizeCapture: effective?.randomizeCapture ?? true,
    },
  });

  return <Ctx.Provider value={monitoring}>{children}</Ctx.Provider>;
}

/**
 * Read the live capture status from anywhere.
 *
 * Throws rather than returning null when the provider is missing. A screen that
 * silently renders "not capturing" because it is outside the tree would be the
 * same class of bug this file exists to fix: monitoring that looks off when it
 * is actually running, or the reverse.
 */
export function useMonitoringContext(): MonitoringStatus {
  const v = useContext(Ctx);
  if (!v) throw new Error("useMonitoringContext must be used inside MonitoringProvider");
  return v;
}
