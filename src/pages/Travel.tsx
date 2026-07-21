import { useMemo, useState } from "react";
import { Sparkles, Plus, Trash2, Plane, AlertTriangle, Info, ListChecks, FileText } from "lucide-react";
import { Badge, PageHeader } from "@/components/ui";
import { OutputViewer } from "@/components/OutputViewer";
import { useTaskMutations } from "@/data/hooks";
import { generate } from "@/lib/ai";
import {
  analyseTrip,
  COMMON_ZONES,
  CONNECTION_TONE,
  DEFAULT_TRAVEL_OPTIONS,
  emptyLeg,
  formatInZone,
  formatMinutes,
  isValidZone,
  tripFacts,
  type Leg,
  type TravelOptions,
} from "@/lib/travel";

const WARNING_ICON = { critical: AlertTriangle, warning: AlertTriangle, info: Info } as const;
const WARNING_STYLE = {
  critical: "border-red-500/40 bg-red-500/5 text-red-200",
  warning: "border-amber-500/40 bg-amber-500/5 text-amber-100",
  info: "border-border bg-surface-2 text-muted",
} as const;

let legSeq = 0;
const nextLegId = () => `leg-${++legSeq}`;

export default function Travel() {
  const [opts, setOpts] = useState<TravelOptions>(DEFAULT_TRAVEL_OPTIONS);
  const [legs, setLegs] = useState<Leg[]>([emptyLeg(nextLegId())]);
  const [output, setOutput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [added, setAdded] = useState(0);
  const { create } = useTaskMutations();

  const trip = useMemo(() => analyseTrip(legs, opts), [legs, opts]);
  const setOpt = <K extends keyof TravelOptions>(k: K, v: TravelOptions[K]) =>
    setOpts((p) => ({ ...p, [k]: v }));
  const setLeg = (id: string, patch: Partial<Leg>) =>
    setLegs((p) => p.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  /** Checklist deadlines become real dates by subtracting from departure, never by parsing the label. */
  function dueDateFor(daysBefore: number | null): string | null {
    if (daysBefore === null || !trip.departUtc) return null;
    const d = new Date(trip.departUtc.getTime() - daysBefore * 86_400_000);
    return d.toISOString().slice(0, 10);
  }

  async function addChecklistToTasks() {
    const label = legs[0]?.to ? ` (${legs[0].to})` : "";
    for (const item of trip.checklist) {
      await create.mutateAsync({
        title: `Travel${label}: ${item.label}`,
        priority: item.daysBefore === null ? "high" : "normal",
        due_at: dueDateFor(item.daysBefore),
      });
    }
    setAdded(trip.checklist.length);
  }

  async function run() {
    setBusy(true);
    setError("");
    setOutput("");
    try {
      const out = await generate({
        tool: "travel",
        format: `Travel itinerary — ${legs[0]?.from || "?"} to ${legs[legs.length - 1]?.to || "?"}`,
        inputs: { itinerary: tripFacts(trip, opts) },
      });
      setOutput(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't generate the itinerary.");
    } finally {
      setBusy(false);
    }
  }

  const blocking = trip.warnings.some((w) => w.severity === "critical");

  return (
    <div>
      <PageHeader
        title="Travel Helper"
        subtitle="Every duration, layover and timezone shift is calculated here — the writer only puts words around them."
      />

      <datalist id="tz-list">
        {COMMON_ZONES.map((z) => (
          <option key={z} value={z} />
        ))}
      </datalist>

      <div className="grid gap-5 lg:grid-cols-[22rem_1fr]">
        {/* ---- trip settings ---- */}
        <div className="card h-fit p-5">
          <h2 className="mb-3 font-semibold">Trip</h2>
          <div className="space-y-3">
            <Field label="Traveller" value={opts.traveller} onChange={(v) => setOpt("traveller", v)} placeholder="e.g. James Harrington" />
            <ZoneField label="Home timezone" value={opts.homeZone} onChange={(v) => setOpt("homeZone", v)} />
            <Field label="Hotel" value={opts.hotel} onChange={(v) => setOpt("hotel", v)} placeholder="e.g. The Peninsula, 3 nights" />

            <div className="grid grid-cols-2 gap-3">
              <NumField label="At airport (min)" value={opts.airportArrivalMinutes} onChange={(v) => setOpt("airportArrivalMinutes", v)} />
              <NumField label="Travel to airport (min)" value={opts.travelToAirportMinutes} onChange={(v) => setOpt("travelToAirportMinutes", v)} />
            </div>
            <NumField label="Minimum connection (min)" value={opts.minConnectionMinutes} onChange={(v) => setOpt("minConnectionMinutes", v)} />

            <label className="flex items-center gap-2 text-sm text-muted">
              <input type="checkbox" checked={opts.international} onChange={(e) => setOpt("international", e.target.checked)} />
              International trip
            </label>
            {opts.international && (
              <>
                <label className="flex items-center gap-2 text-sm text-muted">
                  <input type="checkbox" checked={opts.visaRequired} onChange={(e) => setOpt("visaRequired", e.target.checked)} />
                  Visa / travel authorisation needed
                </label>
                <div>
                  <label className="field-label">Passport expiry</label>
                  <input type="date" className="input" value={opts.passportExpiry} onChange={(e) => setOpt("passportExpiry", e.target.value)} />
                  <p className="mt-1 text-[11px] text-faint">Checked against the six-month rule on arrival.</p>
                </div>
              </>
            )}

            <div>
              <label className="field-label">Notes</label>
              <textarea className="input min-h-[60px]" value={opts.notes} onChange={(e) => setOpt("notes", e.target.value)} placeholder="e.g. Aisle seat, no red-eye on the return" />
            </div>
          </div>
        </div>

        <div className="space-y-5">
          {/* ---- legs ---- */}
          <section className="card p-5">
            <div className="mb-3 flex items-center gap-2">
              <Plane size={16} className="text-accent-soft" />
              <h2 className="font-semibold">Flights</h2>
              <button
                className="btn-ghost ml-auto border border-border py-1 text-xs"
                onClick={() => setLegs((p) => [...p, emptyLeg(nextLegId())])}
              >
                <Plus size={13} /> Add leg
              </button>
            </div>

            <div className="space-y-3">
              {legs.map((leg, i) => {
                const a = trip.legs[i];
                return (
                  <div key={leg.id} className="rounded-lg border border-border bg-surface-2 p-3">
                    <div className="mb-2 flex items-center gap-2">
                      <span className="eyebrow">Leg {i + 1}</span>
                      {a?.durationMinutes !== null && a?.durationMinutes !== undefined && a.durationMinutes >= 0 && (
                        <span className="text-xs text-faint">{formatMinutes(a.durationMinutes)} in the air</span>
                      )}
                      {legs.length > 1 && (
                        <button
                          className="ml-auto text-faint hover:text-red-400"
                          onClick={() => setLegs((p) => p.filter((l) => l.id !== leg.id))}
                          aria-label={`Remove leg ${i + 1}`}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2">
                      <Field label="From" value={leg.from} onChange={(v) => setLeg(leg.id, { from: v })} placeholder="LHR" />
                      <Field label="To" value={leg.to} onChange={(v) => setLeg(leg.id, { to: v })} placeholder="JFK" />
                      <ZoneField label="From timezone" value={leg.fromZone} onChange={(v) => setLeg(leg.id, { fromZone: v })} />
                      <ZoneField label="To timezone" value={leg.toZone} onChange={(v) => setLeg(leg.id, { toZone: v })} />
                      <div>
                        <label className="field-label">Departs (local)</label>
                        <input type="datetime-local" className="input" value={leg.departLocal} onChange={(e) => setLeg(leg.id, { departLocal: e.target.value })} />
                      </div>
                      <div>
                        <label className="field-label">Arrives (local)</label>
                        <input type="datetime-local" className="input" value={leg.arriveLocal} onChange={(e) => setLeg(leg.id, { arriveLocal: e.target.value })} />
                      </div>
                      <Field label="Carrier" value={leg.carrier} onChange={(v) => setLeg(leg.id, { carrier: v })} placeholder="British Airways" />
                      <Field label="Reference" value={leg.reference} onChange={(v) => setLeg(leg.id, { reference: v })} placeholder="BA117 / XR4K2P" />
                    </div>

                    {a?.dayShift ? (
                      <p className="mt-2 text-xs text-faint">
                        Arrives {a.dayShift > 0 ? `+${a.dayShift}` : a.dayShift} calendar day
                        {Math.abs(a.dayShift) === 1 ? "" : "s"}
                        {a.timezoneShiftHours !== null && ` · clocks ${a.timezoneShiftHours >= 0 ? "forward" : "back"} ${Math.abs(a.timezoneShiftHours)}h`}
                      </p>
                    ) : null}

                    {i > 0 && trip.connections[i - 1] && (
                      <div className="mt-2 flex items-center gap-2 text-xs">
                        <Badge tone={CONNECTION_TONE[trip.connections[i - 1].status]}>
                          {trip.connections[i - 1].minutes === null
                            ? "Connection unknown"
                            : `${formatMinutes(trip.connections[i - 1].minutes!)} connection`}
                        </Badge>
                        <span className="text-faint">{trip.connections[i - 1].note}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* ---- computed summary ---- */}
          <section className="card p-5">
            <h2 className="mb-3 font-semibold">Calculated</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat
                label="Leave home by"
                value={trip.leaveHomeBy ? formatInZone(trip.leaveHomeBy, opts.homeZone) : "—"}
                small
              />
              <Stat label="Door to door" value={trip.totalElapsedMinutes === null ? "—" : formatMinutes(trip.totalElapsedMinutes)} />
              <Stat label="In the air" value={trip.totalTravelMinutes === null ? "—" : formatMinutes(trip.totalTravelMinutes)} />
              <Stat
                label="Clock change"
                value={trip.jetLagHours === null ? "—" : `${trip.jetLagHours > 0 ? "+" : ""}${trip.jetLagHours}h`}
              />
            </div>

            {trip.warnings.length > 0 && (
              <div className="mt-4 space-y-2">
                {trip.warnings.map((w, i) => {
                  const Icon = WARNING_ICON[w.severity];
                  return (
                    <div key={i} className={`flex items-start gap-2 rounded-lg border p-3 text-xs ${WARNING_STYLE[w.severity]}`}>
                      <Icon size={14} className="mt-0.5 shrink-0" />
                      <span>{w.message}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* ---- checklist ---- */}
          <section className="card p-5">
            <div className="mb-3 flex items-center gap-2">
              <ListChecks size={16} className="text-accent-soft" />
              <h2 className="font-semibold">Preparation checklist</h2>
              <button
                className="btn-ghost ml-auto border border-border py-1 text-xs"
                onClick={addChecklistToTasks}
                disabled={create.isPending || !trip.checklist.length}
              >
                {create.isPending ? "Adding…" : added ? `Added ${added}` : "Add all to Tasks"}
              </button>
            </div>
            <div className="space-y-2">
              {trip.checklist.map((c) => (
                <div key={c.id} className="flex items-start gap-3 rounded-lg bg-surface-2 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{c.label}</p>
                    <p className="text-xs text-faint">{c.detail}</p>
                  </div>
                  <span className="shrink-0 text-xs text-muted">{c.dueLabel}</span>
                </div>
              ))}
            </div>
            {!trip.departUtc && (
              <p className="mt-3 text-[11px] text-faint">
                Fill in the first departure time and these get real due dates when added to Tasks.
              </p>
            )}
          </section>

          {/* ---- document ---- */}
          <section className="card p-5">
            <div className="mb-3 flex items-center gap-2">
              <p className="field-label mb-0">Itinerary document</p>
              <button className="btn-primary ml-auto py-1.5 text-xs" onClick={run} disabled={busy}>
                <Sparkles size={14} />
                {busy ? "Writing…" : "Write the itinerary"}
              </button>
            </div>
            {blocking && !output && (
              <p className="mb-3 text-xs text-red-300">
                There are critical problems above. Fix them first — the document will faithfully repeat them.
              </p>
            )}
            {error && <p className="mb-3 text-sm text-red-300">{error}</p>}
            {output ? (
              <OutputViewer output={output} title="Travel itinerary" />
            ) : (
              <div className="flex flex-col items-center justify-center gap-2 py-8 text-center text-faint">
                <FileText size={26} />
                <p className="text-sm">Fill in the legs, then generate the itinerary</p>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="rounded-lg bg-surface-2 p-3">
      <p className="eyebrow">{label}</p>
      <p className={`mt-1 font-semibold ${small ? "text-sm" : "display text-2xl"}`}>{value}</p>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="field-label">{label}</label>
      <input className="input" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="field-label">{label}</label>
      <input
        type="number"
        min={0}
        className="input"
        value={value}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
      />
    </div>
  );
}

/** Free text with suggestions — any IANA zone works, not just the common ones. */
function ZoneField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const bad = value.length > 0 && !isValidZone(value);
  return (
    <div>
      <label className="field-label">{label}</label>
      <input
        className={`input ${bad ? "border-red-500/60" : ""}`}
        list="tz-list"
        value={value}
        placeholder="Europe/London"
        onChange={(e) => onChange(e.target.value)}
      />
      {bad && <p className="mt-1 text-[11px] text-red-300">Not a recognised timezone</p>}
    </div>
  );
}
