import { useState } from "react";
import { Repeat, Plus, Trash2, Pause, Play, CalendarClock } from "lucide-react";
import { PageHeader, Modal, Badge } from "@/components/ui";
import { useClients, useRoutineMutations, useRoutines, useWorkspaceMembers, DEMO_ME } from "@/data/hooks";
import { DAY_LABELS, describe, nextOccurrences, toRRule, type Freq } from "@/lib/recurrence";
import type { Priority, Routine } from "@/types/db";
import { cn } from "@/lib/utils";

/**
 * Recurring work.
 *
 * §5.7, and Reichelle at 1:08:12: "update the attendance sheet daily" is a real
 * job nobody should have to remember to create each morning.
 *
 * The rule is built with controls rather than typed as an RRULE string, an EA
 * should not have to know RFC 5545 to say "every Monday", but it is STORED as
 * the standard string, so a proper library can take over later without touching
 * the data.
 */
/* Assignee preselected to you rather than blank. An unassigned routine used to
   produce a task belonging to nobody, and the EOD is built from tasks assigned
   to you, so that work never reached anybody's report. If you did not say who
   it is for, it is yours. Migration 0037 covers routines created before this. */
const mine = () => ({ ...BLANK, assigneeId: DEMO_ME });

const BLANK = {
  name: "",
  title: "",
  notes: "",
  priority: "normal" as Priority,
  freq: "WEEKLY" as Freq,
  interval: 1,
  byDay: [1] as number[],
  byMonthDay: 1,
  clientId: "",
  assigneeId: "",
  leadDays: 0,
};

const fmtDay = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
};

