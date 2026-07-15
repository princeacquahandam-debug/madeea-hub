import { useNavigate } from "react-router-dom";
import { PlayCircle, LogOut, ShieldCheck, Sparkles, RotateCcw } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { useAuth } from "@/hooks/useAuth";
import { useTour } from "@/store/tour";
import { useMyRole } from "@/data/hooks";
import { useSlaSettings } from "@/store/slaSettings";
import { useFollowUpSettings } from "@/store/followupSettings";
import { APP_VERSION } from "@/lib/changelog";

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

export default function Settings() {
  const { user, signOut } = useAuth();
  const nav = useNavigate();
  const startTour = useTour((s) => s.start);
  const { data: role } = useMyRole();
  const { config, update, reset } = useSlaSettings();
  const { config: fu, update: updateFu, reset: resetFu } = useFollowUpSettings();

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
              {user?.initials ?? "—"}
            </div>
            <div>
              <p className="text-sm font-medium">{user?.name ?? "—"}</p>
              <p className="text-xs text-faint">{user?.email ?? ""}</p>
            </div>
          </div>
        </section>

        {role === "admin" && (
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
            stays out of your way — snoozing it buys another {fu.snoozeDays} days.
          </p>

          <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="field-label" htmlFor="fu-client">Client email — no reply for</label>
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
                <label className="field-label" htmlFor="fu-internal">Other email — no reply for</label>
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
                <label className="field-label" htmlFor="fu-task">Task — no update for</label>
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

        <section className="card p-5">
          <p className="field-label">Response-time SLA</p>
          <p className="mb-4 text-sm text-muted">
            Thresholds for the On&nbsp;Track / At&nbsp;Risk / Breached flags on each client. Response time is
            measured to the <span className="text-zinc-200">first reply</span> on a thread.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="field-label" htmlFor="sla-ok">On Track — reply within</label>
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
              <label className="field-label" htmlFor="sla-risk">Breached — beyond</label>
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
                With this on, the hours above are <span className="text-zinc-200">working</span> hours — so{" "}
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
                  The working day ends before it starts — falling back to calendar time until this is fixed.
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
          <button className="btn-ghost border border-border" onClick={replay}>
            <PlayCircle size={15} /> Replay tutorial
          </button>
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
