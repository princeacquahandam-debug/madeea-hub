import { useEffect, useState } from "react";
import { Check, Clock, Loader2 } from "lucide-react";
import { useSaveTimeSettings, useTimeSettings } from "@/data/hooks";

/**
 * The workspace's time policy, on the Admin panel (19 Oct 2026 team meeting:
 * "auto-deduction"). Daily hours, and an automatic unpaid break taken off long
 * days. Breaks taken with Pause count toward it, so nobody loses one twice.
 * Admins only; the database enforces the same (0041).
 */
const BREAKS = [0, 15, 30, 45, 60];
const AFTER = [4, 5, 6, 7, 8];

export function TimePolicyCard() {
  const { data: settings } = useTimeSettings();
  const save = useSaveTimeSettings();
  const [daily, setDaily] = useState(8);
  const [brk, setBrk] = useState(0);
  const [after, setAfter] = useState(6);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setDaily(settings.daily_hours);
    setBrk(settings.auto_break_minutes);
    setAfter(settings.auto_break_after_hours);
  }, [settings]);

  const dirty = !!settings && (daily !== settings.daily_hours || brk !== settings.auto_break_minutes || after !== settings.auto_break_after_hours);

  return (
    <section className="card mb-5 p-5" aria-label="Time tracking">
      <div className="mb-1 flex items-center gap-2">
        <Clock size={16} className="text-accent" />
        <h2 className="text-[15px] font-semibold">Time tracking</h2>
      </div>
      <p className="mb-4 text-sm text-muted">
        How long a working day is, and an automatic unpaid break taken off long days. Breaks taken with Pause count toward it.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="field-label">Daily hours</span>
          <select className="input" value={daily} onChange={(e) => setDaily(Number(e.target.value))}>
            {[4, 5, 6, 7, 8, 9, 10].map((h) => <option key={h} value={h}>{h} hours</option>)}
          </select>
        </label>
        <label className="block">
          <span className="field-label">Automatic break</span>
          <select className="input" value={brk} onChange={(e) => setBrk(Number(e.target.value))}>
            {BREAKS.map((m) => <option key={m} value={m}>{m === 0 ? "Off" : `${m} minutes`}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="field-label">On days longer than</span>
          <select className="input" value={after} onChange={(e) => setAfter(Number(e.target.value))} disabled={brk === 0}>
            {AFTER.map((h) => <option key={h} value={h}>{h} hours</option>)}
          </select>
        </label>
      </div>
      <p className="mt-2 text-xs text-faint">
        {brk === 0
          ? "No break is deducted. Everyone's hours are exactly what they clocked."
          : `A day longer than ${after} hours counts ${brk} minutes less, unless that much break was already taken with Pause.`}
      </p>
      <div className="mt-3 flex items-center gap-3">
        <button
          className="btn-primary"
          disabled={!dirty || save.isPending}
          onClick={() => save.mutate({ daily_hours: daily, auto_break_minutes: brk, auto_break_after_hours: after }, {
            onSuccess: () => { setSaved(true); window.setTimeout(() => setSaved(false), 2000); },
          })}
        >
          {save.isPending ? <Loader2 size={15} className="animate-spin" /> : null} Save
        </button>
        {saved && <span className="flex items-center gap-1 text-sm text-emerald-600"><Check size={14} /> Saved</span>}
        {save.error && <span className="text-sm text-red-500">{(save.error as Error).message}</span>}
      </div>
    </section>
  );
}