export default function Routines() {
  const { data: routines = [], isLoading } = useRoutines();
  const { data: clients = [] } = useClients();
  const { data: members = [] } = useWorkspaceMembers();
  const { create, update, remove } = useRoutineMutations();

  const [modal, setModal] = useState(false);
  /* Preselected to you, not blank. Assignee is optional, and an unassigned
     routine used to produce a task belonging to nobody, which never reached
     anybody's EOD. If you did not say who it is for, it is yours. */
  const [form, setForm] = useState(mine);

  /* Materialisation moved to hooks/useRoutineRunner, mounted in AppShell, so it
     runs when anyone opens the app rather than only when somebody visits this
     page. Nobody revisits this page after setting a routine up, which meant
     the tasks were never created. */

  const rule = toRRule({
    freq: form.freq,
    interval: form.interval,
    byDay: form.byDay,
    byMonthDay: form.freq === "MONTHLY" ? form.byMonthDay : undefined,
  });
  // §5.7 asks for this explicitly: see the next five before saving, because a
  // recurrence rule is very easy to get subtly wrong.
  const preview = nextOccurrences(rule, new Date(), 5);

  /* "FREQ=WEEKLY" with no BYDAY is legal RFC 5545, it means weekly on the
     start day, so the engine happily returns dates for it. But this form shows
     seven day buttons, and deselecting all of them reads as "no days", not as
     "silently use today's weekday". Treated as incomplete here so the UI means
     what it appears to mean. */
  const noDaysPicked = form.freq === "WEEKLY" && form.byDay.length === 0;
  const invalid = noDaysPicked || preview.length === 0;

  const submit = () => {
    if (!form.name.trim()) return;
    create.mutate({
      name: form.name.trim(),
      task_template: { title: form.title.trim() || form.name.trim(), priority: form.priority, notes: form.notes.trim() || undefined },
      rrule: rule,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      client_id: form.clientId || null,
      assignee_id: form.assigneeId || null,
      is_active: true,
      lead_days: form.leadDays,
    });
    setForm(mine());
    setModal(false);
  };

  return (
    <div>
      <PageHeader
        title="Routines"
        subtitle="Work that comes back. The task appears on its own, on the day it should."
        action={<button className="btn-primary" onClick={() => { setForm(mine()); setModal(true); }}><Plus size={15} /> New routine</button>}
      />

      {isLoading && <p className="text-sm text-faint">Loading…</p>}

      {!isLoading && routines.length === 0 && (
        <div className="card p-8 text-center">
          <Repeat size={24} className="mx-auto mb-3 text-faint" />
          <p className="font-medium">No routines yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-faint">
            Anything you do on a rhythm, the Monday report, the daily attendance sheet,
            month-end invoicing. Set it once and the task turns up by itself.
          </p>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {routines.map((r: Routine) => {
          const next = nextOccurrences(r.rrule, new Date(), 3);
          return (
            <div key={r.id} className={cn("card group p-4", !r.is_active && "opacity-60")}>
              <div className="mb-1 flex items-start gap-2">
                <Repeat size={15} className={cn("mt-0.5 shrink-0", r.is_active ? "text-accent" : "text-faint")} />
                <p className="min-w-0 flex-1 truncate text-sm font-medium">{r.name}</p>
                {!r.is_active && <Badge tone="normal">Paused</Badge>}
                <button
                  className="icon-btn reveal-on-hover shrink-0 text-faint hover:text-accent"
                  onClick={() => update.mutate({ id: r.id, is_active: !r.is_active })}
                  aria-label={r.is_active ? `Pause ${r.name}` : `Resume ${r.name}`}
                >
                  {r.is_active ? <Pause size={13} /> : <Play size={13} />}
                </button>
                <button
                  className="icon-btn reveal-on-hover shrink-0 text-faint hover:text-red-400"
                  onClick={() => remove.mutate(r.id)}
                  aria-label={`Delete ${r.name}`}
                >
                  <Trash2 size={13} />
                </button>
              </div>

              <p className="mb-2 pl-6 text-xs text-faint">
                {describe(r.rrule)}
                {r.client_id && <> · {clients.find((c) => c.id === r.client_id)?.name}</>}
                {r.lead_days > 0 && <> · created {r.lead_days}d ahead</>}
              </p>

              <div className="flex flex-wrap items-center gap-1.5 pl-6">
                <CalendarClock size={11} className="text-faint" />
                {next.length === 0 && <span className="text-xs text-faint">Schedule not recognised</span>}
                {next.map((d) => (
                  <span key={d} className="pill bg-surface-2 text-faint">{fmtDay(d)}</span>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <Modal open={modal} onClose={() => setModal(false)}>
        <h2 className="mb-4 text-lg font-semibold">New routine</h2>
        <div className="space-y-3">
          <div>
            <label className="field-label" htmlFor="r-name">Name</label>
            <input id="r-name" className="input" placeholder="e.g. Update the attendance sheet" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="field-label" htmlFor="r-freq">Repeats</label>
              <select id="r-freq" className="input" value={form.freq} onChange={(e) => setForm((f) => ({ ...f, freq: e.target.value as Freq }))}>
                <option value="DAILY">Daily</option>
                <option value="WEEKLY">Weekly</option>
                <option value="MONTHLY">Monthly</option>
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="r-interval">Every</label>
              <select id="r-interval" className="input" value={form.interval} onChange={(e) => setForm((f) => ({ ...f, interval: Number(e.target.value) }))}>
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>{n === 1 ? "1 (each time)" : `${n}`}</option>
                ))}
              </select>
            </div>
          </div>

          {form.freq === "WEEKLY" && (
            <div>
              <label className="field-label">On</label>
              <div className="flex flex-wrap gap-1.5">
                {DAY_LABELS.map((d, i) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, byDay: f.byDay.includes(i) ? f.byDay.filter((x) => x !== i) : [...f.byDay, i] }))}
                    className={cn(
                      "min-h-[36px] rounded-lg px-3 text-xs font-medium transition-colors",
                      form.byDay.includes(i) ? "bg-accent text-white" : "bg-surface-2 text-muted hover:text-zinc-100",
                    )}
                    aria-pressed={form.byDay.includes(i)}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
          )}

          {form.freq === "MONTHLY" && (
            <div>
              <label className="field-label" htmlFor="r-dom">Day of the month</label>
              <select id="r-dom" className="input" value={form.byMonthDay} onChange={(e) => setForm((f) => ({ ...f, byMonthDay: Number(e.target.value) }))}>
                {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
              <p className="mt-1 text-[11px] text-faint">Months that are too short use their last day.</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="field-label">Client</label>
              <select className="input" value={form.clientId} onChange={(e) => setForm((f) => ({ ...f, clientId: e.target.value }))}>
                <option value="">No client</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="field-label">Assignee</label>
              <select className="input" value={form.assigneeId} onChange={(e) => setForm((f) => ({ ...f, assigneeId: e.target.value }))}>
                <option value="">Unassigned</option>
                {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.name}{m.is_me ? " (you)" : ""}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="field-label" htmlFor="r-lead">Create it in advance</label>
            <select id="r-lead" className="input" value={form.leadDays} onChange={(e) => setForm((f) => ({ ...f, leadDays: Number(e.target.value) }))}>
              <option value={0}>On the day</option>
              <option value={1}>1 day before</option>
              <option value={2}>2 days before</option>
              <option value={7}>A week before</option>
            </select>
          </div>

          {/* §5.7 wants this before saving: a recurrence rule is easy to get
              subtly wrong, and five real dates make the mistake obvious. */}
          <div className="rounded-lg bg-surface-2 p-3">
            <p className="eyebrow mb-1.5">{invalid ? "Not scheduled yet" : `${describe(rule)}. Next five`}</p>
            {invalid ? (
              <p className="text-xs text-amber-300">
                {noDaysPicked ? "Pick at least one day of the week." : "That combination never occurs."}
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {preview.map((d) => <span key={d} className="pill bg-black/20 text-faint">{fmtDay(d)}</span>)}
              </div>
            )}
          </div>

          <button className="btn-primary w-full" onClick={submit} disabled={!form.name.trim() || invalid || create.isPending}>
            {create.isPending ? "Creating…" : "Create routine"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
