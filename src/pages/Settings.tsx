import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { PlayCircle, LogOut, ShieldCheck, Sparkles, RotateCcw, KeyRound, GraduationCap, AlertTriangle, Radio } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { useAuth } from "@/hooks/useAuth";
import { useTour } from "@/store/tour";
import { atLeast, useMyRole } from "@/data/hooks";
import { useSlaSettings } from "@/store/slaSettings";
import { useAlertRoutes, useAlertRouteMutations } from "@/data/hooks";
import { useFollowUpSettings } from "@/store/followupSettings";
import { useUI } from "@/store/ui";
import { APP_VERSION } from "@/lib/changelog";

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

export default function Settings() {
  const { user, signOut } = useAuth();
  const nav = useNavigate();
  const startTour = useTour((s) => s.start);
  const { data: role } = useMyRole();
  const { config, update, reset } = useSlaSettings();
  const slaLocal = useSlaSettings((st) => st.local);
  const { config: fu, update: updateFu, reset: resetFu } = useFollowUpSettings();
  const { academyPromoDismissed, restoreAcademyPromo } = useUI();

  function replay() {
    nav("/");
    setTimeout(() => startTour(), 150);
  }

  const toggleDay = (d: number) =>
    update({
      days: config.days.includes(d)
        ? config.days.filter((x) => x !== d)
        : [...config.days, d].sort(),
    });

  return (
    <div>
      <PageHeader title="Settings" subtitle="Your account and preferences" />
      <div className="max-w-xl space-y-4">
        <section className="card p-5">
          <p className="field-label">Account</p>
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-accent/20 text-sm font-semibold text-accent-soft">
              {user?.initials ?? "-"}
            </div>
            <div>
              <p className="text-sm font-medium">{user?.name ?? "-"}</p>
              <p className="text-xs text-faint">{user?.email ?? ""}</p>
            </div>
          </div>
        </section>

        <ChangePassword />

        {atLeast(role, "admin") && (
          <section className="card p-5">
            <p className="field-label">Administration</p>
            <p className="mb-3 text-sm text-muted">Manage team accounts, roles and invites. You can use the app normally and switch to the Admin panel any time.</p>
            <button className="btn-ghost border border-border" onClick={() => nav("/admin")}>
              <ShieldCheck size={15} /> Open Admin panel
            </button>
          </section>
        )}

        <section className="card p-5">
          <p className="field-label">Follow-up nudges</p>
          <p className="mb-4 text-sm text-muted">
            How long something can go quiet before it's flagged. A nudge surfaces once and then
            stays out of your way. Snoozing it buys another {fu.snoozeDays} days.
          </p>

          <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="field-label" htmlFor="fu-client">Client email. No reply for</label>
                <div className="flex items-center gap-2">
                  <input
                    id="fu-client"
                    className="input"
                    type="number"
                    min={1}
                    value={fu.clientEmailDays}
                    onChange={(e) => updateFu({ clientEmailDays: Math.max(1, Number(e.target.value) || 1) })}
                  />
                  <span className="text-xs text-faint">days</span>
                </div>
              </div>
              <div>
                <label className="field-label" htmlFor="fu-internal">Other email. No reply for</label>
                <div className="flex items-center gap-2">
                  <input
                    id="fu-internal"
                    className="input"
                    type="number"
                    min={1}
                    value={fu.internalEmailDays}
                    onChange={(e) => updateFu({ internalEmailDays: Math.max(1, Number(e.target.value) || 1) })}
                  />
                  <span className="text-xs text-faint">days</span>
                </div>
              </div>
              <div>
                <label className="field-label" htmlFor="fu-task">Task. No update for</label>
                <div className="flex items-center gap-2">
                  <input
                    id="fu-task"
                    className="input"
                    type="number"
                    min={1}
                    value={fu.taskDays}
                    onChange={(e) => updateFu({ taskDays: Math.max(1, Number(e.target.value) || 1) })}
                  />
                  <span className="text-xs text-faint">days</span>
                </div>
              </div>
              <div>
                <label className="field-label" htmlFor="fu-snooze">Snooze lasts</label>
                <div className="flex items-center gap-2">
                  <input
                    id="fu-snooze"
                    className="input"
                    type="number"
                    min={1}
                    value={fu.snoozeDays}
                    onChange={(e) => updateFu({ snoozeDays: Math.max(1, Number(e.target.value) || 1) })}
                  />
                  <span className="text-xs text-faint">days</span>
                </div>
              </div>
          </div>

          <button className="btn-ghost mt-4 border border-border" onClick={resetFu}>
            <RotateCcw size={15} /> Reset to defaults
          </button>
        </section>

        {/* Where an SLA breach goes when one happens. Its own section rather
            than a line in the SLA card, because the threshold and the
            destination are edited by different people at different times. */}
        <AlertRouting />

        <section className="card p-5">
          <p className="field-label">Response-time SLA</p>
          <p className="mb-4 text-sm text-muted">
            Thresholds for the On&nbsp;Track / At&nbsp;Risk / Breached flags on each client. Response time is
            measured to the <span className="text-zinc-200">first reply</span> on a thread.
            {" "}Shared by the whole workspace. Individual clients can override these on their record.
          </p>

          {/* Truth over completeness. These thresholds used to live in this
              browser, so this notice is the difference between "the team's
              definition of late" and "yours". */}
          {slaLocal && (
            <p className="mb-4 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-[12.5px] leading-relaxed text-amber-200">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>
                Saved in this browser only. Run migration 0036 to share these across the workspace,
                otherwise everyone carries their own definition of late.
              </span>
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="field-label" htmlFor="sla-ok">On Track. Reply within</label>
              <div className="flex items-center gap-2">
                <input
                  id="sla-ok"
                  className="input"
                  type="number"
                  min={1}
                  value={config.okHours}
                  onChange={(e) => update({ okHours: Math.max(1, Number(e.target.value) || 1) })}
                />
                <span className="text-xs text-faint">hrs</span>
              </div>
            </div>
            <div>
              <label className="field-label" htmlFor="sla-risk">Breached. Beyond</label>
              <div className="flex items-center gap-2">
                <input
                  id="sla-risk"
                  className="input"
                  type="number"
                  min={1}
                  value={config.riskHours}
                  onChange={(e) => update({ riskHours: Math.max(1, Number(e.target.value) || 1) })}
                />
                <span className="text-xs text-faint">hrs</span>
              </div>
            </div>
          </div>
          {config.riskHours <= config.okHours && (
            <p className="mt-2 text-xs text-amber-400">
              The breach threshold should be higher than the On Track one, or nothing can ever be At Risk.
            </p>
          )}

          <label className="mt-4 flex cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              className="mt-0.5 accent-[#fd5812]"
              checked={config.businessHoursOnly}
              onChange={(e) => update({ businessHoursOnly: e.target.checked })}
            />
            <span className="text-sm">
              Count working hours only
              <span className="block text-xs text-faint">
                An email arriving Friday evening and answered Monday morning costs an hour, not a weekend.
                With this on, the hours above are <span className="text-zinc-200">working</span> hours, so{" "}
                {config.okHours}h is about{" "}
                {(config.okHours / Math.max(1, config.endHour - config.startHour)).toFixed(1)} working days.
              </span>
            </span>
          </label>

          {config.businessHoursOnly && (
            <div className="mt-4 space-y-3 rounded-lg bg-surface-2 p-3">
              <div className="flex items-center gap-2">
                <span className="field-label mb-0 flex-1">Working hours</span>
                <input
                  className="input w-20 py-1"
                  type="number"
                  min={0}
                  max={23}
                  aria-label="Start hour"
                  value={config.startHour}
                  onChange={(e) => update({ startHour: Math.min(23, Math.max(0, Number(e.target.value) || 0)) })}
                />
                <span className="text-xs text-faint">to</span>
                <input
                  className="input w-20 py-1"
                  type="number"
                  min={1}
                  max={24}
                  aria-label="End hour"
                  value={config.endHour}
                  onChange={(e) => update({ endHour: Math.min(24, Math.max(1, Number(e.target.value) || 1)) })}
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="field-label mb-0 flex-1">Working days</span>
                {DAY_LABELS.map((label, d) => (
                  <button
                    key={d}
                    onClick={() => toggleDay(d)}
                    aria-pressed={config.days.includes(d)}
                    aria-label={["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][d]}
                    className={`h-7 w-7 rounded-md text-xs font-medium transition-colors ${
                      config.days.includes(d)
                        ? "bg-accent text-white"
                        : "bg-surface text-faint hover:text-zinc-100"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {config.endHour <= config.startHour && (
                <p className="text-xs text-amber-400">
                  The working day ends before it starts. Falling back to calendar time until this is fixed.
                </p>
              )}
            </div>
          )}

          <button className="btn-ghost mt-4 border border-border" onClick={reset}>
            <RotateCcw size={15} /> Reset to defaults
          </button>
        </section>

        <section className="card p-5">
          <p className="field-label">What's new</p>
          <p className="mb-3 text-sm text-muted">You're on version {APP_VERSION}. See the latest updates and release history.</p>
          <button className="btn-ghost border border-border" onClick={() => nav("/changelog")}>
            <Sparkles size={15} /> View updates
          </button>
        </section>

        <section className="card p-5">
          <p className="field-label">Onboarding</p>
          <p className="mb-3 text-sm text-muted">Replay the guided walkthrough of the Command Center any time.</p>
          <div className="flex flex-wrap gap-2">
            <button className="btn-ghost border border-border" onClick={replay}>
              <PlayCircle size={15} /> Replay tutorial
            </button>
            {academyPromoDismissed && (
              <button className="btn-ghost border border-border" onClick={restoreAcademyPromo}>
                <GraduationCap size={15} /> Show Academy tip
              </button>
            )}
          </div>
          {academyPromoDismissed && (
            <p className="mt-2 text-xs text-faint">The Academy card is hidden in your sidebar. This browser only.</p>
          )}
        </section>

        <section className="card p-5">
          <p className="field-label">Session</p>
          <button className="btn-ghost border border-border text-red-400 hover:bg-red-500/10" onClick={() => signOut()}>
            <LogOut size={15} /> Sign out
          </button>
        </section>
      </div>
    </div>
  );
}

const MIN_LEN = 8;

/**
 * Change your own password from inside the app. No reset email needed, which is
 * what lets a teammate who was set up with a temporary password pick their own.
 * The current password is required (verified in useAuth) so an unlocked screen
 * can't be used to take the account over.
 */
function ChangePassword() {
  const { updatePassword, demo } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);

  // Client-side guards; the server enforces its own minimum too.
  const tooShort = next.length > 0 && next.length < MIN_LEN;
  const mismatch = confirm.length > 0 && next !== confirm;
  const reused = next.length > 0 && next === current;
  const canSubmit =
    !demo && current.length > 0 && next.length >= MIN_LEN && next === confirm && next !== current && !saving;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError("");
    setDone(false);
    try {
      await updatePassword(current, next);
      setDone(true);
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update your password.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card p-5">
      <p className="field-label">Password</p>
      <p className="mb-4 text-sm text-muted">Change the password you use to sign in. You'll need your current one.</p>

      {demo ? (
        <p className="rounded-lg border border-border bg-surface-2 p-3 text-xs text-faint">
          Not available in the demo. Sign in with a real account to change your password.
        </p>
      ) : (
        <form className="max-w-sm space-y-3" onSubmit={submit}>
          {/* Present but hidden: gives password managers the account context so
              "update saved password" works after a change. */}
          <input type="text" autoComplete="username" className="hidden" tabIndex={-1} aria-hidden="true" />
          <div>
            <label className="field-label" htmlFor="pw-current">Current password</label>
            <input
              id="pw-current"
              className="input"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => { setCurrent(e.target.value); setDone(false); setError(""); }}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="pw-next">New password</label>
            <input
              id="pw-next"
              className="input"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => { setNext(e.target.value); setDone(false); setError(""); }}
              aria-invalid={tooShort || reused}
            />
            <p className="mt-1 text-[11px] text-faint">At least {MIN_LEN} characters.</p>
          </div>
          <div>
            <label className="field-label" htmlFor="pw-confirm">Confirm new password</label>
            <input
              id="pw-confirm"
              className="input"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => { setConfirm(e.target.value); setDone(false); setError(""); }}
              aria-invalid={mismatch}
            />
          </div>

          {tooShort && <p className="text-xs text-amber-400">New password must be at least {MIN_LEN} characters.</p>}
          {reused && <p className="text-xs text-amber-400">Pick a password different from your current one.</p>}
          {mismatch && <p className="text-xs text-amber-400">The two new passwords don't match.</p>}
          {error && <p className="rounded-lg border border-red-500/40 bg-red-500/5 p-2.5 text-xs text-red-300">{error}</p>}
          {done && <p className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-2.5 text-xs text-emerald-300">Password updated. Use it next time you sign in.</p>}

          <button className="btn-primary" type="submit" disabled={!canSubmit}>
            <KeyRound size={15} />
            {saving ? "Updating…" : "Update password"}
          </button>
        </form>
      )}
    </section>
  );
}


/**
 * Where alerts go.
 *
 * Deliberately shows 'Not connected' as a first-class state rather than hiding
 * the section until something is wired. A field with nothing behind it that
 * looks live is worse than an empty one that says so.
 */
function AlertRouting() {
  const { data: routes = [], isLoading } = useAlertRoutes();
  const { setRoute } = useAlertRouteMutations();
  const { data: role } = useMyRole();
  const isAdmin = atLeast(role, "admin");
  const sla = routes.find((r) => r.event === "sla_breach");

  return (
    <section className="card p-5">
      <p className="field-label">Alerts</p>
      <p className="mb-4 text-sm text-muted">
        Where the app reaches out when something needs attention. Breach alerts go to the team,
        not to the client: telling a client we were late, at the moment we are late, is not a
        report. Client-facing reporting is the Scoreboard.
      </p>

      {isLoading ? (
        <p className="text-sm text-faint">Loading…</p>
      ) : !sla ? (
        <p className="flex items-start gap-2 rounded-lg border border-border bg-surface-2/50 p-3 text-[12.5px] text-muted">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-400" />
          Run migration 0036 to enable alert routing.
        </p>
      ) : (
        <div className="rounded-lg border border-border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Radio size={15} className={sla.is_active && sla.channel !== "none" ? "text-emerald-400" : "text-faint"} />
            <span className="text-sm font-medium">SLA breach</span>
            <span
              className={
                sla.is_active && sla.channel !== "none"
                  ? "pill bg-emerald-500/15 text-emerald-400"
                  : "pill bg-zinc-500/15 text-zinc-400"
              }
            >
              {sla.is_active && sla.channel !== "none" ? "Connected" : "Not connected"}
            </span>
            <span className="ml-auto text-xs text-faint">to the EA and admins</span>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <label className="field-label" htmlFor="route-channel">Channel</label>
              <select
                id="route-channel"
                className="input"
                disabled={!isAdmin}
                value={sla.channel}
                onChange={(e) => setRoute.mutate({ event: "sla_breach", channel: e.target.value as "none" | "n8n" })}
              >
                <option value="none">Not connected</option>
                <option value="n8n">n8n webhook</option>
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="route-target">Webhook path</label>
              <input
                id="route-target"
                className="input"
                disabled={!isAdmin || sla.channel === "none"}
                placeholder="sla-breach"
                defaultValue={sla.target ?? ""}
                onBlur={(e) => setRoute.mutate({ event: "sla_breach", target: e.target.value.trim() || null })}
              />
            </div>
          </div>

          <label className="mt-3 flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 accent-[color:var(--accent)]"
              disabled={!isAdmin || sla.channel === "none"}
              checked={sla.is_active}
              onChange={(e) => setRoute.mutate({ event: "sla_breach", is_active: e.target.checked })}
            />
            <span>
              Send these
              <span className="block text-xs text-faint">
                The path is appended to the server's N8N_BASE_URL. The base URL and key are env vars,
                never in the browser. With no base URL set, alerts are recorded as skipped rather than sent.
              </span>
            </span>
          </label>

          {!isAdmin && <p className="mt-3 text-xs text-faint">Admins change this.</p>}
        </div>
      )}
    </section>
  );
}
