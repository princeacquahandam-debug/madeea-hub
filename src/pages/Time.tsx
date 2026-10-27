import { useEffect, useMemo, useState } from "react";
import { track } from "@/lib/analytics";
import { ClockWatch } from "@/components/ClockWatch";
import { Play, Pause, Square, Trash2, Camera, ShieldAlert, Info, MonitorPlay } from "lucide-react";
import { PageHeader, Badge } from "@/components/ui";
import { atLeast,
  entrySeconds, pausedSession, useMyClients, useMyRole, useTimeEntries, useTimeMutations,
  useTimeSettings, useEffectiveTimeSettings, workDate,
} from "@/data/hooks";
import type { TimeEntry } from "@/types/db";
import { dayTotal, type BreakRule } from "@/lib/breakDeduction";
import { useNow } from "@/hooks/useNow";
import { useMonitoringContext } from "@/store/monitoringContext";
import { useClockGate } from "@/components/ClockGates";
import type { MonitoringStatus } from "@/hooks/useMonitoring";
import { useClientContext } from "@/store/clientContext";
import { surfaceLabel } from "@/components/client/format";
import { fmtTime, isValidZone, useTimeZone, zoneCity } from "@/lib/userTimeZone";

/**
 * 30720 -> "8:32". Hours and minutes, which is how a timesheet is read and how
 * payroll is calculated. Seconds on a total are noise that changes every tick
 * and makes two people comparing figures disagree.
 */
function hm(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}`;
}

/**
 * The live clock keeps its seconds. This is the one place they earn their
 * place: a display frozen at 0:00 for a minute after clocking in looks broken,
 * and the ticking IS the evidence that the timer is running.
 */
function hms(seconds: number): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(seconds / 3600))}:${p(Math.floor((seconds % 3600) / 60))}:${p(seconds % 60)}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDay(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${MONTHS[Number(m) - 1]} ${Number(d)}`;
}

/** Today, or a start/end pair. Reichelle asked for exactly these two. */
type Range = "today" | "week" | "custom";

