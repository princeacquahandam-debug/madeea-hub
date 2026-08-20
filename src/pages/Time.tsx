import { useEffect, useMemo, useState } from "react";
import { Clock, Play, Square, Trash2, CalendarDays, Camera, ShieldAlert, Info, MonitorPlay } from "lucide-react";
import { PageHeader, Badge } from "@/components/ui";
import {
  entrySeconds, useMyClients, useMyRole, useTimeEntries, useTimeMutations,
  useTimeSettings, useEffectiveTimeSettings, workDate,
} from "@/data/hooks";
import type { TimeEntry } from "@/types/db";
import { useNow } from "@/hooks/useNow";
import { useMonitoring } from "@/hooks/useMonitoring";
import { useClientContext } from "@/store/clientContext";

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
type Range = "today" | "custom";

export default function Time() {
  const { data: entries = [] } = useTimeEntries();
  const clients = useMyClients();
  const { data: role } = useMyRole();
  const { data: settings } = useTimeSettings();
  const { start, stop, remove } = useTimeMutations();
  const isAdmin = role === "admin";

  const running = entries.find((e) => !e.ended_at);
  const now = useNow(running ? 1000 : null);

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

  const today = workDate();
  const [range, setRange] = useState<Range>("today");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);

  const dailyHours = settings?.daily_hours ?? 8;
  const dailySeconds = dailyHours * 3600;

  const todaySeconds = useMemo(
    () => entries.filter((e) => e.work_date === today).reduce((a, e) => a + entrySeconds(e, now), 0),
    [entries, today, now],
  );

  /* Screen capture is tied to the running session, so it cannot outlive the
     clock and cannot start without one. */
  /* Capture settings come from the database rather than from this component,
     because the same answer has to be given to the agent and to the screen. */
  const { data: effective } = useEffectiveTimeSettings();
  const capture = useMonitoring({
    timeEntryId: running?.id ?? null,
    settings: {
      screenshotMinutes: effective?.screenshotMinutes ?? 10,
      screenshotsEnabled: effective?.screenshotsEnabled ?? true,
      blurScreenshots: effective?.blurScreenshots ?? false,
      randomizeCapture: effective?.randomizeCapture ?? true,
    },
  });
  const screenshotsOn = effective?.screenshotsEnabled !== false;

  // Auto-prompt is impossible: getDisplayMedia needs a user gesture. So the
  // button below is the gesture, and the banner explains why it exists.
  useEffect(() => { if (!running) setAskEarly(false); }, [running]);

  const inRange = useMemo(() => {
    if (range === "today") return entries.filter((e) => e.work_date === today);
    const lo = from <= to ? from : to;
    const hi = from <= to ? to : from;
    return entries.filter((e) => e.work_date >= lo && e.work_date <= hi);
  }, [entries, range, today, from, to]);

  const rangeSeconds = useMemo(
    () => inRange.reduce((a, e) => a + entrySeconds(e, now), 0),
    [inRange, now],
  );

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
    const lo = new Date((from <= to ? from : to) + "T00:00:00");
    const hi = new Date((from <= to ? to : from) + "T00:00:00");
    let days = 0;
    for (const d = new Date(lo); d <= hi; d.setDate(d.getDate() + 1)) {
      const wd = d.getDay();
      if (wd !== 0 && wd !== 6) days++;
    }
    return days * dailySeconds;
  }, [range, from, to, dailySeconds]);

  function clockIn() {
    start.mutate({ client_id: clientId || null, note: note.trim() || null });
    setNote("");
  }

  function clockOut() {
    if (!running) return;
    const short = todaySeconds < dailySeconds;
    // Ask at the moment of clocking out, not later. Reconstructing why you left
    // early on a Tuesday three weeks ago produces fiction, not a reason.
    if (short && !askEarly) { setAskEarly(true); return; }
    stop.mutate({ id: running.id, early_reason: short ? earlyReason.trim() || null : null });
    setEarlyReason("");
    setAskEarly(false);
  }

  return (
    <div>
      <PageHeader
        title="Time Tracker"
        subtitle="Clock in to start your day. Attendance and payroll are recorded from this."
      />

      {/* ---- the clock ----
          Fixed min-height across both states. The card used to be a different
          height running and stopped, so clocking in shoved everything below it
          down the page and the timer appeared to jump. */}
      <section className="card mb-4 min-h-[132px] p-5">
        {running ? (
          <div className="flex flex-wrap items-center gap-4">
            <div className="min-w-0">
              <p className="eyebrow mb-1">
                Since {new Date(running.started_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </p>
              {/* Fixed width and tabular figures: without both, the digits are
                  different widths and the number visibly shifts every second. */}
              <p className="w-[168px] text-3xl font-bold tabular-nums text-accent">
                {hms(entrySeconds(running, now))}
              </p>
              <p className="mt-1 truncate text-sm text-muted">
                {running.client_name ?? "No client"}
                {running.note?.trim() ? ` · ${running.note}` : ""}
              </p>
            </div>

            <div className="ml-auto flex flex-col items-end gap-2">
              <button className="btn-primary" onClick={clockOut} disabled={stop.isPending}>
                <Square size={15} /> Clock out
              </button>
              {screenshotsOn && <CaptureBadge capture={capture} minutes={settings?.screenshot_minutes ?? 10} />}
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
            </div>
            <div className="min-w-[220px] flex-[1.4]">
              {/* Replaces "What are you working on?". An EA does email, a Zoom
                  call, the calendar and admin for the same client inside one
                  hour; making them re-declare the activity each time produced
                  noise nobody read. The client is the unit that matters. */}
              <label className="field-label" htmlFor="time-note">Notes (optional)</label>
              <input
                id="time-note" className="input" placeholder="Anything worth remembering about this session"
                value={note} onChange={(e) => setNote(e.target.value)}
              />
            </div>
            <button className="btn-primary shrink-0" onClick={clockIn} disabled={start.isPending}>
              <Play size={15} /> Clock in
            </button>
          </div>
        )}

        {/* Early clock-out reason, asked only when the day is actually short. */}
        {askEarly && running && (
          <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
            <label className="field-label" htmlFor="early-reason">
              You have {hm(todaySeconds)} of {dailyHours}:00 today. Why are you clocking out early?
            </label>
            <div className="flex flex-wrap gap-2">
              <input
                id="early-reason" className="input min-w-0 flex-1" autoFocus
                placeholder="e.g. approved half day, power outage, medical"
                value={earlyReason} onChange={(e) => setEarlyReason(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") clockOut(); }}
              />
              <button className="btn-primary shrink-0" onClick={clockOut} disabled={stop.isPending}>
                Clock out
              </button>
              <button className="btn-ghost shrink-0 border border-border" onClick={() => setAskEarly(false)}>
                Keep working
              </button>
            </div>
          </div>
        )}

        <p className="mt-3 flex items-center gap-1.5 text-xs text-faint">
          <Clock size={12} /> Today: <strong className="tabular-nums text-zinc-200">{hm(todaySeconds)}</strong>
          <span>of {dailyHours}:00</span>
          {todaySeconds === 0 && <span>. Nothing logged yet, so today counts as absent.</span>}
        </p>
      </section>

      {screenshotsOn && running && <CapturePanel capture={capture} minutes={settings?.screenshot_minutes ?? 10} />}

      {/* ---- period + total ---- */}
      <section className="card mb-4 p-5">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <p className="field-label">Period</p>
            <div className="flex gap-1">
              {(["today", "custom"] as Range[]).map((r) => (
                <button
                  key={r} onClick={() => setRange(r)} aria-pressed={range === r}
                  className={
                    "min-h-[38px] rounded-lg px-3 text-sm font-medium transition-colors " +
                    (range === r ? "bg-accent text-white" : "border border-border text-muted hover:text-text")
                  }
                >
                  {r === "today" ? "Today" : "Custom range"}
                </button>
              ))}
            </div>
          </div>

          {range === "custom" && (
            <>
              <div>
                <label className="field-label" htmlFor="from">From</label>
                <input id="from" type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div>
                <label className="field-label" htmlFor="to">To</label>
                <input id="to" type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
            </>
          )}

          <div className="ml-auto text-right">
            <p className="eyebrow mb-1">Total worked</p>
            <p className="text-3xl font-bold tabular-nums text-accent">{hm(rangeSeconds)}</p>
            <p className="text-xs text-faint">
              of {hm(expectedSeconds)} expected
              {rangeSeconds >= expectedSeconds && expectedSeconds > 0 && " · target met"}
            </p>
          </div>
        </div>
      </section>

      {/* ---- the timesheet ---- */}
      <section className="card p-5">
        <h2 className="mb-3 flex items-center gap-2 font-semibold">
          <CalendarDays size={15} className="text-accent" /> Timesheet
        </h2>

        {byDay.length === 0 && (
          <p className="text-sm text-faint">
            Nothing logged in this period. Clock in above and the day appears here, and in your attendance.
          </p>
        )}

        <div className="space-y-4">
          {byDay.map(([day, rows]) => {
            const total = rows.reduce((a, e) => a + entrySeconds(e, now), 0);
            return (
              <div key={day}>
                <div className="mb-1.5 flex items-center gap-2">
                  <p className="eyebrow">{fmtDay(day)}</p>
                  {day === today && <Badge tone="normal">Today</Badge>}
                  <span className="ml-auto text-sm font-semibold tabular-nums">{hm(total)}</span>
                </div>
                <div className="space-y-1">
                  {rows.map((e) => (
                    <div key={e.id} className="group flex items-center gap-3 rounded-lg bg-surface-2 px-3 py-2">
                      <span className="w-[104px] shrink-0 text-xs tabular-nums text-faint">
                        {new Date(e.started_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        {" – "}
                        {e.ended_at ? new Date(e.ended_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "now"}
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
                      <span className="shrink-0 text-sm tabular-nums">{hm(entrySeconds(e, now))}</span>
                      {/* Admin only since 0041. An EA deleting a short day was
                          the easiest way to fake a timesheet, and RLS refuses
                          it now, so showing the button to everyone would offer
                          a control that silently fails. */}
                      {isAdmin && (
                        <button
                          className="icon-btn reveal-on-hover shrink-0 text-faint hover:text-red-400"
                          onClick={() => remove.mutate(e.id)}
                          aria-label="Delete entry"
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
          <span>
            Hours cannot be added or edited by hand, and a finished session cannot be changed.
            If you missed a clock-in, ask an admin to correct it.
          </span>
        </p>
      </section>
    </div>
  );
}

/** Compact status next to the clock-out button. */
function CaptureBadge({ capture, minutes }: { capture: ReturnType<typeof useMonitoring>; minutes: number }) {
  const map: Record<string, { text: string; cls: string }> = {
    capturing: { text: `Capturing every ${minutes}m`, cls: "bg-emerald-500/15 text-emerald-400" },
    off: { text: "Not capturing", cls: "bg-amber-500/15 text-amber-400" },
    stopped: { text: "Capture stopped", cls: "bg-amber-500/15 text-amber-400" },
    denied: { text: "Capture denied", cls: "bg-red-500/15 text-red-400" },
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
function CapturePanel({ capture, minutes }: { capture: ReturnType<typeof useMonitoring>; minutes: number }) {
  const weak = capture.state === "capturing" && capture.surface === "browser";
  return (
    <section className="card mb-4 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Camera size={15} className="text-accent" />
        <div className="min-w-[220px] flex-1">
          <p className="text-sm font-semibold">Work verification</p>
          <p className="text-xs text-faint">
            {capture.state === "capturing"
              ? `Sharing your ${capture.surface ?? "screen"}. A frame every ${minutes} minutes.` +
                (capture.lastCaptureAt ? ` Last at ${capture.lastCaptureAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.` : "")
              : `Screenshots every ${minutes} minutes while you are clocked in. Your browser has to ask you first.`}
          </p>
        </div>
        {capture.state === "capturing" ? (
          <button className="btn-ghost border border-border" onClick={capture.stop}>Stop sharing</button>
        ) : (
          <button className="btn-primary" onClick={() => void capture.start()}>
            <MonitorPlay size={14} /> Start screen capture
          </button>
        )}
      </div>

      {weak && (
        <p className="mt-2 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-2.5 text-[12.5px] text-amber-200">
          <Info size={14} className="mt-0.5 shrink-0" />
          <span>
            You shared a single browser tab, so the screenshots only show that tab. Share the whole
            screen instead if this is meant to verify your shift.
          </span>
        </p>
      )}

      {capture.error && (
        <p className="mt-2 text-[12px] text-amber-300/80">{capture.error}</p>
      )}
    </section>
  );
}
