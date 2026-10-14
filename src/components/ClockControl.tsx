import { useNavigate } from "react-router-dom";
import { Play, Square, CameraOff, Camera } from "lucide-react";
import { entrySeconds, useClients, useTimeEntries, useTimeMutations, useEffectiveTimeSettings } from "@/data/hooks";
import { useMonitoringContext } from "@/store/monitoringContext";
import { useClockGate } from "@/components/ClockGates";
import { useNow } from "@/hooks/useNow";
import { cn } from "@/lib/utils";

/**
 * Clock in / out, in the header on every page.
 *
 * R-4.5.2 is the whole reason this is not tucked away on the Time page:
 * attendance is only recorded if the EA opens the app and starts the tracker,
 * and that is the deliberate adoption mechanism (Rowena 34:25, Rio 34:31). A
 * control you have to go looking for does not force anything, this one is
 * either counting or visibly not counting, on every screen.
 *
 * Clocking IN is one click. Clocking OUT is one click. Choosing a task is on
 * the Time page, because making it a required first decision is how people end
 * up not starting the timer at all.
 */
export function ClockControl() {
  const nav = useNavigate();
  const { data: entries = [] } = useTimeEntries();
  const { start, stop } = useTimeMutations();
  const capture = useMonitoringContext();
  const { data: settings } = useEffectiveTimeSettings();

  const running = entries.find((e) => !e.ended_at);
  const { data: clients = [] } = useClients();
  const clientName = running?.client_id ? clients.find((c) => c.id === running.client_id)?.name ?? null : null;
  const now = useNow(running ? 1000 : null);

  /**
   * The clock is gated on reporting: clocking in states the day's focus,
   * clocking out files that day's EOD. Both rules and both dialogs live in
   * components/ClockGates, so this control and the Time page cannot drift into
   * two different sets of requirements for the same act.
   */
  const gate = useClockGate({
    onClockIn: (focus) => {
      start.mutate({ focus });
      /* The share is asked for on this same click. getDisplayMedia needs a live
         user gesture, and this runs inside the dialog's own button handler with
         nothing awaited before it, so the gesture is still there. */
      if (settings?.screenshotsEnabled !== false && capture.state !== "capturing") void capture.start();
    },
    onClockOut: (skipped) => {
      if (!running) return;
      stop.mutate({ id: running.id, eod_skipped_reason: skipped });
    },
  });

  const label = (() => {
    if (!running) return "Clock in";
    const s = entrySeconds(running, now);
    const p = (n: number) => String(n).padStart(2, "0");
    // Live, to the second (deck slide 9: "2:14:05").
    return `${Math.floor(s / 3600)}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
  })();

  /**
   * A clocked-in shift that is recording no screenshots.
   *
   * WHY THIS BADGE EXISTS. Screen capture cannot resume by itself: browsers
   * require a user gesture for getDisplayMedia, so a refresh, a crash, or
   * closing the sharing bar ends it permanently for that shift. Nothing said
   * so anywhere except the Time page, which is a page people visit to read
   * their timesheet and not while working — so a shift could run seven hours
   * with one screenshot at the start, and look like deliberate avoidance in
   * the record.
   *
   * The timer is already the one control on every screen. This puts the gap
   * beside it, and one click goes to where it is fixed.
   *
   * Hidden when screenshots are switched off for the account: there is no gap
   * then, and a permanent warning about something working as configured is how
   * people learn to ignore warnings.
   */
  const screenshotsExpected = settings?.screenshotsEnabled !== false;
  const notCapturing = Boolean(running) && screenshotsExpected && capture.state !== "capturing";

  return (
    <div className="flex items-center gap-1.5">
      <button
        className={cn(
          "flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm font-medium transition-colors hover:bg-[var(--chip-bg)]",
          running ? "text-text" : "text-text",
        )}
        onClick={() => (running ? gate.requestClockOut(running) : gate.requestClockIn())}
        // Right-click / long-press goes to the full timesheet rather than
        // hijacking the primary click, which has to stay one-tap.
        onContextMenu={(e) => { e.preventDefault(); nav("/time"); }}
        disabled={start.isPending || stop.isPending}
        title={running ? "Clock out. Right-click for the timesheet" : "Clock in. Attendance is recorded from this."}
        aria-label={running ? "Clock out" : "Clock in"}
      >
        {running ? (
          <>
            {/* The live dot stays green in both themes (slide 14). */}
            <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
            <span className="whitespace-nowrap font-semibold tabular-nums">{label}</span>
            <span className="hidden max-w-[9rem] truncate text-muted lg:inline">· {clientName ?? "No client"}</span>
            <Square size={13} className="shrink-0 text-muted" aria-hidden="true" />
          </>
        ) : (
          <>
            <Play size={14} />
            <span className="hidden whitespace-nowrap sm:inline">{label}</span>
          </>
        )}
      </button>

      {notCapturing && (
        <button
          onClick={() => nav("/time")}
          className="flex h-10 items-center gap-1.5 rounded-xl border border-amber-500/50 px-2.5 text-xs font-semibold text-amber-400 transition-colors hover:bg-amber-500/10"
          title="You are clocked in but no screenshots are being taken. Screen sharing has to be started by hand after a reload."
        >
          <CameraOff size={14} />
          {/* Named on wider screens, an icon on a phone. The colour alone is
              not the message: this gets screenshotted into Slack. */}
          <span className="hidden md:inline">No screenshots</span>
        </button>
      )}

      {/* While the screen is being shared, say so beside the clock and let it be
          stopped in one click (13 Oct 2026 call: "how do I stop it?"). Stopping
          sharing keeps the shift running; clocking out ends both. */}
      {running && capture.state === "capturing" && (
        <button
          onClick={capture.stop}
          className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-semibold text-muted transition-colors hover:bg-[var(--chip-bg)] hover:text-text"
          title="Your screen is being shared for screenshots. Click to stop sharing; your shift keeps running."
          aria-label="Stop screen sharing"
        >
          <Camera size={14} className="text-emerald-500" />
          <span className="hidden md:inline">Stop sharing</span>
        </button>
      )}

      {/* Nothing renders until a gate actually stops somebody. */}
      {gate.dialog}
    </div>
  );
}