export default function Time() {
  const { data: entries = [] } = useTimeEntries();
  const clients = useMyClients();
  const { data: role } = useMyRole();
  const { data: settings } = useTimeSettings();
  const { start, stop, remove, pause, finishPaused } = useTimeMutations();
  const isAdmin = atLeast(role, "admin");

  const running = entries.find((e) => !e.ended_at);
  /* On a break (19 Oct 2026, 0088): nothing running, and today's latest
     session ended with Pause. Resume opens a new session for the same client. */
  const paused = pausedSession(entries);
  const now = useNow(running || paused ? 1000 : null);

  /* Seeded from the client you are working on, so clocking in while scoped to
     CandyPay books the time to CandyPay without asking again. Still a plain
     select afterwards: the context is a default, not a lock, because an EA can
     legitimately log a few minutes for someone else without switching. */
  const { clientId: scopeId } = useClientContext();
  const [clientId, setClientId] = useState(scopeId ?? "");
  const [touchedClient, setTouchedClient] = useState(false);
  useEffect(() => {
    if (!touchedClient) setClientId(scopeId ?? "");
  }, [scopeId, touchedClient]);
  const [note, setNote] = useState("");
  const [earlyReason, setEarlyReason] = useState("");
  const [askEarly, setAskEarly] = useState(false);

  /* Every time on this page is in YOUR time zone (Settings), not the
     computer's, so Reich's "one zone everywhere" holds here too. A client in
     another zone also gets their own local time beside their name. */
  const zone = useTimeZone();
  const zoneOf = (id: string | null | undefined) => {
    const tz = clients.find((c) => c.id === id)?.timezone;
    return isValidZone(tz) && tz !== zone ? tz : null;
  };
  const clientClock = (id: string | null | undefined) => {
    const tz = zoneOf(id);
    return tz ? `${fmtTime(now, tz)} in ${zoneCity(tz)}` : null;
  };
  const clientSpan = (e: TimeEntry) => {
    const tz = zoneOf(e.client_id);
    return tz ? `${fmtTime(e.started_at, tz)} – ${e.ended_at ? fmtTime(e.ended_at, tz) : "now"} in ${zoneCity(tz)}` : undefined;
  };

  const today = workDate();
  const [range, setRange] = useState<Range>("today");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);

  const dailyHours = settings?.daily_hours ?? 8;
  const dailySeconds = dailyHours * 3600;

  /* Automatic break deduction (0089): a day longer than the set hours has
     the set break taken off, minus any break already taken with Pause. */
  const breakRule: BreakRule | null = settings && settings.auto_break_minutes > 0
    ? { breakMinutes: settings.auto_break_minutes, afterHours: settings.auto_break_after_hours }
    : null;
  const todayTotal = useMemo(() => {
    const rows = entries.filter((e) => e.work_date === today);
    return dayTotal(rows, rows.reduce((a, e) => a + entrySeconds(e, now), 0), breakRule);
  }, [entries, today, now, breakRule?.breakMinutes, breakRule?.afterHours]); // eslint-disable-line react-hooks/exhaustive-deps
  const todaySeconds = todayTotal.net;

  /* Screen capture is tied to the running session, so it cannot outlive the
     clock and cannot start without one. */
  /* Read, not owned. This page used to call useMonitoring itself, which meant
     the capture belonged to the page: navigating to Tasks unmounted it and the
     stream was stopped mid-session with nothing said. It now lives in the app
     shell, above the router, and this page is one consumer of it. */
  const { data: effective } = useEffectiveTimeSettings();
  const capture = useMonitoringContext();
  const screenshotsOn = effective?.screenshotsEnabled !== false;

  // Auto-prompt is impossible: getDisplayMedia needs a user gesture. So the
  // button below is the gesture, and the banner explains why it exists.
  useEffect(() => { if (!running && !paused) setAskEarly(false); }, [running, paused]);

  // Monday of this week, for "This week".
  const weekStart = useMemo(() => {
    const d = new Date(`${today}T00:00:00`);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }, [today]);
  const [lo, hi] = range === "today" ? [today, today]
    : range === "week" ? [weekStart, today]
    : from <= to ? [from, to] : [to, from];

  const inRange = useMemo(
    () => entries.filter((e) => e.work_date >= lo && e.work_date <= hi),
    [entries, lo, hi],
  );

  // Per day, so each day's break is judged on its own length.
  const rangeSeconds = useMemo(() => {
    const days = new Map<string, TimeEntry[]>();
    for (const e of inRange) days.set(e.work_date, [...(days.get(e.work_date) ?? []), e]);
    let total = 0;
    for (const rows of days.values()) total += dayTotal(rows, rows.reduce((a, e) => a + entrySeconds(e, now), 0), breakRule).net;
    return total;
  }, [inRange, now, breakRule?.breakMinutes, breakRule?.afterHours]); // eslint-disable-line react-hooks/exhaustive-deps

  const byDay = useMemo(() => {
    const map = new Map<string, TimeEntry[]>();
    for (const e of inRange) {
      const list = map.get(e.work_date) ?? [];
      list.push(e);
      map.set(e.work_date, list);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [inRange]);

  /* Expected hours for the selected window: the number an EA is checking
     against when they ask "did I make my 80 this week". Counts only days
     actually worked for Today, and calendar weekdays for a range, so a
     Saturday does not silently add eight hours to the target. */
  const expectedSeconds = useMemo(() => {
    if (range === "today") return dailySeconds;
    const end = new Date(hi + "T00:00:00");
    let days = 0;
    for (const d = new Date(lo + "T00:00:00"); d <= end; d.setDate(d.getDate() + 1)) {
      const wd = d.getDay();
      if (wd !== 0 && wd !== 6) days++;
    }
    return days * dailySeconds;
  }, [range, lo, hi, dailySeconds]);

  /**
   * Clocking in and out, both gated on reporting (components/ClockGates).
   *
   * ── THE SCREEN SHARE RIDES ON THE SAME CLICK ─────────────────────────────
   * getDisplayMedia is granted only during a real user gesture, so the share
   * has to be requested from a click somebody is already making. It used to be
   * a separate button further down this page, and a shift where nobody pressed
   * it ran for hours recording nothing — the warning badge in the header exists
   * because that kept happening.
   *
   * THE PROMPT ITSELF CANNOT BE REMOVED. No web page can photograph a screen
   * without the browser asking first, and no setting, permission or flag in
   * this codebase changes that. All that can be done is to stop it being a step
   * of its own that is easy to skip. A desktop agent is the only thing that
   * removes it, which is why the data model already allows for one
   * (source='agent' beside source='browser').
   *
   * Clock-in fires FIRST, so declining the share still records attendance, and
   * capture.start() runs in the same handler with nothing awaited in between:
   * one await and the gesture has expired, and the share is refused without a
   * prompt ever appearing.
   */
  const gate = useClockGate({
    onClockIn: (focus) => {
      start.mutate({ client_id: clientId || null, note: note.trim() || null, focus });
      setNote("");
      if (effective?.screenshotsEnabled !== false && capture.state !== "capturing") {
        void capture.start();
      }
    },
    onClockOut: (skipped) => afterEod(skipped),
  });

  /* Resume after a pause. Same client, note and day focus as before the
     break, and screen sharing is asked for in this same click, because a
     browser only allows that from a user gesture (see the clock-in note above). */
  function resume() {
    if (!paused) return;
    start.mutate({ client_id: paused.client_id ?? null, note: paused.note ?? null, focus: paused.focus ?? null });
    if (effective?.screenshotsEnabled !== false && capture.state !== "capturing") {
      void capture.start();
    }
  }

  /* Carried between the two questions asked at clock-out. The EOD gate answers
     first and hands its verdict here; the early-finish question may then need
     asking, and the answer to the first has to survive that second round trip
     or a short day would quietly lose the fact that its report was skipped. */
  const [pendingSkip, setPendingSkip] = useState<string | null>(null);

  /** Where the EOD gate hands back. This order on purpose: a short day still
      owes a report, and asking both things at once gets one of them answered. */
  function afterEod(skipped: string | null) {
    if (!running && !paused) return;
    const short = todaySeconds < dailySeconds;
    // Ask at the moment of clocking out, not later. Reconstructing why you left
    // early on a Tuesday three weeks ago produces fiction, not a reason.
    if (short && !askEarly) { setPendingSkip(skipped); setAskEarly(true); return; }
    finishClockOut(skipped);
  }

  function finishClockOut(skipped: string | null) {
    if (!running && !paused) return;
    const short = todaySeconds < dailySeconds;
    const notes = { early_reason: short ? earlyReason.trim() || null : null, eod_skipped_reason: skipped };
    // Clocking out from a break: the paused session is already closed, so the
    // shift just stops being paused, with the same clock-out notes.
    if (running) stop.mutate({ id: running.id, ...notes });
    else if (paused) finishPaused.mutate({ id: paused.id, ...notes });
    setEarlyReason("");
    setAskEarly(false);
    setPendingSkip(null);
  }

  return (
    <div>
      <PageHeader
        title="Time tracker"
        subtitle="Your clock-ins are used for attendance and payroll."
      />

      {/* Your shift first, the team beside it (12 Oct 2026, UI review deck
          slide 6). Team today renders nothing below manager, and then the
          clock takes the full width. */}
      <div className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-start">

      {/* ---- the clock ----
          Fixed min-height across both states. The card used to be a different
          height running and stopped, so clocking in shoved everything below it
          down the page and the timer appeared to jump. */}
      <section className="card min-h-[132px] min-w-0 flex-1 p-5">
        {/* Today against the day's target, the biggest thing on the page. */}
        <div className="flex items-start gap-3">
          <div>
            <p className="text-xs text-muted">Today</p>
            <p className="tabular-nums">
              <span className="text-[32px] font-semibold leading-tight">{running ? hms(todaySeconds) : hm(todaySeconds)}</span>
              <span className="text-sm text-faint"> / {dailyHours}:00</span>
            </p>
            {todayTotal.deducted > 0 && (
              <p className="text-[11px] text-faint" title={`Days over ${breakRule?.afterHours} hours have a ${breakRule?.breakMinutes}-minute unpaid break. Breaks taken with Pause count toward it.`}>
                After a {Math.round(todayTotal.deducted / 60)} min automatic break
              </p>
            )}
          </div>
          <span className="ml-auto mt-1 flex items-center gap-1.5 text-xs text-muted">
            <span className={`h-1.5 w-1.5 rounded-full ${running ? "bg-emerald-500" : paused ? "bg-amber-500" : "bg-[rgb(var(--c-faint))]"}`} />
            {running
              ? `Clocked in since ${fmtTime(running.started_at, zone)}`
              : paused
                ? `Paused since ${fmtTime(paused.ended_at!, zone)}`
                : "Not clocked in"}
          </span>
        </div>
        <div className="mb-4 mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.min(100, (todaySeconds / dailySeconds) * 100)}%` }} />
        </div>
        {running ? (
          <div className="flex flex-wrap items-center gap-4">
            <div className="min-w-0">
              <p className="text-xs text-faint">This shift</p>
              {/* Tabular figures so the digits don't shift every second. */}
              <p className="text-lg font-semibold tabular-nums">
                {hms(entrySeconds(running, now))}
              </p>
              <p className="truncate text-sm text-muted">
                {running.client_name ?? "No client"}
                {running.note?.trim() ? ` · ${running.note}` : ""}
              </p>
              {clientClock(running.client_id) && <p className="text-xs text-faint">It's {clientClock(running.client_id)}</p>}
            </div>

            <div className="ml-auto flex flex-col items-end gap-2">
              <div className="flex gap-2">
                {/* A break: the clock and screenshots stop, and paused time is
                    not counted. Resume picks up the same client. */}
                <button className="btn-ghost border border-border" onClick={() => pause.mutate(running.id)} disabled={pause.isPending || stop.isPending}>
                  <Pause size={15} /> Pause
                </button>
                <button className="btn-ghost border border-border" onClick={() => gate.requestClockOut(running)} disabled={stop.isPending}>
                  <Square size={15} /> Clock out
                </button>
              </div>
              {screenshotsOn && <CaptureBadge capture={capture} minutes={settings?.screenshot_minutes ?? 10} />}
            </div>
          </div>
        ) : paused ? (
          <div className="flex flex-wrap items-center gap-4">
            <div className="min-w-0">
              <p className="text-xs text-faint">On a break</p>
              <p className="text-lg font-semibold tabular-nums">{hms(Math.max(0, Math.floor((now - new Date(paused.ended_at!).getTime()) / 1000)))}</p>
              <p className="truncate text-sm text-muted">
                {paused.client_name ?? "No client"}
                {paused.note?.trim() ? ` · ${paused.note}` : ""}
                {" · paused time isn't counted"}
              </p>
            </div>
            <div className="ml-auto flex gap-2">
              <button className="btn-primary" onClick={resume} disabled={start.isPending}>
                <Play size={15} /> Resume
              </button>
              <button className="btn-ghost border border-border" onClick={() => gate.requestClockOut(paused)} disabled={finishPaused.isPending}>
                <Square size={15} /> Clock out
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[200px] flex-1">
              <label className="field-label" htmlFor="time-client">Client</label>
              <select
                id="time-client"
                className="input"
                value={clientId}
                onChange={(e) => { setClientId(e.target.value); setTouchedClient(true); }}
              >
                <option value="">{clients.length ? "Select a client" : "No clients assigned to you"}</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {clientClock(clientId) && <p className="mt-1 text-xs text-faint">It's {clientClock(clientId)}</p>}
            </div>
            <div className="min-w-[220px] flex-[1.4]">
              {/* Replaces "What are you working on?". An EA does email, a Zoom
                  call, the calendar and admin for the same client inside one
                  hour; making them re-declare the activity each time produced
                  noise nobody read. The client is the unit that matters. */}
              <label className="field-label" htmlFor="time-note">Note (optional)</label>
              <input
                id="time-note" className="input" placeholder="Add a note for this shift"
                value={note} onChange={(e) => setNote(e.target.value)}
              />
            </div>
            <button className="btn-primary shrink-0" onClick={gate.requestClockIn} disabled={start.isPending}>
              <Play size={15} /> Clock in
            </button>
          </div>
        )}

        {/* Early clock-out reason, asked only when the day is actually short. */}
        {askEarly && (running || paused) && (
          <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
            <label className="field-label" htmlFor="early-reason">
              You have {hm(todaySeconds)} of {dailyHours}:00 today. Why are you clocking out early?
            </label>
            <div className="flex flex-wrap gap-2">
              <input
                id="early-reason" className="input min-w-0 flex-1" autoFocus
                placeholder="e.g. approved half day, power outage, medical"
                value={earlyReason} onChange={(e) => setEarlyReason(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") finishClockOut(pendingSkip); }}
              />
              <button className="btn-primary shrink-0" onClick={() => finishClockOut(pendingSkip)} disabled={stop.isPending || finishPaused.isPending}>
                Clock out
              </button>
              <button className="btn-ghost shrink-0 border border-border" onClick={() => setAskEarly(false)}>
                Keep working
              </button>
            </div>
          </div>
        )}
      </section>

      <ClockWatch className="lg:w-[340px] lg:shrink-0" />
      </div>

      {screenshotsOn && running && <CapturePanel capture={capture} minutes={settings?.screenshot_minutes ?? 10} />}

      {/* ---- the timesheet ---- */}
      <section className="card p-5">
        {/* Period and total live in the header (deck slide 6). */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h2 className="text-[15px] font-semibold">Timesheet</h2>
          <div className="flex gap-0.5 rounded-lg bg-surface-2 p-0.5" role="tablist" aria-label="Period">
            {(["today", "week", "custom"] as Range[]).map((r) => (
              <button
                key={r} role="tab" onClick={() => { setRange(r); track("timesheet_period_changed", { period: r }); }} aria-selected={range === r}
                className={
                  "min-h-[28px] rounded-md px-3 text-[13px] font-medium transition-colors " +
                  (range === r ? "bg-surface text-text shadow-sm" : "text-muted hover:text-text")
                }
              >
                {r === "today" ? "Today" : r === "week" ? "This week" : "Custom"}
              </button>
            ))}
          </div>
          {range === "custom" && (
            <div className="flex items-center gap-1.5">
              <input type="date" aria-label="From" className="input h-8 w-auto py-0 text-sm" value={from} onChange={(e) => setFrom(e.target.value)} />
              <span className="text-faint">–</span>
              <input type="date" aria-label="To" className="input h-8 w-auto py-0 text-sm" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          )}
          <p className="ml-auto text-sm text-muted">
            Total <strong className="tabular-nums text-text">{hm(rangeSeconds)}</strong>
            <span className="tabular-nums text-faint"> / {hm(expectedSeconds)}</span>
          </p>
        </div>

        {byDay.length === 0 && (
          <p className="py-6 text-center text-sm text-faint">No time logged for this period.</p>
        )}

        <div className="space-y-4">
          {byDay.map(([day, rows]) => {
            const t = dayTotal(rows, rows.reduce((a, e) => a + entrySeconds(e, now), 0), breakRule);
            const total = t.net;
            return (
              <div key={day}>
                <div className="mb-1.5 flex items-center gap-2">
                  <p className="eyebrow">{fmtDay(day)}</p>
                  {day === today && <Badge tone="normal">Today</Badge>}
                  {t.deducted > 0 && (
                    <span className="ml-auto text-[11px] text-faint" title="Automatic unpaid break, set by your admin">
                      −{Math.round(t.deducted / 60)} min break
                    </span>
                  )}
                  <span className={`${t.deducted > 0 ? "" : "ml-auto "}text-sm font-semibold tabular-nums`}>{hm(total)}</span>
                </div>
                <div className="space-y-1">
                  {rows.map((e) => (
                    <div key={e.id} className="group flex items-center gap-3 rounded-lg bg-surface-2 px-3 py-2">
                      <span className="w-[128px] shrink-0 text-xs tabular-nums text-faint" title={clientSpan(e)}>
                        {fmtTime(e.started_at, zone)}
                        {" – "}
                        {e.ended_at ? fmtTime(e.ended_at, zone) : "now"}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {e.client_name ?? <span className="text-faint">No client</span>}
                        {e.note?.trim() && <span className="text-muted"> · {e.note}</span>}
                      </span>
                      {e.early_reason && (
                        <span
                          title={`Early clock-out: ${e.early_reason}`}
                          className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400"
                        >
                          Early
                        </span>
                      )}
                      {!e.ended_at && <Badge tone="urgent">Running</Badge>}
                      {/* Ended with Pause (0088): a break followed, not counted. */}
                      {e.paused && (
                        <span title="Paused here. The break isn't counted." className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600">
                          Paused
                        </span>
                      )}
                      <span className="shrink-0 text-sm tabular-nums">{hm(entrySeconds(e, now))}</span>
                      {/* Admin only since 0041. An EA deleting a short day was
                          the easiest way to fake a timesheet, and RLS refuses
                          it now, so showing the button to everyone would offer
                          a control that silently fails. */}
                      {isAdmin && (
                        <button
                          className="icon-btn reveal-on-hover shrink-0 text-faint hover:text-red-400"
                          onClick={() => remove.mutate(e.id)}
                          aria-label="Delete shift"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <p className="mt-4 flex items-start gap-1.5 border-t border-border pt-3 text-xs text-faint">
          <ShieldAlert size={12} className="mt-0.5 shrink-0" />
          <span>Shifts can't be edited. Missed a clock-in? Ask an admin.</span>
        </p>
      </section>
    </div>
  );
}

/** Compact status next to the clock-out button. */
function CaptureBadge({ capture, minutes }: { capture: MonitoringStatus; minutes: number }) {
  const map: Record<string, { text: string; cls: string }> = {
    capturing: { text: `Screenshot every ${minutes}m`, cls: "bg-emerald-500/15 text-emerald-400" },
    off: { text: "Screenshots off", cls: "bg-amber-500/15 text-amber-400" },
    stopped: { text: "Screenshots stopped", cls: "bg-amber-500/15 text-amber-400" },
    denied: { text: "Screen sharing refused", cls: "bg-red-500/15 text-red-400" },
    requesting: { text: "Waiting for permission", cls: "bg-zinc-500/15 text-faint" },
    unsupported: { text: "Not supported here", cls: "bg-red-500/15 text-red-400" },
  };
  const s = map[capture.state] ?? map.off;
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${s.cls}`}>
      {s.text}{capture.state === "capturing" && capture.shots > 0 ? ` · ${capture.shots}` : ""}
    </span>
  );
}

/**
 * The screen-capture control, and an honest account of what it can prove.
 *
 * It is a button rather than something automatic because getDisplayMedia
 * requires a user gesture. No amount of design removes that, so the screen says
 * what is needed instead of appearing to work and quietly capturing nothing.
 */
function CapturePanel({ capture, minutes }: { capture: MonitoringStatus; minutes: number }) {
  const weak = capture.state === "capturing" && capture.surface === "browser";
  return (
    <section className="card mb-4 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Camera size={15} className="text-accent" />
        <div className="min-w-[220px] flex-1">
          <p className="text-sm font-semibold">Screenshots</p>
          <p className="text-xs text-faint">
            {capture.state === "capturing"
              ? `Sharing your ${capture.surface && capture.surface !== "unknown" ? surfaceLabel(capture.surface) : "screen"}. A screenshot every ${minutes} minutes.` +
                (capture.lastCaptureAt
                  ? ` Last at ${fmtTime(capture.lastCaptureAt)}, ` +
                    /* The next one, worked out from the last rather than from a
                       countdown: a number that ticks invites watching, and the
                       question people have is "is this still running", not
                       "how many seconds". Approximate on purpose, because the
                       interval is randomised so captures cannot be timed. */
                    `next around ${fmtTime(capture.lastCaptureAt.getTime() + minutes * 60_000)}.`
                  : " Waiting for the first screenshot.")
              : `Screenshots every ${minutes} minutes while you are clocked in. Your browser has to ask you first.`}
          </p>
        </div>
        {capture.state === "capturing" ? (
          <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-500"><Camera size={13} /> Sharing</span>
        ) : (
          <button className="btn-primary" onClick={() => void capture.start()}>
            <MonitorPlay size={14} /> Start screen sharing
          </button>
        )}
      </div>

      {/* How the two fit together (Reich's testing, 20 Oct 2026). */}
      <p className="mt-2 text-[12px] leading-relaxed text-muted">
        While you're clocked in, your whole screen is shared and a screenshot is taken about every {minutes} minutes.
        To stop sharing for a break or for privacy, press <b>Pause</b>: the clock and screenshots stop together, and the
        break shows on your timesheet. If sharing is stopped another way, the clock pauses by itself until you resume.
      </p>

      {/* Running and producing nothing. Louder than the tab warning because
          it is worse: that one records weak evidence, this one records none,
          and both look identical from the outside until somebody checks. */}
      {capture.stalledMinutes !== null && (
        <p className="mt-2 flex items-start gap-2 rounded-lg border border-red-500/50 bg-red-500/10 p-2.5 text-[12.5px] text-red-200">
          <Info size={14} className="mt-0.5 shrink-0" />
          <span>
            <b>No screenshot has been saved for {capture.stalledMinutes} minutes.</b> Check that screen
            sharing is still on. If it is, stop and start sharing again.
          </span>
        </p>
      )}

      {weak && (
        <p className="mt-2 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-2.5 text-[12.5px] text-amber-200">
          <Info size={14} className="mt-0.5 shrink-0" />
          <span>
            You shared a single browser tab, so the screenshots only show that tab. Share the whole
            screen instead if this is meant to verify your shift.
          </span>
        </p>
      )}

      {/* Why it is not running, whenever it is not. A recording that ended
          without saying so is the failure this whole area keeps producing. */}
      {capture.state !== "capturing" && capture.stoppedReason && (
        <p className="mt-2 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-2.5 text-[12px] text-amber-200">
          <Info size={13} className="mt-0.5 shrink-0" />
          <span>{capture.stoppedReason}</span>
        </p>
      )}

      {capture.error && (
        <p className="mt-2 text-[12px] text-amber-300/80">{capture.error}</p>
      )}
    </section>
  );
}
